import "server-only";
import { and, desc, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { AppError, notFound } from "./errors";
import { assertCanStartChat, getViewableCharacter, isBlocked, parseSnapshot } from "./characters";
import { reapStaleGeneration } from "./chat";
import type { AppUser } from "./access";

const { conversation, message, character, characterVersion } = schema;
export type Conversation = typeof conversation.$inferSelect;
export type Message = typeof message.$inferSelect;

/** Load a conversation owned by the user. Other users' conversations look like they do not exist. */
export async function getOwnedConversation(user: Pick<AppUser, "id">, id: string): Promise<Conversation> {
  const [conv] = await db.select().from(conversation).where(eq(conversation.id, id));
  if (!conv || conv.userId !== user.id) throw notFound("Conversation");
  return conv;
}

export async function startConversation(user: AppUser, characterId: string) {
  const c = await getViewableCharacter(characterId, user);
  assertCanStartChat(c, user);
  if (await isBlocked(user.id, characterId)) throw new AppError("forbidden", "You blocked this character. Unblock it in Safety settings to chat.");

  const [version] = await db
    .select()
    .from(characterVersion)
    .where(and(eq(characterVersion.characterId, characterId), eq(characterVersion.version, c.currentVersion)));
  if (!version) throw notFound("Character");

  return db.transaction(async (tx) => {
    const [conv] = await tx.insert(conversation).values({ userId: user.id, characterId, characterVersionId: version.id, title: c.name, nextSequence: 2 }).returning();
    // The greeting comes from the pinned version so it matches the story's starting point.
    await tx.insert(message).values({ conversationId: conv.id, sequence: 1, role: "assistant", content: parseSnapshot(version.snapshot).greeting, status: "completed" });
    await tx.update(character).set({ chatCount: sql`${character.chatCount} + 1` }).where(eq(character.id, characterId));
    return conv;
  });
}

export async function listConversations(user: Pick<AppUser, "id">, characterId?: string) {
  const rows = await db
    .select({ conv: conversation, ch: { id: character.id, name: character.name, avatarUrl: character.avatarUrl } })
    .from(conversation)
    .innerJoin(character, eq(character.id, conversation.characterId))
    .where(and(eq(conversation.userId, user.id), characterId ? eq(conversation.characterId, characterId) : undefined))
    .orderBy(desc(conversation.pinned), desc(conversation.lastMessageAt))
    .limit(100);
  // latest completed active message per conversation, in one query
  const ids = rows.map((r) => r.conv.id);
  const last = ids.length
    ? await db
        .selectDistinctOn([message.conversationId], { conversationId: message.conversationId, content: message.content, role: message.role })
        .from(message)
        .where(and(inArray(message.conversationId, ids), eq(message.isActive, true), eq(message.status, "completed")))
        .orderBy(message.conversationId, desc(message.sequence))
    : [];
  const byConv = new Map(last.map((m) => [m.conversationId, m]));
  return rows.map(({ conv: c, ch }) => {
    const m = byConv.get(c.id);
    return {
      id: c.id,
      title: c.title,
      pinned: c.pinned,
      status: c.status,
      lastMessageAt: c.lastMessageAt,
      character: ch,
      preview: m?.content.slice(0, 120) ?? "",
      lastFromUser: m?.role === "user",
      note: c.note,
      noteAt: c.noteAt,
    };
  });
}

export const messagesQuerySchema = z.object({
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

/** Active messages, newest page first; returned in chronological order. */
export async function listMessages(user: Pick<AppUser, "id">, conversationId: string, q: z.infer<typeof messagesQuerySchema>) {
  const conv = await getOwnedConversation(user, conversationId);
  // Clients poll this while a reply is running; close out replies whose worker died.
  if (conv.activeGenerationId && !q.before) await reapStaleGeneration(conversationId);
  const rows = await db
    .select()
    .from(message)
    .where(and(eq(message.conversationId, conversationId), eq(message.isActive, true), q.before ? lt(message.sequence, q.before) : undefined))
    .orderBy(desc(message.sequence))
    .limit(q.limit + 1);
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

export async function updateConversation(user: Pick<AppUser, "id">, id: string, patch: z.infer<typeof conversationPatchSchema>) {
  await getOwnedConversation(user, id);
  if (!Object.keys(patch).length) return getOwnedConversation(user, id);
  const [c] = await db.update(conversation).set(patch).where(eq(conversation.id, id)).returning();
  return c;
}

export async function deleteConversation(user: Pick<AppUser, "id">, id: string) {
  const conv = await getOwnedConversation(user, id);
  // A reply whose worker died must never block deleting the chat.
  if (conv.activeGenerationId && (await reapStaleGeneration(id))) throw new AppError("conflict", "Wait for the current reply to finish before deleting");
  await db.delete(conversation).where(eq(conversation.id, id));
}

export async function deleteAllConversations(user: Pick<AppUser, "id">) {
  const busy = await db
    .select({ id: conversation.id })
    .from(conversation)
    .where(and(eq(conversation.userId, user.id), isNotNull(conversation.activeGenerationId)));
  for (const c of busy) await reapStaleGeneration(c.id);
  const res = await db
    .delete(conversation)
    .where(and(eq(conversation.userId, user.id), isNull(conversation.activeGenerationId)))
    .returning({ id: conversation.id });
  return res.length;
}
