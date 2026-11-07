import { afterEach, describe, expect, it } from "vitest";
import { setProviderOverride } from "@/lib/server/ai/registry";
import { rateLimit, resetRateLimit } from "@/lib/server/rateLimit";
import { cancelGeneration, prepareGeneration, runGeneration, type ChatStreamEvent } from "@/lib/server/chat";
import { getOwnedConversation, listMessages, startConversation } from "@/lib/server/conversations";
import { getBalance, verifyLedgerConsistency } from "@/lib/server/wallet";
import { SIGNUP_BONUS } from "@/lib/domain/catalog";
import { genLedger, get, makeCharacter, makeUser, MockProvider, rid } from "./helpers";

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

describe("password rules (better-auth sign-up hook)", () => {
  it("needs a letter and a number", async () => {
    const { PASSWORD_RULE } = await import("@/lib/server/auth");
    expect(PASSWORD_RULE("password123")).toBe(true);
    expect(PASSWORD_RULE("12345678")).toBe(false);
    expect(PASSWORD_RULE("abcdefgh")).toBe(false);
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
    const gen = (await get.generation(prepared.generationId))!;
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
    const gen = (await get.generation(prepared.generationId))!;
    expect(gen.status).toBe(cancelled.status);
    expect(gen.status).toBe("cancelled");
    expect((await verifyLedgerConsistency(user.id)).consistent).toBe(true);
    // Charged once, refunded at most once.
    const rows = await genLedger(prepared.generationId);
    expect(rows.filter((r) => r.kind === "refund").length).toBeLessThanOrEqual(1);
  });
});
