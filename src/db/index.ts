import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// node-postgres over Neon's pooled endpoint: plain TCP, interactive transactions,
// and it works the same against a local Postgres (CI). One pool per server instance.
const g = globalThis as unknown as { __lumoraPool?: Pool };
const url = process.env.DATABASE_URL ?? "postgresql://unset:unset@database-url-not-set.invalid/unset";

const pool =
  g.__lumoraPool ??
  new Pool({
    connectionString: url,
    max: process.env.VERCEL ? 3 : 10,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000,
  });
if (process.env.NODE_ENV !== "production") g.__lumoraPool = pool;

export const db = drizzle(pool, { schema });
export { schema };
export type DB = typeof db;
/** A transaction handle (same query API as `db`). */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Q = DB | Tx;

/** Error text including the driver's details (constraint names live there). */
export const dbError = (e: unknown) => {
  const x = e as { message?: string; constraint?: string; code?: string; cause?: { message?: string; constraint?: string; code?: string } };
  return [x?.message, x?.constraint, x?.code, x?.cause?.message, x?.cause?.constraint, x?.cause?.code].filter(Boolean).join(" ");
};

/** True when `e` is a unique-constraint violation (Postgres 23505). */
export const isUniqueViolation = (e: unknown) => {
  const x = e as { code?: string; cause?: { code?: string } };
  return x?.code === "23505" || x?.cause?.code === "23505";
};
