import "server-only";
import { and, eq, lte } from "drizzle-orm";
import { z } from "zod";
import { availableModels } from "./ai/models";
import { db, schema } from "@/db";
import { AppError } from "./errors";
import { audit } from "./audit";
import { auth } from "./auth";
import { IMAGE_PATH } from "./images";
import type { AppUser } from "./access";
import { ACCENTS, TEXT_SIZES, THEMES } from "@/lib/display-prefs";

export const DELETION_GRACE_DAYS = 7;

export const profileSchema = z
  .object({
    displayName: z.string().trim().min(2).max(40),
    bio: z.string().trim().max(300),
    avatarUrl: z.union([z.string().trim().regex(IMAGE_PATH), z.string().trim().url().startsWith("https://", "Avatar must be an https URL").max(500), z.literal(""), z.null()]),
    memoryEnabled: z.boolean(),
    ageConfirmed18: z.boolean(),
    matureContentEnabled: z.boolean(),
    chatModel: z.string().trim().min(1).max(100),
    responseStyle: z.enum(["concise", "balanced", "detailed"]),
    prefs: z.object({ theme: z.enum(THEMES), accent: z.enum(ACCENTS), text: z.enum(TEXT_SIZES) }).partial(),
  })
  .partial();

/** Fields that are safe to send to the owner. Never includes credentials. */
export function toPublicUser(u: AppUser) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    bio: u.bio,
    avatarUrl: u.avatarUrl,
    roles: u.allRoles,
    activeRoles: u.roles,
    twoFactorEnabled: u.twoFactorEnabled,
    status: u.status,
    ageConfirmed18: u.ageConfirmed18,
    matureContentEnabled: u.matureContentEnabled,
    memoryEnabled: u.memoryEnabled,
    chatModel: u.chatModel,
    responseStyle: u.responseStyle,
    prefs: u.prefs,
    deletionRequestedAt: u.deletionRequestedAt,
    createdAt: u.createdAt,
  };
}
export type PublicUser = ReturnType<typeof toPublicUser>;

export async function updateProfile(user: AppUser, input: z.infer<typeof profileSchema>) {
  const { displayName, avatarUrl, prefs, ...rest } = input;
  const data: Partial<typeof schema.user.$inferInsert> = { ...rest };
  if (displayName !== undefined) data.name = displayName;
  if (avatarUrl !== undefined) data.image = avatarUrl === "" ? null : avatarUrl;
  if (prefs) data.prefs = { ...user.prefs, ...prefs };
  // Mature content requires an explicit 18+ confirmation.
  const adult = input.ageConfirmed18 ?? user.ageConfirmed18;
  if (!adult) data.matureContentEnabled = false;
  // Only models this deployment actually offers can be saved.
  if (input.chatModel !== undefined && !availableModels().some((m) => m.id === input.chatModel)) {
    throw new AppError("validation_failed", "That AI model is not available");
  }
  if (!Object.keys(data).length) return;
  await db.update(schema.user).set(data).where(eq(schema.user.id, user.id));
}

/** Check the account password (used before destructive actions). */
export async function checkPassword(userId: string, password: string) {
  const [acct] = await db
    .select({ hash: schema.account.password })
    .from(schema.account)
    .where(and(eq(schema.account.userId, userId), eq(schema.account.providerId, "credential")));
  if (!acct?.hash) return false;
  const ctx = await auth.$context;
  return ctx.password.verify({ hash: acct.hash, password });
}

/** Starts a grace period; the account is permanently erased afterwards (see processDueDeletions). */
export async function requestAccountDeletion(user: AppUser, currentPassword: string) {
  if (!(await checkPassword(user.id, currentPassword))) throw new AppError("validation_failed", "Password is incorrect");
  await db.update(schema.user).set({ status: "deletion_requested", deletionRequestedAt: new Date() }).where(eq(schema.user.id, user.id));
  await audit({ actorId: user.id, action: "user.deletion_requested", targetType: "user", targetId: user.id });
}

export async function cancelAccountDeletion(user: AppUser) {
  if (user.status !== "deletion_requested") throw new AppError("conflict", "No deletion request is pending");
  await db.update(schema.user).set({ status: "active", deletionRequestedAt: null }).where(eq(schema.user.id, user.id));
  await audit({ actorId: user.id, action: "user.deletion_cancelled", targetType: "user", targetId: user.id });
}

/**
 * Permanently erase a user and everything they own (cascading deletes).
 * Payment rows must stay traceable for accounting (restrict FK), so accounts that
 * ever paid are anonymised instead: content and personal data go, the row stays.
 */
export async function eraseUser(userId: string, actorId: string | null) {
  const [paid] = await db.select({ id: schema.payment.id }).from(schema.payment).where(eq(schema.payment.userId, userId)).limit(1);
  if (paid) {
    // keep the user row (payments reference it) but remove personal data and content
    await db.transaction(async (tx) => {
      await tx.delete(schema.character).where(eq(schema.character.ownerId, userId));
      await tx.delete(schema.conversation).where(eq(schema.conversation.userId, userId));
      await tx.delete(schema.memory).where(eq(schema.memory.userId, userId));
      await tx.delete(schema.image).where(eq(schema.image.ownerId, userId));
      await tx.delete(schema.session).where(eq(schema.session.userId, userId));
      await tx.delete(schema.account).where(eq(schema.account.userId, userId));
      await tx.delete(schema.twoFactor).where(eq(schema.twoFactor.userId, userId));
      await tx.delete(schema.userRole).where(eq(schema.userRole.userId, userId));
      await tx
        .update(schema.user)
        .set({ name: "Deleted user", email: `deleted-${userId}@erased.invalid`, image: null, bio: "", status: "active", bannedAt: new Date(), bannedReason: "erased", deletionRequestedAt: null, twoFactorEnabled: false })
        .where(eq(schema.user.id, userId));
    });
  } else {
    await db.delete(schema.user).where(eq(schema.user.id, userId));
  }
  await audit({ actorId, action: "user.erased", targetType: "user", targetId: userId, details: { anonymised: Boolean(paid) } });
}

export async function processDueDeletions(now = new Date()) {
  const cutoff = new Date(now.getTime() - DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000);
  const due = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(and(eq(schema.user.status, "deletion_requested"), lte(schema.user.deletionRequestedAt, cutoff)));
  for (const u of due) await eraseUser(u.id, null);
  return due.length;
}
