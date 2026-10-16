import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { cancelGeneration, prepareGeneration, reapStaleGeneration } from "@/server/services/chat";
import { deleteConversation, getOwnedConversation, listMessages, startConversation } from "@/server/services/conversations";
import { deleteCharacter } from "@/server/services/characters";
import { getBalance } from "@/server/services/credits";
import { SIGNUP_BONUS } from "@/server/domain/catalog";
import { makeCharacter, makeUser, rid } from "./helpers";

// "Dead worker": prepareGeneration charged and locked the chat, but runGeneration never
// ran or was killed (e.g. the app was closed and the serverless function stopped).
async function deadReply() {
  const user = await makeUser();
  const owner = await makeUser();
  const character = await makeCharacter(owner, {}, "public");
  const conv = await startConversation(user, character.id);
  const p = await prepareGeneration(user, conv.id, { mode: "send", content: "hello", clientRequestId: rid() });
  return { user, owner, character, conv, p };
}

describe("replies whose worker died", () => {
  it("stop works even with no worker: the chat unlocks and the coin is refunded", async () => {
    const { user, conv, p } = await deadReply();
    expect(await getBalance(user.id)).toBe(SIGNUP_BONUS - 1);
    await cancelGeneration(user, p.generationId);
    expect((await getOwnedConversation(user, conv.id)).activeGenerationId).toBeNull();
    expect(await getBalance(user.id)).toBe(SIGNUP_BONUS);
    const items = (await listMessages(user, conv.id, { limit: 30 })).items;
    expect(items.some((m) => m.status === "pending" || m.status === "streaming")).toBe(false);
  });

  it("discards unreviewed partial text when stopped, and the stop is free", async () => {
    const { user, conv, p } = await deadReply();
    await db.message.update({ where: { id: p.assistantMessageId }, data: { content: "Half a reply", status: "streaming" } });
    await cancelGeneration(user, p.generationId);
    const items = (await listMessages(user, conv.id, { limit: 30 })).items;
    expect(items.some((m) => m.content === "Half a reply")).toBe(false);
    expect((await db.message.findUniqueOrThrow({ where: { id: p.assistantMessageId } })).content).toBe("");
    expect(await getBalance(user.id)).toBe(SIGNUP_BONUS);
    expect((await getOwnedConversation(user, conv.id)).activeGenerationId).toBeNull();
  });

  it("closes out a stale reply when the chat is opened again, instead of spinning forever", async () => {
    const { user, conv, p } = await deadReply();
    expect(await reapStaleGeneration(conv.id)).toBe(true); // fresh: still considered running
    await db.generation.update({ where: { id: p.generationId }, data: { createdAt: new Date(Date.now() - 5 * 60_000) } });
    const items = (await listMessages(user, conv.id, { limit: 30 })).items;
    expect(items.some((m) => m.status === "pending" || m.status === "streaming")).toBe(false);
    expect((await getOwnedConversation(user, conv.id)).activeGenerationId).toBeNull();
    expect(await getBalance(user.id)).toBe(SIGNUP_BONUS);
  });

  it("lets the user delete a chat that is stuck on a dead reply", async () => {
    const { user, conv, p } = await deadReply();
    await db.generation.update({ where: { id: p.generationId }, data: { createdAt: new Date(Date.now() - 5 * 60_000) } });
    await deleteConversation(user, conv.id);
    expect(await db.conversation.findUnique({ where: { id: conv.id } })).toBeNull();
  });

  it("deletes a character that people have chatted with", async () => {
    const { owner, character } = await deadReply();
    await deleteCharacter(owner, character.id);
    expect(await db.character.findUnique({ where: { id: character.id } })).toBeNull();
    expect(await db.conversation.count({ where: { characterId: character.id } })).toBe(0);
  });
});
