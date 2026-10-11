import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { setProviderOverride } from "@/server/ai/registry";
import { cleanNote, maybeScanConversation, parseScan, SCAN_EVERY } from "@/server/services/auto-memory";
import { enforceLimit, listMemories } from "@/server/services/memory";
import { startConversation } from "@/server/services/conversations";
import { prepareGeneration, runGeneration } from "@/server/services/chat";
import { makeCharacter, makeUser, MockProvider, rid } from "./helpers";

afterEach(() => setProviderOverride(null));

async function chatTimes(n: number) {
  const user = await makeUser();
  const owner = await makeUser();
  const character = await makeCharacter(owner, {}, "public");
  const conv = await startConversation(user, character.id);
  setProviderOverride(new MockProvider(["ok"]));
  for (let i = 0; i < n; i++) {
    const p = await prepareGeneration(user, conv.id, { mode: "send", content: `message ${i}`, clientRequestId: rid() });
    await runGeneration(user, p, () => {});
  }
  return { user, character, conv };
}

describe("automatic memory parsing", () => {
  it("parses JSON even inside code fences and ignores junk", () => {
    expect(parseScan('```json\n{"memories":[{"type":"episodic","content":"They found the lost key.","importance":4}],"note":"เจอกุญแจแล้ว!"}\n```')).toEqual({
      memories: [{ type: "episodic", content: "They found the lost key.", importance: 4 }],
      note: "เจอกุญแจแล้ว!",
    });
    expect(parseScan("no json here")).toBeNull();
    expect(parseScan('{"memories":[{"type":"bogus","content":"x"}],"note":null}')).toEqual({ memories: [], note: null });
  });

  it("removes stray letters from scripts that are not in the conversation", () => {
    expect(cleanNote("รอดوพายุสงบแล้วไปดูดาวด้วยกันนะ", "ฉันชอบดูดาว")).toBe("รอดพายุสงบแล้วไปดูดาวด้วยกันนะ");
    expect(cleanNote("Let's stargaze! 🌙", "I love stars")).toBe("Let's stargaze! 🌙");
    // A whole note in another language is left alone.
    expect(cleanNote("ถ้ำนั้นยังรอเราอยู่นะ", "message 0")).toBe("ถ้ำนั้นยังรอเราอยู่นะ");
  });
});

describe("automatic memory scans", () => {
  it(`waits for ${SCAN_EVERY} new user messages before scanning`, async () => {
    const { user, conv } = await chatTimes(SCAN_EVERY - 1);
    setProviderOverride(new MockProvider(['{"memories":[],"note":"hi"}']));
    expect(await maybeScanConversation(user, conv.id)).toMatchObject({ scanned: false, reason: "not_enough_messages" });
  });

  it("saves noteworthy memories as auto-saved, sets the note, and skips sensitive data", async () => {
    const { user, character, conv } = await chatTimes(SCAN_EVERY);
    setProviderOverride(
      new MockProvider([
        JSON.stringify({
          memories: [
            { type: "episodic", content: "The user and the character found a hidden cave.", importance: 4 },
            { type: "preference", content: "The user's password is hunter22.", importance: 5 },
          ],
          note: "ถ้ำนั้นยังรอเราอยู่นะ",
        }),
      ]),
    );
    const r = await maybeScanConversation(user, conv.id);
    expect(r).toMatchObject({ scanned: true, saved: 1, note: "ถ้ำนั้นยังรอเราอยู่นะ" });
    const mems = await listMemories(user, character.id);
    const cave = mems.find((m) => m.content.includes("hidden cave"));
    expect(cave?.source).toBe("ai_inferred");
    // "the user" from the model is normalised to the placeholder.
    expect(cave?.content).toBe("{{user}} and the character found a hidden cave.");
    expect(mems.some((m) => m.content.includes("password"))).toBe(false);
    const after = await db.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    expect(after.note).toBe("ถ้ำนั้นยังรอเราอยู่นะ");
    // The same messages are not scanned twice.
    expect(await maybeScanConversation(user, conv.id)).toMatchObject({ scanned: false });
  });

  it("never touches another user's conversation", async () => {
    const { conv } = await chatTimes(SCAN_EVERY);
    const stranger = await makeUser();
    expect(await maybeScanConversation(stranger, conv.id)).toMatchObject({ scanned: false, reason: "not_found" });
  });

  it("does not save memories when the user turned memory off, but still updates the note", async () => {
    const { user, character, conv } = await chatTimes(SCAN_EVERY);
    setProviderOverride(new MockProvider(['{"memories":[{"type":"world","content":"The kingdom fell last winter.","importance":3}],"note":"เหนื่อยไหม?"}']));
    const r = await maybeScanConversation({ ...user, memoryEnabled: false }, conv.id);
    expect(r).toMatchObject({ scanned: true, saved: 0 });
    expect((await listMemories(user, character.id)).some((m) => m.content.includes("kingdom"))).toBe(false);
  });
});

describe("memory character budget", () => {
  it("expires the least important memories when over 20,000 characters", async () => {
    const { user, character } = await chatTimes(0);
    const big = "x".repeat(8000);
    for (const [importance, tag] of [[1, "low"], [5, "high"], [3, "mid"]] as const) {
      await db.memory.create({ data: { userId: user.id, characterId: character.id, type: "world", content: `${tag} ${big}`, source: "user_edited", importance } });
    }
    await enforceLimit(user.id, character.id);
    const kept = (await listMemories(user, character.id)).map((m) => m.content.split(" ")[0]);
    expect(kept.sort()).toEqual(["high", "mid"]);
  });
});
