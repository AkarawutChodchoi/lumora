import type { Memory, User } from "@prisma/client";
import { z } from "zod";
import { db } from "../db";
import { AppError, notFound } from "../errors";
import { MEMORY_TYPES, type MemoryType } from "../domain/enums";
import { containsSensitiveData } from "./moderation";
import { getEntitlements } from "./entitlements";

// Memories refer to the user with the placeholder {{user}} (never "the user" or a
// fixed name), so they always read with the user's current display name. Characters
// are referred to by their real names.
export const USER_TOKEN = "{{user}}";

/** Show a stored memory with the user's name in place of the placeholder. */
export function renderMemory(content: string, userName: string): string {
  return content.split(USER_TOKEN).join(userName || "you");
}

/** Store user-written text with the user's own name turned back into the placeholder. */
export function tokenizeUserName(content: string, userName: string): string {
  const name = userName.trim();
  return name.length >= 2 ? content.split(name).join(USER_TOKEN) : content;
}

// Memory pipeline (see docs/ARCHITECTURE.md § Memory):
//   extract (deterministic rules, user-stated facts only) -> privacy filter ->
//   dedupe / conflict resolution by slot key -> store with provenance ->
//   retrieve by relevance within a token budget.
// Rule-based extraction never stores guesses as facts: everything it saves is
// something the user said explicitly ("my name is…", "remember that…").
// Model-based inference (source = "ai_inferred") is a planned extension and
// would be stored with lower confidence and labelled "inferred" in prompts.

export interface MemoryCandidate {
  type: MemoryType;
  key: string | null;
  content: string;
  importance: number;
}

const EPISODIC_TTL_DAYS = 180;
const clean = (s: string) => s.trim().replace(/\s+/g, " ").replace(/[.!?,;:]+$/, "");

const RULES: { re: RegExp; build: (m: RegExpMatchArray) => MemoryCandidate | null }[] = [
  {
    re: /\b(?:my name is|call me|i am called|i'm called)\s+([\p{L}][\p{L}'’-]{0,30}(?:\s[\p{Lu}][\p{L}'’-]{0,30})?)/iu,
    build: (m) => ({ type: "preference", key: "user.name", content: `{{user}}'s name is ${clean(m[1])}.`, importance: 5 }),
  },
  {
    re: /(?:เรียก(?:ฉัน|ผม|เรา|หนู)ว่า|(?:ฉัน|ผม|เรา|หนู)ชื่อ)\s*(?!อะไร)([^\s,.!?]{1,30})/u,
    build: (m) => ({ type: "preference", key: "user.name", content: `{{user}}'s name is ${clean(m[1])}.`, importance: 5 }),
  },
  {
    re: /\bmy pronouns are\s+([a-z/]{2,20})/i,
    build: (m) => ({ type: "preference", key: "user.pronouns", content: `{{user}}'s pronouns are ${clean(m[1])}.`, importance: 5 }),
  },
  {
    re: /\bmy birthday is\s+([^.!?\n]{3,30})/i,
    build: (m) => ({ type: "preference", key: "user.birthday", content: `{{user}}'s birthday is ${clean(m[1])}.`, importance: 4 }),
  },
  {
    re: /\bmy (?:favou?rite)\s+([a-z]{2,20})\s+(?:is|are)\s+([^.!?\n]{1,50})/i,
    build: (m) => ({ type: "preference", key: `user.favorite.${m[1].toLowerCase()}`, content: `{{user}}'s favorite ${m[1].toLowerCase()} is ${clean(m[2])}.`, importance: 3 }),
  },
  {
    re: /\bi (?:don't|do not) (?:like|enjoy)\s+([^.!?\n]{2,60})|\bi (?:hate|dislike)\s+([^.!?\n]{2,60})/i,
    build: (m) => ({ type: "preference", key: null, content: `{{user}} dislikes ${clean(m[1] ?? m[2])}.`, importance: 3 }),
  },
  {
    re: /(?:ฉัน|ผม|เรา|หนู)ไม่ชอบ\s*([^,.!?\n]{2,60})/u,
    build: (m) => ({ type: "preference", key: null, content: `{{user}} dislikes ${clean(m[1])}.`, importance: 3 }),
  },
  {
    re: /\bi (?:really )?(?:like|love|enjoy)\s+([^.!?\n]{2,60})/i,
    build: (m) => ({ type: "preference", key: null, content: `{{user}} likes ${clean(m[1])}.`, importance: 3 }),
  },
  {
    re: /(?:ฉัน|ผม|เรา|หนู)(?:ชอบ|รัก)\s*([^,.!?\n]{2,60})/u,
    build: (m) => ({ type: "preference", key: null, content: `{{user}} likes ${clean(m[1])}.`, importance: 3 }),
  },
  {
    // Only an instruction ("remember that…", "please remember…") at the start of a
    // sentence — never a question like "do you remember my name?".
    re: /(?:^|[.!]\s+)(?:please\s+)?remember\s+(?:that\s+)?([^.?!\n]{4,200})(?=[.!]|$)/im,
    build: (m) => ({ type: "episodic", key: null, content: `{{user}} asked to remember: ${clean(m[1])}.`, importance: 4 }),
  },
  {
    re: /จำไว้(?:นะ)?ว่า\s*([^\n]{4,200})/u,
    build: (m) => ({ type: "episodic", key: null, content: `{{user}} asked to remember: ${clean(m[1])}.`, importance: 4 }),
  },
];

/** Deterministic extraction of explicitly stated facts. Returns at most one candidate per rule. */
export function extractMemories(text: string): MemoryCandidate[] {
  if (text.trim().endsWith("?")) return [];
  const out: MemoryCandidate[] = [];
  const seenKeys = new Set<string>();
  for (const rule of RULES) {
    const m = text.match(rule.re);
    if (!m) continue;
    const c = rule.build(m);
    if (!c || c.content.length < 8) continue;
    if (c.key && seenKeys.has(c.key)) continue;
    // Never store passwords, card or ID numbers, even when asked to remember them.
    if (containsSensitiveData(c.content)) continue;
    if (c.key) seenKeys.add(c.key);
    // Dislike rules come first, so skip a "likes" match that is part of a negation.
    if (c.content.startsWith("{{user}} likes") && out.some((o) => o.content.startsWith("{{user}} dislikes"))) continue;
    out.push(c);
  }
  return out;
}

const activeWhere = (now: Date) => ({ supersededById: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] });

/** Save extracted memories with provenance, resolving conflicts on the same slot key. */
export async function recordUserStatedMemories(args: {
  user: Pick<User, "id" | "memoryEnabled">;
  characterId: string;
  conversationId: string | null;
  messageId: string;
  text: string;
  now?: Date;
}) {
  if (!args.user.memoryEnabled) return [];
  const now = args.now ?? new Date();
  const candidates = extractMemories(args.text);
  if (!candidates.length) return [];
  const saved: Memory[] = [];
  for (const c of candidates) saved.push(await upsertMemory(args.user.id, args.characterId, { ...c, source: "user_stated", confidence: 0.9 }, now, args.conversationId, [args.messageId]));
  await enforceLimit(args.user.id, args.characterId, now);
  return saved;
}

export async function upsertMemory(
  userId: string,
  characterId: string,
  c: MemoryCandidate & { source: string; confidence: number },
  now: Date,
  conversationId: string | null,
  sourceMessageIds: string[],
) {
  const scope = { userId, characterId, ...activeWhere(now) };
  // Exact duplicate: refresh instead of storing twice.
  const dup = await db.memory.findFirst({ where: { ...scope, content: c.content } });
  if (dup) return db.memory.update({ where: { id: dup.id }, data: { updatedAt: now, importance: Math.max(dup.importance, c.importance) } });

  const expiresAt = c.type === "episodic" ? new Date(now.getTime() + EPISODIC_TTL_DAYS * 86400000) : null;
  const created = await db.memory.create({
    data: {
      userId,
      characterId,
      conversationId,
      type: c.type,
      key: c.key,
      content: c.content,
      source: c.source,
      confidence: c.confidence,
      importance: c.importance,
      sourceMessageIds: JSON.stringify(sourceMessageIds),
      expiresAt,
    },
  });
  // Conflict rule: for a slot (e.g. user.name) the newest explicit statement wins.
  // Older values are kept, marked superseded, so provenance is never lost.
  if (c.key) {
    await db.memory.updateMany({
      where: { userId, characterId, key: c.key, supersededById: null, id: { not: created.id } },
      data: { supersededById: created.id },
    });
  }
  return created;
}

/**
 * Keep total active memory within the plan's character budget. When over, the
 * least important (then oldest) memories expire first.
 */
export async function enforceLimit(userId: string, characterId: string, now = new Date()) {
  const { memoryCharLimit } = await getEntitlements(userId, now);
  const active = await db.memory.findMany({
    where: { userId, characterId, ...activeWhere(now) },
    orderBy: [{ importance: "asc" }, { updatedAt: "asc" }],
    select: { id: true, content: true },
  });
  let total = active.reduce((n, m) => n + m.content.length, 0);
  const drop: string[] = [];
  for (const m of active) {
    if (total <= memoryCharLimit) break;
    drop.push(m.id);
    total -= m.content.length;
  }
  if (drop.length) await db.memory.updateMany({ where: { id: { in: drop } }, data: { expiresAt: now } });
}

/** Characters of active memory used for a user + character. */
export async function memoryUsage(userId: string, characterId: string, now = new Date()) {
  const active = await db.memory.findMany({ where: { userId, characterId, ...activeWhere(now) }, select: { content: true } });
  return active.reduce((n, m) => n + m.content.length, 0);
}

// Thai is written without spaces, so split on word boundaries (ICU dictionary) instead of
// non-letters. Thai words are short in code units ("นก", "ปู"), so they need only 2.
const segmenter = new Intl.Segmenter("th", { granularity: "word" });
const THAI = /\p{Script=Thai}/u;
export const words = (s: string) =>
  new Set(
    [...segmenter.segment(s.toLowerCase())]
      .filter((seg) => seg.isWordLike)
      .map((seg) => seg.segment)
      .filter((w) => w.length > 2 || (THAI.test(w) && w.length >= 2)),
  );

/**
 * Relevance-ranked retrieval for one user + character. The (userId, characterId)
 * filter is the isolation boundary: memories never cross users.
 */
export async function retrieveMemories(userId: string, characterId: string, query: string, limit = 20, now = new Date()) {
  const rows = await db.memory.findMany({ where: { userId, characterId, ...activeWhere(now) }, take: 500, orderBy: { updatedAt: "desc" } });
  const q = words(query);
  const scored = rows.map((m) => {
    let overlap = 0;
    for (const w of words(m.content)) if (q.has(w)) overlap++;
    const ageDays = (now.getTime() - m.updatedAt.getTime()) / 86400000;
    const recency = Math.max(0, 1 - ageDays / 90);
    const score = m.importance * 1.0 + overlap * 2 + recency + m.confidence + (m.type === "world" ? 1 : 0);
    return { m, score };
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.m);
}

// ---- User-facing management API ----

export const memoryInputSchema = z.object({
  type: z.enum(MEMORY_TYPES),
  content: z.string().trim().min(3).max(500),
  importance: z.number().int().min(1).max(5).default(3),
});

export async function listMemories(user: User, characterId: string) {
  return db.memory.findMany({
    where: { userId: user.id, characterId, ...activeWhere(new Date()) },
    orderBy: [{ importance: "desc" }, { updatedAt: "desc" }],
  });
}

export async function addMemory(user: User, characterId: string, input: z.infer<typeof memoryInputSchema>) {
  const character = await db.character.findUnique({ where: { id: characterId }, select: { id: true } });
  if (!character) throw notFound("Character");
  if (containsSensitiveData(input.content)) {
    throw new AppError("validation_failed", "Memories cannot contain passwords, card numbers or ID numbers");
  }
  const content = tokenizeUserName(input.content, user.displayName);
  const m = await upsertMemory(user.id, characterId, { ...input, content, key: null, source: "user_edited", confidence: 1 }, new Date(), null, []);
  await enforceLimit(user.id, characterId, new Date());
  return m;
}

async function ownedMemory(user: User, id: string) {
  const m = await db.memory.findUnique({ where: { id } });
  if (!m || m.userId !== user.id) throw notFound("Memory");
  return m;
}

export async function editMemory(user: User, id: string, input: z.infer<typeof memoryInputSchema>) {
  await ownedMemory(user, id);
  return db.memory.update({ where: { id }, data: { ...input, content: tokenizeUserName(input.content, user.displayName), source: "user_edited", confidence: 1 } });
}

/** Hard delete (privacy): removes the memory and every superseded version of the same slot. */
export async function deleteMemory(user: User, id: string) {
  const m = await ownedMemory(user, id);
  await db.memory.deleteMany({ where: { userId: user.id, OR: [{ id }, { supersededById: id }, ...(m.key ? [{ characterId: m.characterId, key: m.key }] : [])] } });
}

export async function clearMemories(user: User, characterId: string) {
  const res = await db.memory.deleteMany({ where: { userId: user.id, characterId } });
  return res.count;
}
