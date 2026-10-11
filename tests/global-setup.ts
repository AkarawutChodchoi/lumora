import { execSync } from "node:child_process";
import path from "node:path";
import { testDatabaseUrl, testDirectUrl } from "./test-db-url";

// Bring the dedicated test schema up to date with the real migrations.
// Non-destructive on purpose: every test creates its own uniquely named users and
// characters, so tests never depend on an empty database and nothing is wiped.
export default function setup() {
  const url = testDatabaseUrl();
  if (!url.includes("schema=lumora_test")) {
    throw new Error("Refusing to migrate a database that is not the lumora_test schema");
  }
  execSync("npx prisma migrate deploy", {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: testDirectUrl() },
    stdio: "pipe",
  });
}
