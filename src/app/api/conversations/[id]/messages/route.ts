import { after } from "next/server";
import { ok, parseJson, route } from "@/server/http";
import { logger } from "@/server/logger";
import { maybeScanConversation } from "@/server/services/auto-memory";
import { requireUser } from "@/server/auth/guards";
import { rateLimit } from "@/server/rate-limit";
import { listMessages, messagesQuerySchema } from "@/server/services/conversations";
import { prepareGeneration, runGeneration, sendSchema, type ChatStreamEvent } from "@/server/services/chat";

type Ctx = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";
// Allow time for a full streamed AI reply on serverless hosts (60s fits every Vercel plan).
export const maxDuration = 60;

export const GET = route(async (req: Request, { params }: Ctx) => {
  const q = messagesQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  return ok(await listMessages(await requireUser(), (await params).id, q));
});

/**
 * Send a message (or regenerate / edit) and stream the reply as Server-Sent Events.
 * Validation, locking and charging happen before the stream opens, so those
 * failures come back as normal JSON errors.
 */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const user = await requireUser();
  rateLimit(`chat:${user.id}`, 30, 60 * 1000);
  const input = await parseJson(req, sendSchema);
  const prepared = await prepareGeneration(user, (await params).id, input);

  const conversationId = (await params).id;
  let finished!: () => void;
  const generationDone = new Promise<void>((resolve) => (finished = resolve));
  // After the reply is delivered: review the chat for things worth remembering
  // and refresh the character's note. Runs outside the user's wait time.
  after(async () => {
    await generationDone;
    await maybeScanConversation(user, conversationId).catch((err) =>
      logger.warn("auto_memory_error", { error: err instanceof Error ? err.message : "unknown" }),
    );
  });

  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream({
    start(controller) {
      const emit = (e: ChatStreamEvent) => {
        if (closed) throw new Error("closed");
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      };
      void runGeneration(user, prepared, emit).finally(() => {
        finished();
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      });
    },
    cancel() {
      // Client disconnected: stop writing, but let the generation finish and persist.
      closed = true;
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
});
