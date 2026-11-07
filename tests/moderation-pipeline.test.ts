import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { AppUser as User } from "@/lib/server/access";
import { setProviderOverride } from "@/lib/server/ai/registry";
import { ProviderError } from "@/lib/server/ai/types";
import { cancelGeneration, prepareGeneration, reapStaleGeneration, runGeneration, settleTestHooks, type ChatStreamEvent } from "@/lib/server/chat";
import { getOwnedConversation, listMessages, startConversation } from "@/lib/server/conversations";
import { getBalance, verifyLedgerConsistency } from "@/lib/server/wallet";
import { SIGNUP_BONUS } from "@/lib/domain/catalog";
import { ageGeneration, genLedger, get, makeCharacter, makeUser, MockProvider, rid } from "./helpers";

// Text that moderateText blocks in AI output.
const BLOCKED = ["This reply is ", "explicit porn."];

afterEach(() => {
  setProviderOverride(null);
  settleTestHooks.afterClaim = undefined;
});

async function setup() {
  const user = await makeUser();
  const owner = await makeUser();
  const character = await makeCharacter(owner, {}, "public");
  const conv = await startConversation(user, character.id);
  return { user, conv };
}

function prepare(user: User, convId: string) {
  return prepareGeneration(user, convId, { mode: "send", content: "Hello", clientRequestId: rid() });
}

/** Every piece of text a client could have seen through the stream. */
function streamedText(events: ChatStreamEvent[]) {
  return events
    .map((e) => (e.type === "delta" ? e.text : e.type === "done" ? e.message.content : ""))
    .join("");
}

async function refundRows(generationId: string) {
  return (await genLedger(generationId)).filter((r) => r.kind === "refund").length;
}

async function expectDiscardedAndRefunded(user: User, convId: string, generationId: string, assistantMessageId: string) {
  const msg = (await get.message(assistantMessageId))!;
  expect(msg.content).toBe("");
  const visible = (await listMessages(user, convId, { limit: 30 })).items;
  expect(visible.map((m) => m.content).join("")).not.toMatch(/porn/);
  expect(await getBalance(user.id)).toBe(SIGNUP_BONUS);
  expect(await refundRows(generationId)).toBe(1);
  expect((await getOwnedConversation(user, convId)).activeGenerationId).toBeNull();
  expect((await verifyLedgerConsistency(user.id)).consistent).toBe(true);
}

describe("moderation runs before any exposure", () => {
  it("normal completion: blocked text is never streamed, readable or kept, and is refunded", async () => {
    setProviderOverride(new MockProvider(BLOCKED, null, 700));
    const { user, conv } = await setup();
    const p = await prepare(user, conv.id);
    const events: ChatStreamEvent[] = [];
    const run = runGeneration(user, p, (e) => events.push(e));

    // Poll like a reloaded client while the reply is being generated.
    const seenWhileRunning: string[] = [];
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r, 400));
      seenWhileRunning.push(...(await listMessages(user, conv.id, { limit: 30 })).items.map((m) => m.content));
    }
    await run;

    expect(seenWhileRunning.join("")).not.toMatch(/porn|This reply/);
    expect(streamedText(events)).toBe("");
    expect(events.at(-1)).toMatchObject({ type: "error", code: "content_policy" });
    await expectDiscardedAndRefunded(user, conv.id, p.generationId, p.assistantMessageId);
  });

  it("allowed text is also hidden until it has passed moderation, then delivered whole", async () => {
    setProviderOverride(new MockProvider(["Hi ", "there"], null, 700));
    const { user, conv } = await setup();
    const p = await prepare(user, conv.id);
    const events: ChatStreamEvent[] = [];
    const run = runGeneration(user, p, (e) => events.push(e));
    await new Promise((r) => setTimeout(r, 1000)); // first chunk produced, second pending
    const midway = (await listMessages(user, conv.id, { limit: 30 })).items.at(-1)!;
    expect(midway.content).toBe("");
    await run;
    expect(events.map((e) => e.type)).toEqual(["start", "done"]);
    expect(events.at(-1)).toMatchObject({ type: "done", message: { content: "Hi there", status: "completed" } });
  });

  it("deadline: blocked partial text is withheld and refunded instead of kept", async () => {
    setProviderOverride(new MockProvider([...BLOCKED, "more", "more"], null, 1500));
    const { user, conv } = await setup();
    const p = await prepare(user, conv.id);
    const events: ChatStreamEvent[] = [];
    await runGeneration(user, p, (e) => events.push(e), { deadlineMs: 5000 });
    expect(streamedText(events)).toBe("");
    expect(events.at(-1)).toMatchObject({ type: "error", code: "content_policy" });
    await expectDiscardedAndRefunded(user, conv.id, p.generationId, p.assistantMessageId);
  });

  it("provider error after some text: the unreviewed partial text is not kept", async () => {
    setProviderOverride(new MockProvider(BLOCKED, new ProviderError("provider", "boom", true)));
    const { user, conv } = await setup();
    const p = await prepare(user, conv.id);
    const events: ChatStreamEvent[] = [];
    await runGeneration(user, p, (e) => events.push(e));
    expect(streamedText(events)).toBe("");
    expect(events.at(-1)).toMatchObject({ type: "error", code: "provider" });
    await expectDiscardedAndRefunded(user, conv.id, p.generationId, p.assistantMessageId);
  });

  it("cancel: text produced before Stop is discarded and the cancel is free", async () => {
    // trailing chunks keep the stream open long enough for the 1s cancel poll on a slow database
    setProviderOverride(new MockProvider([...BLOCKED, "never", "never", "never", "never"], null, 600));
    const { user, conv } = await setup();
    const p = await prepare(user, conv.id);
    const events: ChatStreamEvent[] = [];
    const run = runGeneration(user, p, (e) => events.push(e));
    await new Promise((r) => setTimeout(r, 1500)); // both blocked chunks already produced
    await cancelGeneration(user, p.generationId);
    await run;
    expect(streamedText(events)).toBe("");
    expect((await get.generation(p.generationId))!.status).toBe("cancelled");
    await expectDiscardedAndRefunded(user, conv.id, p.generationId, p.assistantMessageId);
    expect((await get.message(p.assistantMessageId))!.isActive).toBe(false);
  });

  it("stale recovery: text left by a dead worker is discarded and refunded, not kept", async () => {
    const { user, conv } = await setup();
    const p = await prepare(user, conv.id);
    // An old worker (before this change) saved unreviewed partial text, then died.
    await db.update(schema.message).set({ content: BLOCKED.join(""), status: "streaming" }).where(eq(schema.message.id, p.assistantMessageId));
    await db.update(schema.generation).set({ status: "streaming", createdAt: new Date(Date.now() - 5 * 60_000) }).where(eq(schema.generation.id, p.generationId));
    expect(await reapStaleGeneration(conv.id)).toBe(false);
    expect((await get.generation(p.generationId))!.status).toBe("failed");
    await expectDiscardedAndRefunded(user, conv.id, p.generationId, p.assistantMessageId);
  });
});

describe("final outcome is settled atomically", () => {
  it("a database failure while settling rolls everything back; the reaper settles it later", async () => {
    setProviderOverride(new MockProvider(["Hi ", "there"]));
    const { user, conv } = await setup();
    const p = await prepare(user, conv.id);
    settleTestHooks.afterClaim = () => {
      throw new Error("injected database failure");
    };
    const events: ChatStreamEvent[] = [];
    await runGeneration(user, p, (e) => events.push(e));

    // Nothing half-done: still running, still charged once, no refund, chat still locked, no text.
    const gen = (await get.generation(p.generationId))!;
    expect(gen.status).toBe("streaming");
    expect(gen.completedAt).toBeNull();
    expect((await get.message(p.assistantMessageId))!.content).toBe("");
    expect(await getBalance(user.id)).toBe(SIGNUP_BONUS - 1);
    expect(await refundRows(p.generationId)).toBe(0);
    expect((await getOwnedConversation(user, conv.id)).activeGenerationId).toBe(p.generationId);
    expect(streamedText(events)).toBe("");
    expect(events.at(-1)).toMatchObject({ type: "error", code: "internal" });

    // Recovery: once the database works again, the stale reaper settles it with one refund.
    settleTestHooks.afterClaim = undefined;
    await ageGeneration(p.generationId);
    expect(await reapStaleGeneration(conv.id)).toBe(false);
    expect((await get.generation(p.generationId))!.status).toBe("failed");
    expect(await getBalance(user.id)).toBe(SIGNUP_BONUS);
    expect(await refundRows(p.generationId)).toBe(1);
    expect((await verifyLedgerConsistency(user.id)).consistent).toBe(true);
  });

  it("racing reapers settle a dead reply exactly once", async () => {
    const { user, conv } = await setup();
    const p = await prepare(user, conv.id);
    await ageGeneration(p.generationId);
    await Promise.all([reapStaleGeneration(conv.id), reapStaleGeneration(conv.id), reapStaleGeneration(conv.id)]);
    expect(await refundRows(p.generationId)).toBe(1);
    expect(await getBalance(user.id)).toBe(SIGNUP_BONUS);
    expect((await verifyLedgerConsistency(user.id)).consistent).toBe(true);
  });

  it("worker completion racing the reaper ends with one consistent outcome", async () => {
    setProviderOverride(new MockProvider(["Hi ", "there"]));
    const { user, conv } = await setup();
    const p = await prepare(user, conv.id);
    await ageGeneration(p.generationId);
    // Hold each settle transaction open briefly so the two overlap.
    settleTestHooks.afterClaim = () => new Promise((r) => setTimeout(r, 400));
    const worker = runGeneration(user, p, () => {});
    const reaper = (async () => {
      await new Promise((r) => setTimeout(r, 150));
      return reapStaleGeneration(conv.id);
    })();
    await Promise.all([worker, reaper]);

    const gen = (await get.generation(p.generationId))!;
    const msg = (await get.message(p.assistantMessageId))!;
    const refunds = await refundRows(p.generationId);
    if (gen.status === "completed") {
      expect(msg).toMatchObject({ status: "completed", content: "Hi there" });
      expect(refunds).toBe(0);
      expect(await getBalance(user.id)).toBe(SIGNUP_BONUS - 1);
    } else {
      expect(gen.status).toBe("failed");
      expect(msg).toMatchObject({ status: "failed", content: "" });
      expect(refunds).toBe(1);
      expect(await getBalance(user.id)).toBe(SIGNUP_BONUS);
    }
    expect((await getOwnedConversation(user, conv.id)).activeGenerationId).toBeNull();
    expect((await verifyLedgerConsistency(user.id)).consistent).toBe(true);
  });
});
