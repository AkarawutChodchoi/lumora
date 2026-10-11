import { randomUUID } from "node:crypto";
import { Prisma, type User } from "@prisma/client";
import { z } from "zod";
import { db } from "../db";
import { AppError, notFound } from "../errors";
import { logger } from "../logger";
import { assertCanAct } from "../auth/guards";
import { assemblePrompt, PROMPT_VERSION, type ContentRating, type ResponseStyle } from "../ai/prompt";
import { priceOf } from "../ai/models";
import { getProvider, routeModel } from "../ai/registry";
import { ProviderError, type ChatTurn, type TokenUsage } from "../ai/types";
import { canSeeRating, parseSnapshot } from "./characters";
import { applyLedgerEntry, postLedgerEntry } from "./credits";
import { recordUserStatedMemories, retrieveMemories } from "./memory";
import { moderateText, SELF_HARM_RESOURCES } from "./moderation";
import { getAiSettings, getFeatureFlags } from "./settings";
import { toClientMessage, type ClientMessage } from "./conversations";

// Message lifecycle
//   user message: created "completed".
//   assistant message: "pending" -> "streaming" -> "completed" | "failed" | "cancelled".
// Regenerate / edit never rewrite history: the replaced messages are marked
// isActive = false and new ones are appended with higher sequence numbers.
//
// Credits: the cost is charged up-front inside the same transaction that
// creates the messages (atomic, idempotent per generation), and refunded if
// the generation fails, is blocked, or is cancelled before producing any text.
//
// Client disconnects do NOT cancel generation: the reply keeps generating and
// is saved, so it appears when the user returns. Only an explicit cancel stops it.

export const sendSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("send"), content: z.string().trim().min(1, "Message is empty").max(4000), clientRequestId: z.string().min(8).max(64) }),
  z.object({ mode: z.literal("regenerate"), clientRequestId: z.string().min(8).max(64) }),
  z.object({ mode: z.literal("edit"), messageId: z.string().min(1), content: z.string().trim().min(1).max(4000), clientRequestId: z.string().min(8).max(64) }),
]);
export type SendInput = z.infer<typeof sendSchema>;

// The chat route's maxDuration is 60s, so a generation still open after this is dead
// (the serverless function was stopped) and is closed out by reapStaleGeneration.
export const STALE_LOCK_MS = 75 * 1000;
// A worker polls for cancel requests every second; if it has not finished a cancel
// after this long, it is gone and the cancel is completed on its behalf.
const CANCEL_GRACE_MS = 4000;
const PERSIST_EVERY_MS = 800;

export type ChatStreamEvent =
  | { type: "start"; generationId: string; userMessage: ClientMessage | null; assistantMessageId: string; replacedMessageIds: string[]; devMode: boolean; notice?: string }
  | { type: "delta"; text: string }
  | { type: "done"; message: ClientMessage; balance: number }
  | { type: "error"; code: string; message: string; balance?: number };

interface Prepared {
  generationId: string;
  conversationId: string;
  characterId: string;
  assistantMessageId: string;
  userMessage: ClientMessage | null;
  userText: string | null;
  userMessageId: string | null;
  replacedMessageIds: string[];
  cost: number;
  model: string;
  notice?: string;
}

/** Validate, lock the conversation, create messages and charge credits — all atomically. */
export async function prepareGeneration(user: User, conversationId: string, input: SendInput): Promise<Prepared> {
  assertCanAct(user);
  const conv = await db.conversation.findUnique({ where: { id: conversationId }, include: { character: true } });
  if (!conv || conv.userId !== user.id) throw notFound("Conversation");
  if (conv.status !== "active") throw new AppError("conflict", "This conversation is archived");
  if (conv.character.publicationStatus === "suspended") throw new AppError("forbidden", "This character has been suspended and can no longer chat");
  // Mature stories continue only while the user is a confirmed adult who opted in.
  if (conv.character.contentRating === "mature" && !canSeeRating(user, "mature")) {
    throw new AppError("forbidden", "This character is rated mature (18+ only)");
  }

  let notice: string | undefined;
  if (input.mode !== "regenerate") {
    const mod = moderateText(input.content, "user_message");
    if (mod.action === "block") throw new AppError("content_blocked", mod.userMessage ?? "This message is not allowed");
    if (mod.category === "self_harm") notice = SELF_HARM_RESOURCES;
  }

  const { model, cost } = routeModel(user.chatModel);
  const generationId = randomUUID();

  await acquireLock(conversationId, generationId);
  try {
    const result = await db.$transaction(async (tx) => {
      await tx.generation.create({
        data: { id: generationId, userId: user.id, conversationId, idempotencyKey: input.clientRequestId, status: "pending", model, promptVersion: PROMPT_VERSION, costCoins: cost },
      });

      const active = await tx.message.findMany({ where: { conversationId, isActive: true }, orderBy: { sequence: "desc" }, take: 2 });
      const last = active[0];
      let seq = conv.nextSequence;
      const replaced: string[] = [];
      let userMsg = null as Awaited<ReturnType<typeof tx.message.create>> | null;
      let replyToId: string | null = null;

      if (input.mode === "send") {
        userMsg = await tx.message.create({ data: { conversationId, sequence: seq++, role: "user", content: input.content } });
        replyToId = userMsg.id;
      } else if (input.mode === "regenerate") {
        if (!last || last.role !== "assistant" || last.sequence === 1) throw new AppError("conflict", "There is no reply to regenerate");
        await tx.message.update({ where: { id: last.id }, data: { isActive: false } });
        replaced.push(last.id);
        replyToId = last.replyToId;
      } else {
        // Edit: only the latest user message (and the reply to it) can be replaced.
        const target = active.find((m) => m.id === input.messageId);
        const isLatestUser = target && target.role === "user" && (last.id === target.id || (active[1]?.id === target.id && last.role === "assistant"));
        if (!target || !isLatestUser) throw new AppError("conflict", "Only your latest message can be edited");
        const toDeactivate = active.filter((m) => m.sequence >= target.sequence).map((m) => m.id);
        await tx.message.updateMany({ where: { id: { in: toDeactivate } }, data: { isActive: false } });
        replaced.push(...toDeactivate);
        userMsg = await tx.message.create({ data: { conversationId, sequence: seq++, role: "user", content: input.content } });
        replyToId = userMsg.id;
      }

      const assistant = await tx.message.create({
        data: { conversationId, sequence: seq++, role: "assistant", content: "", status: "pending", replyToId, generationId },
      });
      await tx.conversation.update({ where: { id: conversationId }, data: { nextSequence: seq, lastMessageAt: new Date() } });

      if (cost > 0) {
        await applyLedgerEntry(tx, {
          userId: user.id,
          delta: -cost,
          type: "generation_charge",
          idempotencyKey: `gen:${generationId}:charge`,
          referenceType: "generation",
          referenceId: generationId,
        });
      }
      return { userMsg, assistant, replaced };
    });

    return {
      generationId,
      conversationId,
      characterId: conv.characterId,
      assistantMessageId: result.assistant.id,
      userMessage: result.userMsg ? toClientMessage(result.userMsg) : null,
      userText: result.userMsg?.content ?? null,
      userMessageId: result.userMsg?.id ?? null,
      replacedMessageIds: result.replaced,
      cost,
      model,
      notice,
    };
  } catch (err) {
    await releaseLock(conversationId, generationId);
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new AppError("conflict", "This message was already sent");
    }
    throw err;
  }
}

/** One generation per conversation at a time. Stale locks (crashed workers) are reclaimed. */
async function acquireLock(conversationId: string, generationId: string) {
  const take = () => db.conversation.updateMany({ where: { id: conversationId, activeGenerationId: null }, data: { activeGenerationId: generationId } });
  if ((await take()).count === 1) return;
  if (!(await reapStaleGeneration(conversationId)) && (await take()).count === 1) return;
  throw new AppError("conflict", "A reply is already being generated. Wait for it to finish or stop it first.");
}

async function releaseLock(conversationId: string, generationId: string) {
  await db.conversation.updateMany({ where: { id: conversationId, activeGenerationId: generationId }, data: { activeGenerationId: null } });
}

async function refund(userId: string, generationId: string, cost: number) {
  if (cost <= 0) return;
  await postLedgerEntry({
    userId,
    delta: cost,
    type: "generation_refund",
    idempotencyKey: `gen:${generationId}:refund`,
    referenceType: "generation",
    referenceId: generationId,
  });
}

async function failGeneration(generationId: string, userId: string, conversationId: string, code: string, messageId: string | null) {
  const gen = await db.generation.update({ where: { id: generationId }, data: { status: "failed", errorCode: code, completedAt: new Date() } });
  if (messageId) await db.message.update({ where: { id: messageId }, data: { status: "failed", errorCode: code } });
  else await db.message.updateMany({ where: { generationId, status: { in: ["pending", "streaming"] } }, data: { status: "failed", errorCode: code } });
  await refund(userId, generationId, gen.costCoins);
  await releaseLock(conversationId, generationId);
}

/** Build the provider prompt from the pinned character version, memories and active history. */
async function buildContext(user: User, p: Prepared) {
  const conv = await db.conversation.findUniqueOrThrow({
    where: { id: p.conversationId },
    include: { characterVersion: true, character: { select: { contentRating: true } } },
  });
  const settings = await getAiSettings();
  const snapshot = parseSnapshot(conv.characterVersion.snapshot);
  const history = await db.message.findMany({
    where: { conversationId: p.conversationId, isActive: true, status: "completed", id: { not: p.assistantMessageId } },
    orderBy: { sequence: "desc" },
    take: 200,
  });
  const turns: ChatTurn[] = history.reverse().map((m) => ({ role: m.role as ChatTurn["role"], content: m.content }));
  const lastUser = [...turns].reverse().find((t) => t.role === "user")?.content ?? "";
  const memories = user.memoryEnabled ? await retrieveMemories(user.id, p.characterId, lastUser) : [];
  return {
    settings,
    prompt: assemblePrompt({
      character: snapshot,
      // Mature guidance only for opted-in adults; everyone else gets the safer level.
      rating: (conv.character.contentRating === "mature" && !canSeeRating(user, "mature") ? "teen" : conv.character.contentRating) as ContentRating,
      userName: user.displayName,
      style: user.responseStyle as ResponseStyle,
      memories: memories.map((m) => ({ type: m.type, content: m.content, source: m.source })),
      history: turns,
      budget: { contextTokens: settings.contextTokenBudget, memoryTokens: settings.memoryTokenBudget },
    }),
  };
}

/**
 * Stream the reply. `emit` may throw (client went away); generation continues and
 * the result is persisted regardless. Returns when the generation is finalised.
 */
export async function runGeneration(user: User, p: Prepared, emit: (e: ChatStreamEvent) => void) {
  const send = (e: ChatStreamEvent) => {
    try {
      emit(e);
    } catch {
      /* client disconnected — keep generating */
    }
  };
  const provider = getProvider(p.model);
  const controller = new AbortController();
  const started = Date.now();
  let text = "";
  let usage: TokenUsage | null = null;
  let stopReason = "end_turn";
  let servedModel = p.model;
  let cancelPoll: ReturnType<typeof setInterval> | undefined;

  send({
    type: "start",
    generationId: p.generationId,
    userMessage: p.userMessage,
    assistantMessageId: p.assistantMessageId,
    replacedMessageIds: p.replacedMessageIds,
    devMode: provider.isDevelopmentStub,
    notice: p.notice,
  });

  // Memory capture from the user's own words (explicit facts only).
  const flags = await getFeatureFlags();
  if (flags.memoryExtraction && p.userText && p.userMessageId) {
    await recordUserStatedMemories({ user, characterId: p.characterId, conversationId: p.conversationId, messageId: p.userMessageId, text: p.userText }).catch((err) =>
      logger.warn("memory_extraction_failed", { error: err instanceof Error ? err.message : "unknown" }),
    );
  }

  try {
    const { settings, prompt } = await buildContext(user, p);
    await db.generation.updateMany({ where: { id: p.generationId, status: "pending" }, data: { status: "streaming", provider: provider.name } });
    await db.message.update({ where: { id: p.assistantMessageId }, data: { status: "streaming" } });

    // Poll for cancel requests (works across server instances, even before the first token).
    cancelPoll = setInterval(() => {
      db.generation
        .findUnique({ where: { id: p.generationId }, select: { status: true } })
        .then((g) => {
          // Stop on a cancel request, or if the generation was closed out elsewhere.
          if (g && g.status !== "pending" && g.status !== "streaming") controller.abort();
        })
        .catch(() => {});
    }, 1000);

    let lastPersist = Date.now();
    for await (const ev of provider.stream({
      model: p.model,
      systemBlocks: prompt.systemBlocks,
      messages: prompt.messages,
      maxOutputTokens: settings.maxOutputTokens,
      effort: settings.effort,
      timeoutMs: settings.requestTimeoutMs,
      signal: controller.signal,
    })) {
      if (ev.type === "text") {
        text += ev.text;
        send({ type: "delta", text: ev.text });
        if (Date.now() - lastPersist > PERSIST_EVERY_MS) {
          lastPersist = Date.now();
          // Persist partial text so a crash or disconnect never loses the whole reply.
          await db.message.update({ where: { id: p.assistantMessageId }, data: { content: text } });
        }
      } else {
        usage = ev.usage;
        stopReason = ev.stopReason;
        servedModel = ev.model;
      }
    }

    if (stopReason === "refusal") throw new ProviderError("content_policy", "The AI declined to continue this part of the story. Try steering it differently.");
    const mod = moderateText(text, "ai_output");
    if (mod.action === "block") throw new ProviderError("content_policy", mod.userMessage ?? "The reply was withheld by the content policy.");
    if (!text.trim()) throw new ProviderError("provider", "The AI returned an empty reply");

    const msg = await db.message.update({
      where: { id: p.assistantMessageId },
      data: { content: text, status: "completed", flagged: mod.action === "flag" },
    });
    await db.generation.update({
      where: { id: p.generationId },
      data: {
        status: "completed",
        model: servedModel,
        inputTokens: provider.capabilities.realUsage ? usage?.inputTokens : null,
        outputTokens: provider.capabilities.realUsage ? usage?.outputTokens : null,
        latencyMs: Date.now() - started,
        completedAt: new Date(),
        errorCode: stopReason === "max_tokens" ? "truncated" : null,
      },
    });
    await releaseLock(p.conversationId, p.generationId);
    await db.conversation.update({ where: { id: p.conversationId }, data: { lastMessageAt: new Date() } });
    await refundFallbackDifference(user.id, p, servedModel);
    send({ type: "done", message: toClientMessage(msg), balance: await balanceOf(user.id) });
  } catch (err) {
    const pe = err instanceof ProviderError ? err : null;
    if (!pe) logger.error("generation_failed", { generationId: p.generationId, error: err instanceof Error ? err.message : "unknown" });
    else logger.warn("generation_provider_error", { generationId: p.generationId, kind: pe.kind });

    if (pe?.kind === "cancelled") {
      await finishCancelled(user.id, p, text, Date.now() - started);
      const msg = await db.message.findUniqueOrThrow({ where: { id: p.assistantMessageId } });
      send({ type: "done", message: toClientMessage(msg), balance: await balanceOf(user.id) });
      return;
    }
    const code = pe?.kind ?? "internal";
    // Content-policy failures discard the partial text; other failures keep it for context.
    await db.message.update({ where: { id: p.assistantMessageId }, data: { content: code === "content_policy" ? "" : text } });
    await failGeneration(p.generationId, user.id, p.conversationId, code, p.assistantMessageId);
    send({ type: "error", code, message: pe?.message ?? "Something went wrong while generating the reply.", balance: await balanceOf(user.id) });
  } finally {
    clearInterval(cancelPoll);
  }
}

async function finishCancelled(userId: string, p: Prepared, text: string, latencyMs: number) {
  const gen = await db.generation.update({
    where: { id: p.generationId },
    data: { status: "cancelled", completedAt: new Date(), latencyMs },
  });
  await db.message.update({ where: { id: p.assistantMessageId }, data: { content: text, status: text.trim() ? "completed" : "cancelled" } });
  // Policy: cancelling before any text is produced is free.
  if (!text.trim()) {
    await db.message.update({ where: { id: p.assistantMessageId }, data: { isActive: false } });
    await refund(userId, p.generationId, gen.costCoins);
  }
  await releaseLock(p.conversationId, p.generationId);
}

/** Coins to give back when a cheaper model served the reply (never negative). */
export function fallbackRefund(chargedModel: string, charged: number, servedModel: string): number {
  if (servedModel === chargedModel) return 0;
  const served = priceOf(servedModel);
  return served === null ? 0 : Math.max(0, charged - served);
}

/**
 * When the chosen model was out of quota and a cheaper one answered instead,
 * give back the price difference (idempotent per generation).
 */
async function refundFallbackDifference(userId: string, p: Prepared, servedModel: string) {
  const diff = fallbackRefund(p.model, p.cost, servedModel);
  if (diff <= 0) return;
  await postLedgerEntry({
    userId,
    delta: diff,
    type: "generation_refund",
    idempotencyKey: `gen:${p.generationId}:fallback`,
    referenceType: "generation",
    referenceId: p.generationId,
  });
}

async function balanceOf(userId: string) {
  return (await db.creditAccount.findUnique({ where: { userId } }))?.balance ?? 0;
}

/**
 * Close out a generation whose worker is gone: keep any partial text (charged, it was
 * delivered) or, with no text, mark it failed and refund. Always frees the conversation.
 */
async function closeOut(generationId: string) {
  const gen = await db.generation.findUnique({ where: { id: generationId } });
  if (!gen || !["pending", "streaming", "cancel_requested"].includes(gen.status)) return;
  const msg = await db.message.findFirst({ where: { generationId, role: "assistant" } });
  if (msg?.content.trim()) {
    const done = await db.generation.updateMany({ where: { id: generationId, status: gen.status }, data: { status: "cancelled", completedAt: new Date(), errorCode: "stale" } });
    if (done.count) await db.message.update({ where: { id: msg.id }, data: { status: "completed" } });
    await releaseLock(gen.conversationId, generationId);
  } else if (gen.status === "cancel_requested") {
    // Stopped before any text: same outcome as a normal cancel (free, reply removed).
    await db.generation.update({ where: { id: generationId }, data: { status: "cancelled", completedAt: new Date() } });
    if (msg) await db.message.update({ where: { id: msg.id }, data: { status: "cancelled", isActive: false } });
    await refund(gen.userId, generationId, gen.costCoins);
    await releaseLock(gen.conversationId, generationId);
  } else {
    await failGeneration(generationId, gen.userId, gen.conversationId, "stale", msg?.id ?? null);
    if (msg) await db.message.update({ where: { id: msg.id }, data: { isActive: false } });
  }
  logger.warn("generation_closed_out", { generationId, previous: gen.status });
}

/** If the conversation's running reply is stale (its worker died), close it out. Returns true if it is still running. */
export async function reapStaleGeneration(conversationId: string): Promise<boolean> {
  const conv = await db.conversation.findUnique({ where: { id: conversationId }, select: { activeGenerationId: true } });
  if (!conv?.activeGenerationId) return false;
  const gen = await db.generation.findUnique({ where: { id: conv.activeGenerationId } });
  if (!gen || !["pending", "streaming", "cancel_requested"].includes(gen.status)) {
    await releaseLock(conversationId, conv.activeGenerationId);
    return false;
  }
  if (Date.now() - gen.createdAt.getTime() > STALE_LOCK_MS) {
    await closeOut(gen.id);
    return false;
  }
  return true;
}

/** Request cancellation. A live worker stops within ~1 second; a dead one is closed out here. */
export async function cancelGeneration(user: User, generationId: string) {
  const gen = await db.generation.findUnique({ where: { id: generationId } });
  if (!gen || gen.userId !== user.id) throw notFound("Generation");
  if (!["pending", "streaming", "cancel_requested"].includes(gen.status)) return { status: gen.status };
  await db.generation.updateMany({ where: { id: generationId, status: { in: ["pending", "streaming"] } }, data: { status: "cancel_requested" } });
  await new Promise((r) => setTimeout(r, CANCEL_GRACE_MS));
  const after = await db.generation.findUnique({ where: { id: generationId }, select: { status: true } });
  if (after?.status === "cancel_requested") await closeOut(generationId);
  const final = await db.generation.findUnique({ where: { id: generationId }, select: { status: true } });
  return { status: final?.status ?? "cancelled" };
}
