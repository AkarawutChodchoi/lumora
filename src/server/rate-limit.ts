import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { AppError } from "./errors";
import { logger } from "./logger";

// Fixed-window limiter stored in the database, so the limit holds across serverless
// instances (an in-memory counter is per instance and resets on every cold start).
// If the database call fails, a per-instance in-memory window is used instead.

export async function rateLimit(key: string, limit: number, windowMs: number): Promise<void> {
  const now = new Date();
  let count: number;
  let resetAt: Date;
  try {
    ({ count, resetAt } = await hitDb(hashKey(key), now, windowMs));
  } catch (err) {
    logger.warn("rate_limit_store_unavailable", { error: err instanceof Error ? err.message : "unknown" });
    ({ count, resetAt } = hitMemory(key, now.getTime(), windowMs));
  }
  if (count > limit) {
    const retryAfter = Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000));
    throw new AppError("rate_limited", `Too many requests. Try again in ${retryAfter}s.`, { retryAfter });
  }
}

// Keys can contain emails or IPs; only a hash is stored.
function hashKey(key: string) {
  return createHash("sha256").update(key).digest("hex");
}

// Raw SQL is not schema-qualified by Prisma, and Neon's pooler ignores the URL's
// schema for search_path, so an unqualified table name would hit "public" (production)
// from the dev and test schemas. Qualify it with the schema from DATABASE_URL.
function bucketTable() {
  let schema = "public";
  try {
    schema = new URL(process.env.DATABASE_URL ?? "").searchParams.get("schema") || "public";
  } catch {
    /* not a URL — keep the default */
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) throw new Error("Invalid database schema name");
  return Prisma.raw(`"${schema}"."RateLimitBucket"`);
}

/** One atomic upsert: starts a new window when the old one has ended, otherwise counts this hit. */
async function hitDb(key: string, now: Date, windowMs: number) {
  const fresh = new Date(now.getTime() + windowMs);
  const table = bucketTable();
  const rows = await db.$queryRaw<{ count: number; resetAt: Date }[]>`
    INSERT INTO ${table} AS "RateLimitBucket" ("key", "count", "resetAt") VALUES (${key}, 1, ${fresh})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimitBucket"."resetAt" <= ${now} THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
      "resetAt" = CASE WHEN "RateLimitBucket"."resetAt" <= ${now} THEN EXCLUDED."resetAt" ELSE "RateLimitBucket"."resetAt" END
    RETURNING "count", "resetAt"`;
  return { count: Number(rows[0].count), resetAt: new Date(rows[0].resetAt) };
}

const buckets = new Map<string, { count: number; resetAt: number }>();

function hitMemory(key: string, now: number, windowMs: number) {
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
    if (buckets.size > 10_000) for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }
  bucket.count += 1;
  return { count: bucket.count, resetAt: new Date(bucket.resetAt) };
}

/** Clear the counters for one key (tests and support tooling). */
export async function resetRateLimit(key: string) {
  buckets.delete(key);
  await db.rateLimitBucket.deleteMany({ where: { key: hashKey(key) } });
}

/** Delete windows that have ended (run from the maintenance job). */
export async function purgeExpiredRateLimits(now = new Date()) {
  const res = await db.rateLimitBucket.deleteMany({ where: { resetAt: { lt: now } } });
  return res.count;
}
