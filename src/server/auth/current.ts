import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@prisma/client";
import { getSessionUser } from "./session";
import { can, type Permission } from "../domain/permissions";

/** Current user for Server Components, memoised per request. */
export const currentUser = cache(getSessionUser);

/** For pages that need sign-in: redirects guests to the login page. */
export async function pageUser(next?: string): Promise<User> {
  const user = await currentUser();
  if (!user) redirect(`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  if (user.status === "suspended") redirect("/login?suspended=1");
  return user;
}

/** For admin pages: guests go to login, users without the permission get a 404-style redirect. */
export async function pageStaff(permission: Permission): Promise<User> {
  const user = await pageUser("/admin");
  if (!can(user.role, permission)) redirect("/discover");
  return user;
}
