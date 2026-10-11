import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { setProviderOverride } from "@/server/ai/registry";
import { hashToken, newToken } from "@/server/auth/tokens";
import { AppError } from "@/server/errors";
import { rateLimit, resetRateLimit } from "@/server/rate-limit";
import { cancelGeneration, prepareGeneration, runGeneration, type ChatStreamEvent } from "@/server/services/chat";
import { getOwnedConversation, listMessages, startConversation } from "@/server/services/conversations";
import { getBalance, verifyLedgerConsistency } from "@/server/services/credits";
import { authenticate, changePassword, confirmPasswordReset } from "@/server/services/users";
import { SIGNUP_BONUS } from "@/server/domain/catalog";
import { makeCharacter, makeUser, MockProvider, rid } from "./helpers";

afterEach(() => setProviderOverride(null));

describe("rate limiting", () => {
  it("counts hits in the shared store and blocks past the limit", async () => {
    const key = `test:${rid()}`;
    for (let i = 0; i < 3; i++) await rateLimit(key, 3, 60_000);
    await expect(rateLimit(key, 3, 60_000)).rejects.toMatchObject({ code: "rate_limited" });
    await resetRateLimit(key);
    await expect(rateLimit(key, 3, 60_000)).resolves.toBeUndefined();
  });

  it("starts a new window once the old one has ended", async () => {
    const key = `test:${rid()}`;
    await rateLimit(key, 1, 50);
    await new Promise((r) => setTimeout(r, 120));
    await expect(rateLimit(key, 1, 50)).resolves.toBeUndefined();
  });

  it("does not lose hits when requests arrive at the same time", async () => {
    const key = `test:${rid()}`;
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => rateLimit(key, 5, 60_000)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);
  });
});

async function resetLink(userId: string) {
  const token = newToken();
  await db.passwordResetToken.create({ data: { userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 30 * 60_000) } });
  return token;
}

describe("password reset links", () => {
  it("can be used only once, even by two requests at the same time", async () => {
    const user = await makeUser();
    const token = await resetLink(user.id);
    const results = await Promise.allSettled([
      confirmPasswordReset({ token, newPassword: "newpass111" }),
      confirmPasswordReset({ token, newPassword: "newpass222" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await expect(confirmPasswordReset({ token, newPassword: "newpass333" })).rejects.toBeInstanceOf(AppError);
  });

  it("other outstanding links stop working after a reset", async () => {
    const user = await makeUser();
    const first = await resetLink(user.id);
    const second = await resetLink(user.id);
    await confirmPasswordReset({ token: first, newPassword: "newpass111" });
    await expect(confirmPasswordReset({ token: second, newPassword: "attacker99" })).rejects.toBeInstanceOf(AppError);
    await expect(authenticate({ email: user.email, password: "newpass111" })).resolves.toMatchObject({ id: user.id });
  });

  it("a link requested before a password change cannot undo it", async () => {
    const user = await makeUser();
    const token = await resetLink(user.id);
    await changePassword(user, { currentPassword: "password123", newPassword: "changed123" });
    await expect(confirmPasswordReset({ token, newPassword: "attacker99" })).rejects.toBeInstanceOf(AppError);
  });
});

async function chatSetup() {
  const user = await makeUser();
  const owner = await makeUser();
  const character = await makeCharacter(owner, {}, "public");
  const conv = await startConversation(user, character.id);
  return { user, conv };
}

describe("replies that run out of time", () => {
  it("keeps the text written so far when the deadline hits mid-reply", async () => {
    const { user, conv } = await chatSetup();
    // Deadline is wall-clock from the start (including database setup), so leave room.
    setProviderOverride(new MockProvider(["Once ", "upon ", "a ", "time", "...", "..."], null, 2500));
    const prepared = await prepareGeneration(user, conv.id, { mode: "send", content: "Tell a story", clientRequestId: rid() });
    const events: ChatStreamEvent[] = [];
    await runGeneration(user, prepared, (e) => events.push(e), { deadlineMs: 8000 });

    expect(events.at(-1)?.type).toBe("done");
    const last = (await listMessages(user, conv.id, { limit: 30 })).items.at(-1)!;
    expect(last.status).toBe("completed");
    expect(last.content.startsWith("Once ")).toBe(true);
    const gen = await db.generation.findUniqueOrThrow({ where: { id: prepared.generationId } });
    expect(gen).toMatchObject({ status: "completed", errorCode: "truncated" });
    expect((await getOwnedConversation(user, conv.id)).activeGenerationId).toBeNull();
    expect(await getBalance(user.id)).toBe(SIGNUP_BONUS - 1);
  });

  it("refunds and unlocks when nothing arrived before the deadline", async () => {
    const { user, conv } = await chatSetup();
    setProviderOverride(new MockProvider(["late"], null, 600));
    const prepared = await prepareGeneration(user, conv.id, { mode: "send", content: "Hello", clientRequestId: rid() });
    const events: ChatStreamEvent[] = [];
    await runGeneration(user, prepared, (e) => events.push(e), { deadlineMs: 200 });

    expect(events.at(-1)).toMatchObject({ type: "error", code: "timeout" });
    expect(await getBalance(user.id)).toBe(SIGNUP_BONUS);
    expect((await getOwnedConversation(user, conv.id)).activeGenerationId).toBeNull();
    expect((await verifyLedgerConsistency(user.id)).consistent).toBe(true);
  });
});

describe("one final outcome per reply", () => {
  it("a reply closed out by Stop is not later marked completed by its worker", async () => {
    const { user, conv } = await chatSetup();
    // The worker is slow to notice: it keeps streaming while Stop closes the reply out.
    setProviderOverride(new MockProvider(["a", "b", "c", "d", "e", "f"], null, 900));
    const prepared = await prepareGeneration(user, conv.id, { mode: "send", content: "Hello", clientRequestId: rid() });
    const worker = runGeneration(user, prepared, () => {});
    const cancelled = await cancelGeneration(user, prepared.generationId);
    await worker;
    const gen = await db.generation.findUniqueOrThrow({ where: { id: prepared.generationId } });
    expect(gen.status).toBe(cancelled.status);
    expect(gen.status).toBe("cancelled");
    expect((await verifyLedgerConsistency(user.id)).consistent).toBe(true);
    // Charged once, refunded at most once.
    const rows = await db.creditLedger.findMany({ where: { referenceId: prepared.generationId } });
    expect(rows.filter((r) => r.type === "generation_refund").length).toBeLessThanOrEqual(1);
  });
});
