import { NextResponse } from "next/server";
import { lt } from "drizzle-orm";
import { db, schema } from "@/db";
import { processDueDeletions } from "@/lib/server/users";
import { logger } from "@/lib/server/logger";
import { purgeExpiredRateLimits } from "@/lib/server/rateLimit";
import { reconcilePayments } from "@/lib/server/payments/reconcile";
import { cronAuthorized } from "@/lib/server/cron";

export const dynamic = "force-dynamic";

/**
 * Daily maintenance (vercel.json): settles payments whose webhook never arrived,
 * erases accounts past their deletion grace period, and purges expired sessions,
 * verification tokens, old memories and rate-limit windows.
 */
async function handler(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const now = new Date();
  const payments = await reconcilePayments().catch((e) => ({ error: String((e as Error).message) }));
  const erased = await processDueDeletions(now);
  const sessions = await db.delete(schema.session).where(lt(schema.session.expiresAt, now)).returning({ id: schema.session.id });
  const tokens = await db.delete(schema.verification).where(lt(schema.verification.expiresAt, now)).returning({ id: schema.verification.id });
  const memories = await db
    .delete(schema.memory)
    .where(lt(schema.memory.expiresAt, new Date(now.getTime() - 30 * 86400000)))
    .returning({ id: schema.memory.id });
  const rateLimits = await purgeExpiredRateLimits(now.getTime());
  const result = { payments, erasedAccounts: erased, purgedSessions: sessions.length, purgedTokens: tokens.length, purgedExpiredMemories: memories.length, purgedRateLimits: rateLimits };
  logger.info("maintenance_run", result);
  return NextResponse.json(result);
}

export const GET = handler;
export const POST = handler;
