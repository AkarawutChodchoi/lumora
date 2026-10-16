import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { addMemory, deleteMemory, extractMemories, listMemories, recordUserStatedMemories, renderMemory, retrieveMemories, words } from "@/server/services/memory";
import { makeCharacter, makeUser } from "./helpers";

describe("memory extraction", () => {
  it("extracts explicit facts in English and Thai", () => {
    expect(extractMemories("Hi, my name is Somchai.")[0]).toMatchObject({ key: "user.name", content: "{{user}}'s name is Somchai." });
    expect(extractMemories("เรียกฉันว่า ไธม์ นะ")[0]).toMatchObject({ key: "user.name" });
    expect(extractMemories("I really love rainy days").map((m) => m.content)).toContain("{{user}} likes rainy days.");
    expect(extractMemories("ฉันไม่ชอบผักชี").map((m) => m.content)).toContain("{{user}} dislikes ผักชี.");
    expect(extractMemories("Remember that we promised to meet at the lighthouse")[0].type).toBe("episodic");
  });

  it("does not treat questions about memory as instructions to remember", () => {
    expect(extractMemories("Do you remember my name? Tell me a short sea legend.")).toHaveLength(0);
    expect(extractMemories("I wonder if you remember the storm.")).toHaveLength(0);
    expect(extractMemories("Please remember that I am allergic to cats.")[0]?.type).toBe("episodic");
    expect(extractMemories("Okay. Remember that the key is under the mat!")[0]?.content).toContain("the key is under the mat");
  });

  it("does not store questions, negations as likes, or sensitive data", () => {
    expect(extractMemories("what is my name?")).toHaveLength(0);
    const dislike = extractMemories("I don't like spiders");
    expect(dislike.map((m) => m.content)).toEqual(["{{user}} dislikes spiders."]);
    expect(extractMemories("remember that my password: hunter22")).toHaveLength(0);
  });
});

describe("memory storage and retrieval", () => {
  async function setup() {
    const owner = await makeUser();
    const character = await makeCharacter(owner, {}, "public");
    return { owner, character };
  }

  it("never returns one user's memories to another user", async () => {
    const { character } = await setup();
    const alice = await makeUser();
    const bob = await makeUser();
    await recordUserStatedMemories({ user: alice, characterId: character.id, conversationId: null, messageId: "m1", text: "My name is Alice" });
    const forBob = await retrieveMemories(bob.id, character.id, "what is my name");
    expect(forBob).toHaveLength(0);
    const forAlice = await retrieveMemories(alice.id, character.id, "what is my name");
    expect(forAlice[0].content).toContain("Alice");
  });

  it("resolves contradictions: the newest stated name supersedes the old one but keeps provenance", async () => {
    const { character } = await setup();
    const u = await makeUser();
    await recordUserStatedMemories({ user: u, characterId: character.id, conversationId: null, messageId: "m1", text: "My name is Ann" });
    await recordUserStatedMemories({ user: u, characterId: character.id, conversationId: null, messageId: "m2", text: "Actually, call me Beth" });
    const active = await retrieveMemories(u.id, character.id, "name");
    expect(active.filter((m) => m.key === "user.name").map((m) => m.content)).toEqual(["{{user}}'s name is Beth."]);
    const all = await db.memory.findMany({ where: { userId: u.id, key: "user.name" } });
    expect(all).toHaveLength(2);
    expect(all.find((m) => m.content.includes("Ann"))?.supersededById).toBeTruthy();
  });

  it("deduplicates identical memories", async () => {
    const { character } = await setup();
    const u = await makeUser();
    for (const id of ["a", "b"]) await recordUserStatedMemories({ user: u, characterId: character.id, conversationId: null, messageId: id, text: "I love jazz" });
    expect(await listMemories(u, character.id)).toHaveLength(1);
  });

  it("skips extraction when the user disabled memory", async () => {
    const { character } = await setup();
    const u = await makeUser();
    const saved = await recordUserStatedMemories({ user: { ...u, memoryEnabled: false }, characterId: character.id, conversationId: null, messageId: "x", text: "My name is Carl" });
    expect(saved).toHaveLength(0);
  });

  it("excludes expired memories and supports deletion and editing ownership", async () => {
    const { character } = await setup();
    const u = await makeUser();
    const other = await makeUser();
    const m = await addMemory(u, character.id, { type: "world", content: "The kingdom is at war", importance: 4 });
    await expect(deleteMemory(other, m.id)).rejects.toMatchObject({ code: "not_found" });
    await db.memory.update({ where: { id: m.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await retrieveMemories(u.id, character.id, "kingdom")).toHaveLength(0);
    await deleteMemory(u, m.id);
    expect(await db.memory.findUnique({ where: { id: m.id } })).toBeNull();
  });

  it("stores the user as a placeholder and shows it as the user's name", async () => {
    const { character } = await setup();
    const u = await makeUser();
    const named = await db.user.update({ where: { id: u.id }, data: { displayName: "Thyme" } });
    // Typing your own name in a memory stores the placeholder, so renaming later stays correct.
    const m = await addMemory(named, character.id, { type: "relationship", content: "Thyme promised Aria to return at dawn", importance: 4 });
    expect(m.content).toBe("{{user}} promised Aria to return at dawn");
    expect(renderMemory(m.content, "Thyme")).toBe("Thyme promised Aria to return at dawn");
    expect(renderMemory("{{user}}'s name is Thyme.", "ไธม์")).toBe("ไธม์'s name is Thyme.");
  });

  it("ranks relevant memories first", async () => {
    const { character } = await setup();
    const u = await makeUser();
    await addMemory(u, character.id, { type: "preference", content: "The user likes astronomy and telescopes", importance: 2 });
    await addMemory(u, character.id, { type: "preference", content: "The user dislikes loud music", importance: 2 });
    const r = await retrieveMemories(u.id, character.id, "show me the telescopes tonight");
    expect(r[0].content).toContain("telescopes");
  });

  it("matches Thai words even though Thai has no spaces", async () => {
    expect([...words("ฉันชอบแมวสีส้มมาก")]).toEqual(expect.arrayContaining(["ชอบ", "แมว", "ส้ม"]));
    const { character } = await setup();
    const u = await makeUser();
    // Later memory is newer, so without word matching it would rank first.
    await addMemory(u, character.id, { type: "preference", content: "ผู้ใช้ชอบแมวสีส้ม", importance: 2 });
    await addMemory(u, character.id, { type: "preference", content: "ผู้ใช้ไม่ชอบเสียงดัง", importance: 2 });
    const r = await retrieveMemories(u.id, character.id, "เล่าเรื่องแมวให้ฟังหน่อย");
    expect(r[0].content).toContain("แมว");
  });
});
