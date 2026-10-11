import { Prisma, type User } from "@prisma/client";
import { z } from "zod";
import { availableModels } from "../ai/models";
import { db } from "../db";
import { AppError } from "../errors";
import { logger } from "../logger";
import { config } from "../config";
import { burnPasswordCheck, hashPassword, verifyPassword } from "../auth/password";
import { hashToken, newToken } from "../auth/tokens";
import { revokeAllSessions } from "../auth/session";
import { grantSignupBonus } from "./credits";
import { getFeatureFlags } from "./settings";
import { audit } from "./audit";
import { IMAGE_PATH } from "./images";

export const DELETION_GRACE_DAYS = 7;

const password = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password is too long")
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), "Use at least one letter and one number");

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(254),
  password,
  displayName: z.string().trim().min(2, "Name must be at least 2 characters").max(40),
  ageConfirmed: z.literal(true, { message: "You must be at least 13 years old to use Lumora" }),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(128),
});

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
  })
  .partial();

export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: password });
export const resetRequestSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254) });
export const resetConfirmSchema = z.object({ token: z.string().min(20).max(200), newPassword: password });

/** Fields that are safe to send to the owner. Never includes the password hash. */
export function toPublicUser(u: User) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    bio: u.bio,
    avatarUrl: u.avatarUrl,
    role: u.role,
    status: u.status,
    ageConfirmed18: u.ageConfirmed18,
    matureContentEnabled: u.matureContentEnabled,
    memoryEnabled: u.memoryEnabled,
    chatModel: u.chatModel,
    responseStyle: u.responseStyle,
    deletionRequestedAt: u.deletionRequestedAt,
    createdAt: u.createdAt,
  };
}
export type PublicUser = ReturnType<typeof toPublicUser>;

export async function registerUser(input: z.infer<typeof registerSchema>) {
  const flags = await getFeatureFlags();
  if (!flags.registrationOpen) throw new AppError("forbidden", "Registration is temporarily closed");
  const passwordHash = await hashPassword(input.password);
  try {
    return await db.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { email: input.email, passwordHash, displayName: input.displayName } });
      await grantSignupBonus(tx, user.id);
      return user;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new AppError("conflict", "An account with this email already exists");
    }
    throw err;
  }
}

export async function authenticate(input: z.infer<typeof loginSchema>) {
  const user = await db.user.findUnique({ where: { email: input.email } });
  if (!user) {
    await burnPasswordCheck(input.password);
    throw new AppError("unauthenticated", "Incorrect email or password");
  }
  if (!(await verifyPassword(user.passwordHash, input.password))) {
    throw new AppError("unauthenticated", "Incorrect email or password");
  }
  if (user.status === "suspended") throw new AppError("account_restricted", "This account is suspended");
  await db.user.update({ where: { id: user.id }, data: { lastActiveAt: new Date() } });
  return user;
}

export async function updateProfile(user: User, input: z.infer<typeof profileSchema>) {
  const data: Prisma.UserUpdateInput = { ...input, avatarUrl: input.avatarUrl === "" ? null : input.avatarUrl };
  // Mature content requires an explicit 18+ confirmation.
  const adult = input.ageConfirmed18 ?? user.ageConfirmed18;
  if (!adult) data.matureContentEnabled = false;
  // Only models this deployment actually offers can be saved.
  if (input.chatModel !== undefined && !availableModels().some((m) => m.id === input.chatModel)) {
    throw new AppError("validation_failed", "That AI model is not available");
  }
  return db.user.update({ where: { id: user.id }, data });
}

export async function changePassword(user: User, input: z.infer<typeof changePasswordSchema>) {
  if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
    throw new AppError("validation_failed", "Current password is incorrect");
  }
  await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(input.newPassword) } });
  await revokeAllSessions(user.id);
}

/** Always responds the same way whether or not the email exists (no account enumeration). */
export async function requestPasswordReset(email: string) {
  const user = await db.user.findUnique({ where: { email } });
  if (!user) return;
  const token = newToken();
  await db.passwordResetToken.create({
    data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 30 * 60 * 1000) },
  });
  const link = `${config().APP_URL}/reset-password?token=${token}`;
  if (config().EMAIL_PROVIDER) {
    // Email delivery adapter goes here once a provider is configured.
    logger.warn("email_provider_not_implemented", { provider: config().EMAIL_PROVIDER });
  } else if (config().NODE_ENV !== "production") {
    // Development only: there is no email service, so print the link locally.
    console.log(`\n[DEV ONLY] Password reset link for ${email}: ${link}\n`);
  } else {
    logger.warn("password_reset_email_unavailable", { userId: user.id });
  }
}

export async function confirmPasswordReset(input: z.infer<typeof resetConfirmSchema>) {
  const row = await db.passwordResetToken.findUnique({ where: { tokenHash: hashToken(input.token) } });
  if (!row || row.usedAt || row.expiresAt <= new Date()) {
    throw new AppError("validation_failed", "This reset link is invalid or has expired");
  }
  await db.$transaction([
    db.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
    db.user.update({ where: { id: row.userId }, data: { passwordHash: await hashPassword(input.newPassword) } }),
  ]);
  await revokeAllSessions(row.userId);
}

/** Starts a grace period; the account is permanently erased afterwards (see processDueDeletions). */
export async function requestAccountDeletion(user: User, currentPassword: string) {
  if (!(await verifyPassword(user.passwordHash, currentPassword))) {
    throw new AppError("validation_failed", "Password is incorrect");
  }
  await db.user.update({ where: { id: user.id }, data: { status: "deletion_requested", deletionRequestedAt: new Date() } });
  await audit({ actorId: user.id, action: "user.deletion_requested", targetType: "user", targetId: user.id });
}

export async function cancelAccountDeletion(user: User) {
  if (user.status !== "deletion_requested") throw new AppError("conflict", "No deletion request is pending");
  await db.user.update({ where: { id: user.id }, data: { status: "active", deletionRequestedAt: null } });
  await audit({ actorId: user.id, action: "user.deletion_cancelled", targetType: "user", targetId: user.id });
}

/** Permanently erase a user and everything they own (cascading deletes). */
export async function eraseUser(userId: string, actorId: string | null) {
  await db.user.delete({ where: { id: userId } });
  await audit({ actorId, action: "user.erased", targetType: "user", targetId: userId });
}

export async function processDueDeletions(now = new Date()) {
  const cutoff = new Date(now.getTime() - DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000);
  const due = await db.user.findMany({ where: { status: "deletion_requested", deletionRequestedAt: { lte: cutoff } }, select: { id: true } });
  for (const u of due) await eraseUser(u.id, null);
  return due.length;
}
