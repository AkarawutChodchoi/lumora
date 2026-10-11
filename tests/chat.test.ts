import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { setProviderOverride } from "@/server/ai/registry";
import { ProviderError } from "@/server/ai/types";
import { cancelGeneration, prepareGeneration, runGeneration, type ChatStreamEvent } from "@/server/services/chat";
import { getOwnedConversation, listMessages, startConversation } from "@/server/services/conversations";
import { getBalance, postLedgerEntry, verifyLedgerConsistency } from "@/server/services/credits";
import { addMemory } from "@/server/services/memory";
import { SIGNUP_BONUS } from "@/server/domain/catalog";
import { makeCharacter, makeUser, MockProvider, rid } from "./helpers";

afterEach(() => setProviderOverride(null));

async function setup() {
  const user = await makeUser();
  const owner = await makeUser();
  const character = await makeCharacter(owner, {}, "public");
  const conv = await startConversation(user, character.id);
  return { user, character, conv };
}

async function send(user: Awaited<ReturnType<typeof makeUser>>, convId: string, content = "Hello Aria") {
  const events: ChatStreamEvent[] = [];
  const prepared = await prepareGeneration(user, convId, { mode: "send", content, clientRequestId: rid() });
  await runGeneration(user, prepared, (e) => events.push(e));
  return { prepared, events };
}

describe("chat pipeline", () => {
  it("streams a reply, persists both messages in order and charges one coin", async () => {
    setProviderOverride(new MockProvider(["Hi ", "traveler"]));
    const { user, conv } = await setup();
    const { events } = await send(user, conv.id);
    expect(events.map((e) => e.type)).toEqual(["start", "delta", "delta", "done"]);
    const { items } = await listMessages(user, conv.id, { limit: 30 });
    expect(items.map((m) => [m.sequence, m.role, m.status])).toEqual([
      [1, "assistant", "completed"],
      [2, "user", "completed"],
      [3, "assistant", "completed"],
    ]);
    expect(items[2].content).toBe("Hi traveler");
    expect(await getBalance(user.id)).toBe(SIGNUP_BONUS - 1);
    const gen = await db.generation.findFirstOrThrow({ where: { conversationId: conv.id } });
    expect(gen).toMatchObject({ status: "completed", inputTokens: 120, outputTokens: 30 });
  });

  it("includes memories and history but never another user's data in the prompt", async () => {
    const mock = new MockProvider(["ok"]);
    setProviderOverride(mock);
    const { user, character, conv } = await setup();
    const stranger = await makeUser();
    await addMemory(user, character.id, { type: "preference", content: "The user loves owls", importance: 5 });
    await addMemory(stranger, character.id, { type: "preference", content: "SECRET stranger fact", importance: 5 });
    await send(user, conv.id, "Tell me about owls");
    const req = mock.requests[0];
    const system = req.systemBlocks.map((b) => b.text).join("\n");
    expect(system).toContain("loves owls");
    expect(system).not.toContain("SECRET stranger fact");
    expect(req.messages[req.messages.length - 1]).toEqual({ role: "user", content: "Tell me about owls" });
  });

  it("refunds the coin and marks the message failed when the provider errors", async () => {
    setProviderOverride(new MockProvider(["partial "], new ProviderError("provider", "boom", true)));
    const { user, conv } = await setup();
    const { events } = await send(user, conv.id);
    expect(events[events.length - 1]).toMatchObject({ type: "error", code: "provider" });
    expect(await getBalance(user.id)).toBe(SIGNUP_BONUS);
    const last = (await listMessages(user, conv.id, { limit: 30 })).items.at(-1)!;
    expect(last).toMatchObject({ role: "assistant", status: "failed" });
    expect((await getOwnedConversation(user, conv.id)).activeGenerationId).toBeNull();
    expect((await verifyLedgerConsistency(user.id)).consistent).toBe(true);
  });

  it("treats a provider refusal as a content-policy failure and discards partial text", async () => {
    setProviderOverride(new MockProvider(["some text"], null, 0, "refusal"));
    const { user, conv } = await setup();
    const { events } = await send(user, conv.id);
    expect(events.at(-1)).toMatchObject({ type: "error", code: "content_policy" });
    const last = (await listMessages(user, conv.id, { limit: 30 })).items.at(-1)!;
    expect(last.content).toBe("");
    expect(await getBalance(user.id)).toBe(SIGNUP_BONUS);
  });

  it("rejects duplicate requests with the same clientRequestId", async () => {
    setProviderOverride(new MockProvider(["a"]));
    const { user, conv } = await setup();
    const id = rid();
    const p = await prepareGeneration(user, conv.id, { mode: "send", content: "one", clientRequestId: id });
    await runGeneration(user, p, () => {});
    await expect(prepareGeneration(user, conv.id, { mode: "send", content: "one", clientRequestId: id })).rejects.toMatchObject({ code: "conflict" });
    expect(await getBalance(user.id)).toBe(SIGNUP_BONUS - 1);
  });

  it("allows only one generation at a time per conversation", async () => {
    setProviderOverride(new MockProvider(["a"]));
    const { user, conv } = await setup();
    const results = await Promise.allSettled([
      prepareGeneration(user, conv.id, { mode: "send", content: "one", clientRequestId: rid() }),
      prepareGeneration(user, conv.id, { mode: "send", content: "two", clientRequestId: rid() }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason.code).toBe("conflict");
  });

  it("blocks other users from reading or posting to a conversation", async () => {
    const { conv } = await setup();
    const intruder = await makeUser();
    await expect(listMessages(intruder, conv.id, { limit: 30 })).rejects.toMatchObject({ code: "not_found" });
    await expect(prepareGeneration(intruder, conv.id, { mode: "send", content: "hi", clientRequestId: rid() })).rejects.toMatchObject({ code: "not_found" });
  });

  it("refuses to generate without enough coins and creates no messages", async () => {
    const { user, conv } = await setup();
    await postLedgerEntry({ userId: user.id, delta: -SIGNUP_BONUS, type: "generation_charge", idempotencyKey: `drain:${rid()}` });
    await expect(prepareGeneration(user, conv.id, { mode: "send", content: "hi", clientRequestId: rid() })).rejects.toMatchObject({ code: "insufficient_credits" });
    expect((await listMessages(user, conv.id, { limit: 30 })).items).toHaveLength(1);
    expect((await getOwnedConversation(user, conv.id)).activeGenerationId).toBeNull();
  });

  it("regenerates by deactivating the old reply and appending a new one", async () => {
    setProviderOverride(new MockProvider(["first"]));
    const { user, conv } = await setup();
    await send(user, conv.id);
    setProviderOverride(new MockProvider(["second"]));
    const p = await prepareGeneration(user, conv.id, { mode: "regenerate", clientRequestId: rid() });
    await runGeneration(user, p, () => {});
    const items = (await listMessages(user, conv.id, { limit: 30 })).items;
    expect(items.map((m) => m.content)).toEqual(["Hello, traveler!", "Hello Aria", "second"]);
    expect(await db.message.count({ where: { conversationId: conv.id, isActive: false } })).toBe(1);
  });

  it("edits the latest user message and replaces the reply", async () => {
    setProviderOverride(new MockProvider(["reply"]));
    const { user, conv } = await setup();
    const { prepared } = await send(user, conv.id, "original");
    const p = await prepareGeneration(user, conv.id, { mode: "edit", messageId: prepared.userMessageId!, content: "edited", clientRequestId: rid() });
    await runGeneration(user, p, () => {});
    const items = (await listMessages(user, conv.id, { limit: 30 })).items;
    expect(items.map((m) => m.content)).toEqual(["Hello, traveler!", "edited", "reply"]);
  });

  it("cancels on request; cancelling before any text is free", async () => {
    setProviderOverride(new MockProvider(["slow"], null, 2500));
    const { user, conv } = await setup();
    const p = await prepareGeneration(user, conv.id, { mode: "send", content: "hi", clientRequestId: rid() });
    const run = runGeneration(user, p, () => {});
    await new Promise((r) => setTimeout(r, 200));
    await cancelGeneration(user, p.generationId);
    await run;
    const gen = await db.generation.findUniqueOrThrow({ where: { id: p.generationId } });
    expect(gen.status).toBe("cancelled");
    expect(await getBalance(user.id)).toBe(SIGNUP_BONUS);
    expect((await getOwnedConversation(user, conv.id)).activeGenerationId).toBeNull();
  });

  it("keeps generating and saves the reply when the client disconnects", async () => {
    setProviderOverride(new MockProvider(["still ", "saved"]));
    const { user, conv } = await setup();
    const p = await prepareGeneration(user, conv.id, { mode: "send", content: "hi", clientRequestId: rid() });
    await runGeneration(user, p, () => {
      throw new Error("client gone");
    });
    const last = (await listMessages(user, conv.id, { limit: 30 })).items.at(-1)!;
    expect(last).toMatchObject({ status: "completed", content: "still saved" });
  });

  it("uses mature guidance only for opted-in adults, and stops chats if they opt out", async () => {
    const mock = new MockProvider(["ok"]);
    setProviderOverride(mock);
    const owner = await makeUser({ ageConfirmed18: true });
    const adult = await makeUser({ ageConfirmed18: true, matureContentEnabled: true });
    const character = await makeCharacter(owner, { contentRating: "mature" }, "public");
    const conv = await startConversation(adult, character.id);
    await send(adult, conv.id, "hello");
    expect(mock.requests[0].systemBlocks[0].text).toContain("Content level: MATURE");
    const optedOut = await db.user.update({ where: { id: adult.id }, data: { matureContentEnabled: false } });
    await expect(prepareGeneration(optedOut, conv.id, { mode: "send", content: "again", clientRequestId: rid() })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("uses the general level for general characters", async () => {
    const mock = new MockProvider(["ok"]);
    setProviderOverride(mock);
    const { user, conv } = await setup();
    await send(user, conv.id, "hello");
    expect(mock.requests[0].systemBlocks[0].text).toContain("Content level: GENERAL");
    expect(mock.requests[0].systemBlocks[0].text).not.toContain("Content level: MATURE");
  });

  it("paginates history backwards", async () => {
    setProviderOverride(new MockProvider(["r"]));
    const { user, conv } = await setup();
    for (let i = 0; i < 3; i++) await send(user, conv.id, `m${i}`);
    const page1 = await listMessages(user, conv.id, { limit: 4 });
    expect(page1.hasMore).toBe(true);
    const page2 = await listMessages(user, conv.id, { limit: 4, before: page1.items[0].sequence });
    expect(page2.items.at(-1)!.sequence).toBeLessThan(page1.items[0].sequence);
    expect(page2.hasMore).toBe(false);
  });
});
