import "server-only";
import { createHash } from "node:crypto";
import { like, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { AppError } from "./errors";
import { logger } from "./logger";

/**
 * Fixed-window counter in Postgres (no Redis needed at this size), shared by every
 * server instance. Uses the same table as better-auth with an "app:" key prefix so
 * the two never collide. Keys can contain emails or IPs, so only a hash is stored.
 * If the database call fails, a per-instance in-memory window is used instead.
 */
export async function allow(key: string, max: number, windowMs: number) {
  return (await hit(key, windowMs)).count <= max;
}

/** Like allow(), but throws a 429 AppError with a retry hint when over the limit. */
export async function rateLimit(key: string, max: number, windowMs: number): Promise<void> {
  const { count, startedAt } = await hit(key, windowMs);
  if (count > max) {
    const retryAfter = Math.max(1, Math.ceil((startedAt + windowMs - Date.now()) / 1000));
    throw new AppError("rate_limited", `Too many requests. Try again in ${retryAfter}s.`, { retryAfter });
  }
}

const hashKey = (key: string) => "app:" + createHash("sha256").update(key).digest("hex");

async function hit(key: string, windowMs: number) {
  const now = Date.now();
  try {
    const rows = await db.execute<{ count: number; last_request: string }>(sql`
      insert into rate_limit (id, key, count, last_request)
      values (${crypto.randomUUID()}, ${hashKey(key)}, 1, ${now})
      on conflict (key) do update set
        count = case when ${now} - rate_limit.last_request > ${windowMs} then 1 else rate_limit.count + 1 end,
        last_request = case when ${now} - rate_limit.last_request > ${windowMs} then ${now} else rate_limit.last_request end
      returning count, last_request`);
    return { count: Number(rows.rows[0]?.count ?? 0), startedAt: Number(rows.rows[0]?.last_request ?? now) };
  } catch (err) {
    logger.warn("rate_limit_store_unavailable", { error: err instanceof Error ? err.message : "unknown" });
    return hitMemory(key, now, windowMs);
  }
}

const buckets = new Map<string, { count: number; startedAt: number }>();

function hitMemory(key: string, now: number, windowMs: number) {
  let b = buckets.get(key);
  if (!b || now - b.startedAt > windowMs) {
    b = { count: 0, startedAt: now };
    buckets.set(key, b);
    if (buckets.size > 10_000) for (const [k, x] of buckets) if (now - x.startedAt > windowMs) buckets.delete(k);
  }
  b.count += 1;
  return { ...b };
}

/** Clear the counters for one key (tests and support tooling). */
export async function resetRateLimit(key: string) {
  buckets.delete(key);
  await db.delete(schema.rateLimit).where(sql`${schema.rateLimit.key} = ${hashKey(key)}`);
}

/** Delete app windows idle for a day (run from the maintenance job). */
export async function purgeExpiredRateLimits(now = Date.now()) {
  const r = await db
    .delete(schema.rateLimit)
    .where(sql`${like(schema.rateLimit.key, "app:%")} and ${schema.rateLimit.lastRequest} < ${now - 86_400_000}`)
    .returning({ id: schema.rateLimit.id });
  return r.length;
}
