import type { Conversation, Message, User } from "@prisma/client";
import { z } from "zod";
import { db } from "../db";
import { AppError, notFound } from "../errors";
import { assertCanStartChat, getViewableCharacter } from "./characters";
import { reapStaleGeneration } from "./chat";

/** Load a conversation owned by the user. Other users' conversations look like they do not exist. */
export async function getOwnedConversation(user: Pick<User, "id">, id: string): Promise<Conversation> {
  const conv = await db.conversation.findUnique({ where: { id } });
  if (!conv || conv.userId !== user.id) throw notFound("Conversation");
  return conv;
}

export async function startConversation(user: User, characterId: string) {
  const character = await getViewableCharacter(characterId, user);
  assertCanStartChat(character, user);
  const blocked = await db.characterBlock.findUnique({ where: { userId_characterId: { userId: user.id, characterId } } });
  if (blocked) throw new AppError("forbidden", "You blocked this character. Unblock it in Safety settings to chat.");

  const version = await db.characterVersion.findUniqueOrThrow({
    where: { characterId_version: { characterId, version: character.currentVersion } },
  });

  return db.$transaction(async (tx) => {
    const conv = await tx.conversation.create({
      data: {
        userId: user.id,
        characterId,
        characterVersionId: version.id,
        title: character.name,
        nextSequence: 2,
      },
    });
    // The greeting comes from the pinned version so it matches the story's starting point.
    const snapshot = JSON.parse(version.snapshot) as { greeting: string };
    await tx.message.create({ data: { conversationId: conv.id, sequence: 1, role: "assistant", content: snapshot.greeting, status: "completed" } });
    await tx.character.update({ where: { id: characterId }, data: { chatCount: { increment: 1 } } });
    return conv;
  });
}

export async function listConversations(user: User, characterId?: string) {
  const rows = await db.conversation.findMany({
    where: { userId: user.id, ...(characterId ? { characterId } : {}) },
    orderBy: [{ pinned: "desc" }, { lastMessageAt: "desc" }],
    take: 100,
    include: {
      character: { select: { id: true, name: true, avatarUrl: true } },
      messages: { where: { isActive: true, status: "completed" }, orderBy: { sequence: "desc" }, take: 1, select: { content: true, role: true } },
    },
  });
  return rows.map((c) => ({
    id: c.id,
    title: c.title,
    pinned: c.pinned,
    status: c.status,
    lastMessageAt: c.lastMessageAt,
    character: c.character,
    preview: c.messages[0]?.content.slice(0, 120) ?? "",
    lastFromUser: c.messages[0]?.role === "user",
    note: c.note,
    noteAt: c.noteAt,
  }));
}

export const messagesQuerySchema = z.object({
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

/** Active messages, newest page first; returned in chronological order. */
export async function listMessages(user: User, conversationId: string, q: z.infer<typeof messagesQuerySchema>) {
  const conv = await getOwnedConversation(user, conversationId);
  // Clients poll this while a reply is running; close out replies whose worker died.
  if (conv.activeGenerationId && !q.before) await reapStaleGeneration(conversationId);
  const rows = await db.message.findMany({
    where: { conversationId, isActive: true, ...(q.before ? { sequence: { lt: q.before } } : {}) },
    orderBy: { sequence: "desc" },
    take: q.limit + 1,
  });
  const hasMore = rows.length > q.limit;
  return { items: rows.slice(0, q.limit).reverse().map(toClientMessage), hasMore };
}

export function toClientMessage(m: Message) {
  return {
    id: m.id,
    sequence: m.sequence,
    role: m.role,
    content: m.content,
    status: m.status,
    errorCode: m.errorCode,
    generationId: m.status === "pending" || m.status === "streaming" ? m.generationId : null,
    createdAt: m.createdAt,
  };
}
export type ClientMessage = ReturnType<typeof toClientMessage>;

export const conversationPatchSchema = z.object({
  title: z.string().trim().min(1).max(80).optional(),
  pinned: z.boolean().optional(),
  status: z.enum(["active", "archived"]).optional(),
});

export async function updateConversation(user: User, id: string, patch: z.infer<typeof conversationPatchSchema>) {
  await getOwnedConversation(user, id);
  return db.conversation.update({ where: { id }, data: patch });
}

export async function deleteConversation(user: User, id: string) {
  const conv = await getOwnedConversation(user, id);
  // A reply whose worker died must never block deleting the chat.
  if (conv.activeGenerationId && (await reapStaleGeneration(id))) throw new AppError("conflict", "Wait for the current reply to finish before deleting");
  await db.conversation.delete({ where: { id } });
}

export async function deleteAllConversations(user: User) {
  const busy = await db.conversation.findMany({ where: { userId: user.id, activeGenerationId: { not: null } }, select: { id: true } });
  for (const c of busy) await reapStaleGeneration(c.id);
  const res = await db.conversation.deleteMany({ where: { userId: user.id, activeGenerationId: null } });
  return res.count;
}
