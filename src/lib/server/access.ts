import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { NEEDS_2FA, can, type Permission, type Role } from "@/lib/permissions";
import { auth } from "./auth";
import { AppError } from "./errors";

type UserRow = typeof schema.user.$inferSelect;

/**
 * The signed-in user as the app sees them: the database row plus
 * - `roles`: roles that count right now (staff roles are dormant until 2FA is on)
 * - `allRoles`: every role they hold
 * - `status`: effective status ("suspended" when banned)
 * - `displayName` / `avatarUrl`: friendlier names for `name` / `image`
 */
export type AppUser = Omit<UserRow, "status"> & {
  status: "active" | "restricted" | "deletion_requested" | "suspended";
  roles: Role[];
  allRoles: Role[];
  displayName: string;
  avatarUrl: string | null;
};

/** 2FA can be relaxed for local development only (never in production). */
const twoFactorRequired = () => process.env.NODE_ENV === "production" || process.env.ADMIN_2FA_OPTIONAL !== "1";

/** Roles that actually count right now: high-privilege roles are dormant until 2FA is on. */
export function activeRoles(u: { allRoles: Role[]; twoFactorEnabled: boolean }): Role[] {
  if (u.twoFactorEnabled || !twoFactorRequired()) return u.allRoles;
  return u.allRoles.filter((r) => !NEEDS_2FA.includes(r));
}

export async function loadAppUser(userId: string): Promise<AppUser | null> {
  const [[u], roles] = await Promise.all([
    db.select().from(schema.user).where(eq(schema.user.id, userId)),
    db.select({ role: schema.userRole.role }).from(schema.userRole).where(eq(schema.userRole.userId, userId)),
  ]);
  if (!u) return null;
  const allRoles: Role[] = ["member", ...roles.map((r) => r.role).filter((r) => r !== "member")];
  const base = { ...u, allRoles, displayName: u.name, avatarUrl: u.image, status: (u.bannedAt ? "suspended" : u.status) as AppUser["status"] };
  return { ...base, roles: activeRoles(base) };
}

/** Current user for this request (memoised), or null. Suspended users are returned with status "suspended". */
export const currentUser = cache(async (): Promise<AppUser | null> => {
  const s = await auth.api.getSession({ headers: await headers() });
  if (!s) return null;
  return loadAppUser(s.user.id);
});

// ---------- API / server action guards (throw AppError) ----------

/** Require a signed-in user whose account is not suspended. */
export async function requireUser(): Promise<AppUser> {
  const user = await currentUser();
  if (!user) throw new AppError("unauthenticated", "Please sign in to continue");
  if (user.status === "suspended") throw new AppError("account_restricted", "This account is suspended");
  return user;
}

/** Require a user who may perform write actions (not restricted or pending deletion). */
export async function requireActiveUser(): Promise<AppUser> {
  const user = await requireUser();
  assertCanAct(user);
  return user;
}

export function assertCanAct(user: Pick<AppUser, "status">) {
  if (user.status === "suspended") throw new AppError("account_restricted", "This account is suspended");
  if (user.status === "restricted") throw new AppError("account_restricted", "Your account is currently restricted");
  if (user.status === "deletion_requested") {
    throw new AppError("account_restricted", "Your account is scheduled for deletion. Cancel the request to continue.");
  }
}

export type Denied = "signin" | "2fa" | "forbidden";

/** Check a permission. Returns the user, or why access is denied. */
export async function check(p: Permission): Promise<{ user: AppUser } | { denied: Denied }> {
  const u = await currentUser();
  if (!u || u.status === "suspended") return { denied: "signin" };
  if (can(u.roles, p)) return { user: u };
  // they would have it with 2FA on
  if (can(u.allRoles, p)) return { denied: "2fa" };
  return { denied: "forbidden" };
}

export async function requirePermission(p: Permission): Promise<AppUser> {
  const r = await check(p);
  if ("user" in r) return r.user;
  if (r.denied === "signin") throw new AppError("unauthenticated", "Please sign in to continue");
  if (r.denied === "2fa") throw new AppError("forbidden", "Turn on two-step sign-in (2FA) to use staff tools");
  throw new AppError("forbidden", "You do not have permission to do that");
}

// ---------- page helpers (redirect) ----------

/** For pages that need sign-in: redirects guests to the login page. */
export async function pageUser(next?: string): Promise<AppUser> {
  const user = await currentUser();
  if (!user) redirect(`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  if (user.status === "suspended") redirect("/login?suspended=1");
  return user;
}

/**
 * For admin pages: guests go to login; staff whose role is dormant (no 2FA yet) go to
 * the 2FA setup; users without the permission are sent away (no hint the page exists).
 */
export async function pageStaff(p: Permission): Promise<AppUser> {
  await pageUser("/admin");
  const r = await check(p);
  if ("user" in r) return r.user;
  if (r.denied === "2fa") redirect("/profile?need2fa=1#security");
  redirect("/discover");
}
