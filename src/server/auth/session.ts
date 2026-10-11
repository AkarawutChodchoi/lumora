import { cookies } from "next/headers";
import type { User } from "@prisma/client";
import { db } from "../db";
import { hashToken, newToken } from "./tokens";
import { config } from "../config";

export const SESSION_COOKIE = "lumora_session";
// Fixed 30-day sessions: the cookie and the database row expire together.
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function createSession(userId: string, userAgent?: string | null) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.session.create({
    data: { userId, tokenHash: hashToken(token), expiresAt, userAgent: userAgent?.slice(0, 200) ?? null },
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // Secure whenever the site is served over HTTPS. Over plain http (e.g. testing on a
    // phone via the LAN IP) a Secure cookie would be rejected and login would silently fail.
    secure: config().APP_URL.startsWith("https://"),
    path: "/",
    expires: expiresAt,
  });
}

/** Resolve a user from a raw session token. Null when unknown, expired or revoked. */
export async function userFromToken(token: string | undefined): Promise<User | null> {
  if (!token) return null;
  const session = await db.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;
  return session.user;
}

/** The current user from the session cookie, or null. */
export async function getSessionUser(): Promise<User | null> {
  const jar = await cookies();
  return userFromToken(jar.get(SESSION_COOKIE)?.value);
}

export async function destroyCurrentSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.session.updateMany({ where: { tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: new Date() } });
  }
  jar.delete(SESSION_COOKIE);
}

export async function revokeAllSessions(userId: string) {
  await db.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}
