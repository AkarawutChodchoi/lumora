// Grant or remove a staff role from the command line (the first admin is made this way).
//   npm run role -- grant you@example.com admin
//   npm run role -- revoke someone@example.com moderator
//   npm run role -- list you@example.com
// The account must already exist (sign up on the site first). Staff powers stay
// dormant until that account turns on two-step sign-in in Profile → Security.
import { config } from "dotenv";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/db/schema.ts";

config({ path: process.env.ENV_FILE ?? ".env.local", quiet: true });
const STAFF = ["moderator", "finance", "admin"] as const;
type Staff = (typeof STAFF)[number];

const [cmd, emailArg, roleArg] = process.argv.slice(2);
const email = emailArg?.trim().toLowerCase();
if (!["grant", "revoke", "list"].includes(cmd ?? "") || !email || (cmd !== "list" && !STAFF.includes(roleArg as Staff))) {
  console.error("usage: npm run role -- grant|revoke <email> moderator|finance|admin   |   npm run role -- list <email>");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL, max: 1 });
const db = drizzle(pool, { schema });
try {
  const [u] = await db.select().from(schema.user).where(eq(schema.user.email, email));
  if (!u) throw new Error(`no account for ${email} — sign up on the site first`);
  if (cmd === "grant") {
    await db.insert(schema.userRole).values({ userId: u.id, role: roleArg as Staff }).onConflictDoNothing();
    await db.insert(schema.auditLog).values({ action: "user.role_granted", targetType: "user", targetId: u.id, after: { role: roleArg }, reason: "grant-role script" });
    await db.delete(schema.session).where(eq(schema.session.userId, u.id));
  } else if (cmd === "revoke") {
    await db.delete(schema.userRole).where(and(eq(schema.userRole.userId, u.id), eq(schema.userRole.role, roleArg as Staff)));
    await db.insert(schema.auditLog).values({ action: "user.role_removed", targetType: "user", targetId: u.id, after: { role: roleArg }, reason: "grant-role script" });
    await db.delete(schema.session).where(eq(schema.session.userId, u.id));
  }
  const roles = await db.select({ role: schema.userRole.role }).from(schema.userRole).where(eq(schema.userRole.userId, u.id));
  console.log(`${email}: ${roles.map((r) => r.role).join(", ") || "member"} · 2FA ${u.twoFactorEnabled ? "on" : "OFF (staff powers stay off until it is turned on)"}`);
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
