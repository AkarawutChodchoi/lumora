import { loadEnv } from "vite";

/**
 * Tests run against PostgreSQL in a dedicated schema ("lumora_test") of the database
 * in TEST_DATABASE_URL, or of DATABASE_URL from .env (use a dev branch, never production).
 * The schema is migrated (never wiped) before each run; tests use unique data (tests/global-setup.ts).
 */
export function testDatabaseUrl(): string {
  const env = loadEnv("test", process.cwd(), "");
  const base = env.TEST_DATABASE_URL || env.DATABASE_URL;
  if (!base || !base.startsWith("postgres")) {
    throw new Error("Set DATABASE_URL (or TEST_DATABASE_URL) in .env to a PostgreSQL dev database to run tests.");
  }
  const url = new URL(base);
  url.searchParams.set("schema", "lumora_test");
  return url.toString();
}

/** Direct (non-pooled) variant for migrations: Neon pooler hosts contain "-pooler". */
export function testDirectUrl(): string {
  const url = new URL(testDatabaseUrl());
  url.hostname = url.hostname.replace("-pooler.", ".");
  return url.toString();
}
