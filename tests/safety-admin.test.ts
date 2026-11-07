import { describe, expect, it } from "vitest";
import { count, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { createAppeal, createReport } from "@/lib/server/reports";
import { decideAppeal, enforce, processDeletion, resolveReport } from "@/lib/server/admin";
import { startConversation } from "@/lib/server/conversations";
import { assertCanAct } from "@/lib/server/access";
import { requestAccountDeletion } from "@/lib/server/users";
import { auth } from "@/lib/server/auth";
import { auditCount, get, makeCharacter, makeUser, reload } from "./helpers";

describe("reporting", () => {
  it("lets a user report a character once and snapshots the content", async () => {
    const owner = await makeUser();
    const reporter = await makeUser();
    const c = await makeCharacter(owner, {}, "public");
    const r = await createReport(reporter, { targetType: "character", targetId: c.id, category: "harassment", details: "" });
    expect(JSON.parse(r.snapshot).name).toBe("Aria");
    expect(r.severity).toBe("medium");
    await expect(createReport(reporter, { targetType: "character", targetId: c.id, category: "spam", details: "" })).rejects.toMatchObject({ code: "conflict" });
  });

  it("only allows reporting messages from your own conversations", async () => {
    const owner = await makeUser();
    const alice = await makeUser();
    const bob = await makeUser();
    const c = await makeCharacter(owner, {}, "public");
    const conv = await startConversation(alice, c.id);
    const [greeting] = await db.select().from(schema.message).where(eq(schema.message.conversationId, conv.id));
    await expect(createReport(bob, { targetType: "message", targetId: greeting.id, category: "other", details: "" })).rejects.toMatchObject({ code: "not_found" });
    await expect(createReport(alice, { targetType: "message", targetId: greeting.id, category: "other", details: "" })).resolves.toBeTruthy();
  });

  it("auto-hides a character after several distinct high-severity reports", async () => {
    const owner = await makeUser();
    const c = await makeCharacter(owner, {}, "public");
    for (let i = 0; i < 3; i++) {
      const reporter = await makeUser();
      await createReport(reporter, { targetType: "character", targetId: c.id, category: "violence", details: "" });
    }
    expect((await get.character(c.id))!.publicationStatus).toBe("hidden");
    expect(await auditCount(c.id, "character.auto_hidden")).toBe(1);
  });
});

describe("enforcement and admin authorization", () => {
  it("restricts, suspends and reinstates users with an audit trail", async () => {
    const mod = await makeUser({ roles: ["moderator"] });
    const u = await makeUser();
    await enforce(mod, u.id, { action: "restriction", reason: "spamming reports" });
    const restricted = await reload(u);
    expect(() => assertCanAct(restricted)).toThrow();
    await enforce(mod, u.id, { action: "suspension", reason: "repeated abuse" });
    expect((await reload(u)).status).toBe("suspended");
    await enforce(mod, u.id, { action: "reinstatement", reason: "appeal reviewed" });
    expect((await reload(u)).status).toBe("active");
    expect(await auditCount(u.id, undefined, mod.id)).toBe(3);
  });

  it("prevents moderators from acting on staff and anyone from acting on themselves", async () => {
    const mod = await makeUser({ roles: ["moderator"] });
    const admin = await makeUser({ roles: ["admin"] });
    await expect(enforce(mod, admin.id, { action: "suspension", reason: "trying it" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(enforce(admin, admin.id, { action: "warning", reason: "self test" })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("supports appeals that reinstate the account when accepted", async () => {
    const mod = await makeUser({ roles: ["moderator"] });
    const u = await makeUser();
    await enforce(mod, u.id, { action: "restriction", reason: "suspicious activity" });
    const [enf] = await db.select().from(schema.enforcement).where(eq(schema.enforcement.userId, u.id));
    const appeal = await createAppeal(u, { enforcementId: enf.id, message: "This was a misunderstanding, please review." });
    await expect(createAppeal(u, { enforcementId: enf.id, message: "Second appeal while first open" })).rejects.toMatchObject({ code: "conflict" });
    await decideAppeal(mod, appeal.id, { decision: "accepted", note: "Confirmed false positive" });
    expect((await reload(u)).status).toBe("active");
  });

  it("resolves reports with the reviewer recorded", async () => {
    const owner = await makeUser();
    const reporter = await makeUser();
    const mod = await makeUser({ roles: ["moderator"] });
    const c = await makeCharacter(owner, {}, "public");
    const r = await createReport(reporter, { targetType: "character", targetId: c.id, category: "spam", details: "" });
    await resolveReport(mod, r.id, { status: "dismissed", note: "Not spam" });
    expect(await get.report(r.id)).toMatchObject({ status: "dismissed", resolvedById: mod.id });
  });
});

describe("account deletion", () => {
  it("requires the password, then erases all of the user's data when processed", async () => {
    const admin = await makeUser({ roles: ["admin"] });
    const owner = await makeUser();
    const u = await makeUser();
    const c = await makeCharacter(owner, {}, "public");
    await startConversation(u, c.id);
    await setPassword(u.id, "password123");
    await expect(requestAccountDeletion(u, "wrong-password1")).rejects.toMatchObject({ code: "validation_failed" });
    await requestAccountDeletion(u, "password123");
    await processDeletion(admin, u.id);
    expect(await get.user(u.id)).toBeUndefined();
    expect((await db.select({ n: count() }).from(schema.conversation).where(eq(schema.conversation.userId, u.id)))[0].n).toBe(0);
    expect((await db.select({ n: count() }).from(schema.coinLedger).where(eq(schema.coinLedger.userId, u.id)))[0].n).toBe(0);
  });
});

describe("admin powers", () => {
  it("lets admins change roles, but not their own and not as a moderator", async () => {
    const { setRole } = await import("@/lib/server/admin");
    const admin = await makeUser({ roles: ["admin"] });
    const mod = await makeUser({ roles: ["moderator"] });
    const u = await makeUser();
    await setRole(admin, u.id, { role: "moderator", grant: true, reason: "trusted helper" });
    expect((await reload(u)).allRoles).toContain("moderator");
    await setRole(admin, u.id, { role: "finance", grant: true, reason: "also helps with payments" });
    expect((await reload(u)).allRoles).toEqual(expect.arrayContaining(["moderator", "finance"]));
    await setRole(admin, u.id, { role: "moderator", grant: false, reason: "no longer needed" });
    expect((await reload(u)).allRoles).not.toContain("moderator");
    await expect(setRole(admin, admin.id, { role: "admin", grant: false, reason: "oops" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(setRole(mod, u.id, { role: "admin", grant: true, reason: "self promotion" })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("grants and ends Lumora Plus without payment, with an audit record", async () => {
    const { setPremium } = await import("@/lib/server/admin");
    const { getEntitlements } = await import("@/lib/server/entitlements");
    const admin = await makeUser({ roles: ["admin"] });
    const u = await makeUser();
    await setPremium(admin, u.id, { days: 30, reason: "beta tester" });
    expect((await getEntitlements(u.id)).plan).toBe("premium");
    await setPremium(admin, u.id, { days: 0, reason: "test over" });
    expect((await getEntitlements(u.id)).plan).toBe("free");
    expect(await auditCount(u.id, { startsWith: "user.premium" })).toBe(2);
  });

  it("signs a user out everywhere", async () => {
    const { forceSignOut } = await import("@/lib/server/admin");
    const admin = await makeUser({ roles: ["admin"] });
    const u = await makeUser();
    await db.insert(schema.session).values({ id: crypto.randomUUID(), userId: u.id, token: `t-${u.id}`, expiresAt: new Date(Date.now() + 86400000) });
    await forceSignOut(admin, u.id);
    expect((await db.select({ n: count() }).from(schema.session).where(eq(schema.session.userId, u.id)))[0].n).toBe(0);
  });

  it("erases an account only with the exact email, never an admin or yourself", async () => {
    const { eraseNow } = await import("@/lib/server/admin");
    const admin = await makeUser({ roles: ["admin"] });
    const other = await makeUser({ roles: ["admin"] });
    const u = await makeUser();
    await expect(eraseNow(admin, u.id, "wrong@example.com")).rejects.toMatchObject({ code: "validation_failed" });
    await expect(eraseNow(admin, other.id, other.email)).rejects.toMatchObject({ code: "forbidden" });
    await expect(eraseNow(admin, admin.id, admin.email)).rejects.toMatchObject({ code: "forbidden" });
    await eraseNow(admin, u.id, u.email);
    expect(await get.user(u.id)).toBeUndefined();
  });

  it("lets admins (not moderators) edit and delete anyone's character, with an audit trail", async () => {
    const { updateCharacter, deleteCharacter } = await import("@/lib/server/characters");
    const { characterInput } = await import("./helpers");
    const admin = await makeUser({ roles: ["admin"] });
    const mod = await makeUser({ roles: ["moderator"] });
    const owner = await makeUser();
    const c = await makeCharacter(owner, {}, "public");
    await expect(updateCharacter(mod, c.id, characterInput({ tagline: "edited by mod", visibility: "public" }))).rejects.toMatchObject({ code: "forbidden" });
    const edited = await updateCharacter(admin, c.id, characterInput({ tagline: "edited by admin", visibility: "public" }));
    expect(edited.tagline).toBe("edited by admin");
    await deleteCharacter(admin, c.id);
    expect(await get.character(c.id)).toBeUndefined();
    expect(await auditCount(c.id, { startsWith: "character.admin_" })).toBe(2);
  });

  it("counts open reports and appeals for the staff badge", async () => {
    const { staffInbox } = await import("@/lib/server/admin");
    const before = await staffInbox();
    const owner = await makeUser();
    const c = await makeCharacter(owner, {}, "public");
    await createReport(await makeUser(), { targetType: "character", targetId: c.id, category: "spam", details: "" });
    expect((await staffInbox()).reports).toBe(before.reports + 1);
  });
});

/** Give a test account a real password (credential account), hashed the way better-auth does it. */
async function setPassword(userId: string, password: string) {
  const ctx = await auth.$context;
  await db.insert(schema.account).values({ id: crypto.randomUUID(), accountId: userId, providerId: "credential", userId, password: await ctx.password.hash(password) });
}

describe("2FA requirement for staff", () => {
  it("staff roles stay dormant until 2FA is on", async () => {
    const mod = await makeUser({ roles: ["moderator"], twoFactorEnabled: false });
    const u = await makeUser();
    expect(mod.allRoles).toContain("moderator");
    expect(mod.roles).not.toContain("moderator");
    await expect(enforce(mod, u.id, { action: "warning", reason: "should be blocked" })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("a suspended account cannot open a new session", async () => {
    const mod = await makeUser({ roles: ["moderator"] });
    const u = await makeUser();
    await setPassword(u.id, "password123");
    await enforce(mod, u.id, { action: "suspension", reason: "repeated abuse" });
    const res = await auth.handler(
      new Request("http://localhost:3000/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000", "x-forwarded-for": `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
        body: JSON.stringify({ email: u.email, password: "password123" }),
      }),
    );
    expect(res.status).toBe(403);
    expect((await db.select({ n: count() }).from(schema.session).where(eq(schema.session.userId, u.id)))[0].n).toBe(0);
  });
});
