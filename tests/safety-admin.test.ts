import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createAppeal, createReport } from "@/server/services/reports";
import { decideAppeal, enforce, processDeletion, resolveReport } from "@/server/services/admin";
import { startConversation } from "@/server/services/conversations";
import { assertCanAct } from "@/server/auth/guards";
import { authenticate, requestAccountDeletion } from "@/server/services/users";
import { makeCharacter, makeUser } from "./helpers";

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
    const greeting = await db.message.findFirstOrThrow({ where: { conversationId: conv.id } });
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
    expect((await db.character.findUniqueOrThrow({ where: { id: c.id } })).publicationStatus).toBe("hidden");
    expect(await db.auditLog.count({ where: { action: "character.auto_hidden", targetId: c.id } })).toBe(1);
  });
});

describe("enforcement and admin authorization", () => {
  it("restricts, suspends and reinstates users with an audit trail", async () => {
    const mod = await makeUser({ role: "moderator" });
    const u = await makeUser();
    await enforce(mod, u.id, { action: "restriction", reason: "spamming reports" });
    const restricted = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(() => assertCanAct(restricted)).toThrow();
    await enforce(mod, u.id, { action: "suspension", reason: "repeated abuse" });
    await expect(authenticate({ email: u.email, password: "password123" })).rejects.toMatchObject({ code: "account_restricted" });
    await enforce(mod, u.id, { action: "reinstatement", reason: "appeal reviewed" });
    expect((await db.user.findUniqueOrThrow({ where: { id: u.id } })).status).toBe("active");
    expect(await db.auditLog.count({ where: { targetId: u.id, actorId: mod.id } })).toBe(3);
  });

  it("prevents moderators from acting on staff and anyone from acting on themselves", async () => {
    const mod = await makeUser({ role: "moderator" });
    const admin = await makeUser({ role: "admin" });
    await expect(enforce(mod, admin.id, { action: "suspension", reason: "trying it" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(enforce(admin, admin.id, { action: "warning", reason: "self test" })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("supports appeals that reinstate the account when accepted", async () => {
    const mod = await makeUser({ role: "moderator" });
    const u = await makeUser();
    await enforce(mod, u.id, { action: "restriction", reason: "suspicious activity" });
    const enf = await db.enforcement.findFirstOrThrow({ where: { userId: u.id } });
    const appeal = await createAppeal(u, { enforcementId: enf.id, message: "This was a misunderstanding, please review." });
    await expect(createAppeal(u, { enforcementId: enf.id, message: "Second appeal while first open" })).rejects.toMatchObject({ code: "conflict" });
    await decideAppeal(mod, appeal.id, { decision: "accepted", note: "Confirmed false positive" });
    expect((await db.user.findUniqueOrThrow({ where: { id: u.id } })).status).toBe("active");
  });

  it("resolves reports with the reviewer recorded", async () => {
    const owner = await makeUser();
    const reporter = await makeUser();
    const mod = await makeUser({ role: "moderator" });
    const c = await makeCharacter(owner, {}, "public");
    const r = await createReport(reporter, { targetType: "character", targetId: c.id, category: "spam", details: "" });
    await resolveReport(mod, r.id, { status: "dismissed", note: "Not spam" });
    expect(await db.report.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ status: "dismissed", resolvedById: mod.id });
  });
});

describe("account deletion", () => {
  it("requires the password, then erases all of the user's data when processed", async () => {
    const admin = await makeUser({ role: "admin" });
    const owner = await makeUser();
    const u = await makeUser();
    const c = await makeCharacter(owner, {}, "public");
    await startConversation(u, c.id);
    await expect(requestAccountDeletion(u, "wrong-password1")).rejects.toMatchObject({ code: "validation_failed" });
    await requestAccountDeletion(u, "password123");
    await processDeletion(admin, u.id);
    expect(await db.user.findUnique({ where: { id: u.id } })).toBeNull();
    expect(await db.conversation.count({ where: { userId: u.id } })).toBe(0);
    expect(await db.creditLedger.count({ where: { userId: u.id } })).toBe(0);
  });
});

describe("admin powers", () => {
  it("lets admins change roles, but not their own and not as a moderator", async () => {
    const { setRole } = await import("@/server/services/admin");
    const admin = await makeUser({ role: "admin" });
    const mod = await makeUser({ role: "moderator" });
    const u = await makeUser();
    await setRole(admin, u.id, { role: "moderator", reason: "trusted helper" });
    expect((await db.user.findUniqueOrThrow({ where: { id: u.id } })).role).toBe("moderator");
    await expect(setRole(admin, admin.id, { role: "user", reason: "oops" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(setRole(mod, u.id, { role: "admin", reason: "self promotion" })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("grants and ends Lumora Plus without payment, with an audit record", async () => {
    const { setPremium } = await import("@/server/services/admin");
    const { getEntitlements } = await import("@/server/services/entitlements");
    const admin = await makeUser({ role: "admin" });
    const u = await makeUser();
    await setPremium(admin, u.id, { days: 30, reason: "beta tester" });
    expect((await getEntitlements(u.id)).plan).toBe("premium");
    await setPremium(admin, u.id, { days: 0, reason: "test over" });
    expect((await getEntitlements(u.id)).plan).toBe("free");
    expect(await db.auditLog.count({ where: { targetId: u.id, action: { startsWith: "user.premium" } } })).toBe(2);
  });

  it("signs a user out everywhere", async () => {
    const { forceSignOut } = await import("@/server/services/admin");
    const admin = await makeUser({ role: "admin" });
    const u = await makeUser();
    await db.session.create({ data: { userId: u.id, tokenHash: `h-${u.id}`, expiresAt: new Date(Date.now() + 86400000) } });
    await forceSignOut(admin, u.id);
    expect(await db.session.count({ where: { userId: u.id, revokedAt: null } })).toBe(0);
  });

  it("erases an account only with the exact email, never an admin or yourself", async () => {
    const { eraseNow } = await import("@/server/services/admin");
    const admin = await makeUser({ role: "admin" });
    const other = await makeUser({ role: "admin" });
    const u = await makeUser();
    await expect(eraseNow(admin, u.id, "wrong@example.com")).rejects.toMatchObject({ code: "validation_failed" });
    await expect(eraseNow(admin, other.id, other.email)).rejects.toMatchObject({ code: "forbidden" });
    await expect(eraseNow(admin, admin.id, admin.email)).rejects.toMatchObject({ code: "forbidden" });
    await eraseNow(admin, u.id, u.email);
    expect(await db.user.findUnique({ where: { id: u.id } })).toBeNull();
  });

  it("lets admins (not moderators) edit and delete anyone's character, with an audit trail", async () => {
    const { updateCharacter, deleteCharacter } = await import("@/server/services/characters");
    const { characterInput } = await import("./helpers");
    const admin = await makeUser({ role: "admin" });
    const mod = await makeUser({ role: "moderator" });
    const owner = await makeUser();
    const c = await makeCharacter(owner, {}, "public");
    await expect(updateCharacter(mod, c.id, characterInput({ tagline: "edited by mod", visibility: "public" }))).rejects.toMatchObject({ code: "forbidden" });
    const edited = await updateCharacter(admin, c.id, characterInput({ tagline: "edited by admin", visibility: "public" }));
    expect(edited.tagline).toBe("edited by admin");
    await deleteCharacter(admin, c.id);
    expect(await db.character.findUnique({ where: { id: c.id } })).toBeNull();
    expect(await db.auditLog.count({ where: { targetId: c.id, action: { startsWith: "character.admin_" } } })).toBe(2);
  });

  it("counts open reports and appeals for the staff badge", async () => {
    const { staffInbox } = await import("@/server/services/admin");
    const before = await staffInbox();
    const owner = await makeUser();
    const c = await makeCharacter(owner, {}, "public");
    await createReport(await makeUser(), { targetType: "character", targetId: c.id, category: "spam", details: "" });
    expect((await staffInbox()).reports).toBe(before.reports + 1);
  });
});
