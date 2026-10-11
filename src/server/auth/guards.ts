import type { User } from "@prisma/client";
import { AppError } from "../errors";
import { can, type Permission } from "../domain/permissions";
import { getSessionUser } from "./session";

/** Require a signed-in user whose account is not suspended. */
export async function requireUser(): Promise<User> {
  const user = await getSessionUser();
  if (!user) throw new AppError("unauthenticated", "Please sign in to continue");
  if (user.status === "suspended") throw new AppError("account_restricted", "This account is suspended");
  return user;
}

/** Require a user who may perform write actions (not restricted or pending deletion). */
export async function requireActiveUser(): Promise<User> {
  const user = await requireUser();
  assertCanAct(user);
  return user;
}

export function assertCanAct(user: Pick<User, "status">) {
  if (user.status === "restricted") throw new AppError("account_restricted", "Your account is currently restricted");
  if (user.status === "deletion_requested") {
    throw new AppError("account_restricted", "Your account is scheduled for deletion. Cancel the request to continue.");
  }
}

export async function requirePermission(permission: Permission): Promise<User> {
  const user = await requireUser();
  if (!can(user.role, permission)) throw new AppError("forbidden", "You do not have permission to do that");
  return user;
}
