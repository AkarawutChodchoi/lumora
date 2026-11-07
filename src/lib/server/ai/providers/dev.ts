import type { AIProvider, GenerateRequest, StreamEvent } from "../types";
import { ProviderError } from "../types";

/**
 * DEVELOPMENT ONLY. Produces a clearly-labelled placeholder reply so the chat
 * pipeline (streaming, persistence, credits, memory) can be exercised without
 * an API key. It is NOT an AI and never pretends to be one: every reply starts
 * with a "[Dev mode]" label, and the UI shows a banner while it is active.
 */
export class DevProvider implements AIProvider {
  readonly name = "dev";
  readonly isDevelopmentStub = true;
  readonly capabilities = { streaming: true, effort: false, realUsage: false };

  async *stream(req: GenerateRequest): AsyncIterable<StreamEvent> {
    const last = [...req.messages].reverse().find((m) => m.role === "user")?.content ?? "";
    if (last.includes("__dev_fail__")) throw new ProviderError("provider", "Simulated provider failure (dev mode)", true);
    const withMemory = req.systemBlocks.some((b) => b.text.startsWith("<memories>"));
    const reply =
      `[Dev mode — not a real AI reply / โหมดทดสอบ ไม่ใช่คำตอบจาก AI จริง] ` +
      `Received your message (${last.length} characters) · ได้รับข้อความแล้ว (${last.length} ตัวอักษร). ` +
      `Set ANTHROPIC_API_KEY for real replies · ตั้งค่า ANTHROPIC_API_KEY เพื่อให้ตัวละครตอบจริง.` +
      (withMemory ? " Memories included · มีการใช้ความจำ." : "");
    for (const word of reply.split(/(\s+)/)) {
      if (req.signal?.aborted) throw new ProviderError("cancelled", "Generation was cancelled");
      await new Promise((r) => setTimeout(r, 15));
      yield { type: "text", text: word };
    }
    yield { type: "done", usage: null, stopReason: "end_turn", model: "dev-echo" };
  }
}
