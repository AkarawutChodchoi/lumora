import { loadEnv } from "vite";

/**
 * Tests run against their own PostgreSQL database: TEST_DATABASE_URL (or DATABASE_URL
 * in CI). Use a dev database, never production. It is migrated (never wiped) before
 * each run; tests create uniquely named data (tests/global-setup.ts).
 */
export function testDatabaseUrl(): string {
  const env = { ...loadEnv("test", process.cwd(), ""), ...process.env };
  const url = env.TEST_DATABASE_URL || (env.CI ? env.DATABASE_URL : "");
  if (!url || !url.startsWith("postgres")) {
    throw new Error("Set TEST_DATABASE_URL in .env.local to a PostgreSQL test database to run tests.");
  }
  return url;
}
