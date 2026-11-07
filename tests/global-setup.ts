import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import { Pool } from "pg";
import { testDatabaseUrl } from "./test-db-url";

// Bring the test database up to date with the real migrations. Non-destructive on
// purpose: every test creates its own uniquely named users and characters.
export default async function setup() {
  const url = testDatabaseUrl();
  if (/production|\/neondb(\?|$)|\/lumora_v2_dev(\?|$)/.test(url)) throw new Error("Refusing to run tests against a non-test database");
  const pool = new Pool({ connectionString: url, max: 1 });
  await migrate(drizzle(pool), { migrationsFolder: path.resolve(__dirname, "../drizzle") });
  await pool.end();
}
