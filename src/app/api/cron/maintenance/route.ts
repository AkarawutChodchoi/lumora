import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { processDueDeletions } from "@/server/services/users";
import { db } from "@/server/db";
import { logger } from "@/server/logger";
import { purgeExpiredRateLimits } from "@/server/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Scheduled maintenance, called daily with `Authorization: Bearer $CRON_SECRET`
 * (Vercel Cron sends a GET with that header; see vercel.json): erases accounts past
 * their deletion grace period and purges expired tokens, sessions and rate-limit windows.
 */
async function handler(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const ok = secret.length >= 16 && given.length === secret.length && timingSafeEqual(Buffer.from(given), Buffer.from(secret));
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const now = new Date();
  const erased = await processDueDeletions(now);
  const sessions = await db.session.deleteMany({ where: { OR: [{ expiresAt: { lt: now } }, { revokedAt: { not: null } }] } });
  const tokens = await db.passwordResetToken.deleteMany({ where: { expiresAt: { lt: now } } });
  const memories = await db.memory.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 30 * 86400000) } } });
  const rateLimits = await purgeExpiredRateLimits(now);
  logger.info("maintenance_run", { erased, sessions: sessions.count, tokens: tokens.count, memories: memories.count, rateLimits });
  return NextResponse.json({ erasedAccounts: erased, purgedSessions: sessions.count, purgedResetTokens: tokens.count, purgedExpiredMemories: memories.count, purgedRateLimits: rateLimits });
}

export const GET = handler;
export const POST = handler;
