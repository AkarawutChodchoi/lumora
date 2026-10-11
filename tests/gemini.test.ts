import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerateRequest, StreamEvent } from "@/server/ai/types";

// Fake the Google SDK: each test sets what generateContentStream yields or throws.
const state: { chunks: unknown[]; error: unknown; lastArgs: unknown; errorFor: Record<string, unknown>; calls: string[] } = { chunks: [], error: null, lastArgs: null, errorFor: {}, calls: [] };

vi.mock("@google/genai", () => {
  class ApiError extends Error {
    status: number;
    constructor(o: { message: string; status: number }) {
      super(o.message);
      this.status = o.status;
    }
  }
  class GoogleGenAI {
    models = {
      generateContentStream: async (args: unknown) => {
        state.lastArgs = args;
        const model = (args as { model: string }).model;
        state.calls.push(model);
        if (state.errorFor[model]) throw state.errorFor[model];
        if (state.error) throw state.error;
        return (async function* () {
          for (const c of state.chunks) yield c;
        })();
      },
    };
  }
  return {
    ApiError,
    GoogleGenAI,
    ThinkingLevel: { LOW: "LOW", MEDIUM: "MEDIUM", HIGH: "HIGH" },
    HarmCategory: { HARM_CATEGORY_HARASSMENT: "HARASSMENT", HARM_CATEGORY_HATE_SPEECH: "HATE", HARM_CATEGORY_DANGEROUS_CONTENT: "DANGEROUS", HARM_CATEGORY_SEXUALLY_EXPLICIT: "SEXUAL" },
    HarmBlockThreshold: { BLOCK_NONE: "NONE", BLOCK_ONLY_HIGH: "HIGH", BLOCK_MEDIUM_AND_ABOVE: "MEDIUM" },
  };
});

const { GeminiProvider } = await import("@/server/ai/providers/gemini");
const { ApiError } = await import("@google/genai");

const req = (over: Partial<GenerateRequest> = {}): GenerateRequest => ({
  model: "claude-opus-5-5",
  systemBlocks: [{ text: "POLICY", cacheable: true }, { text: "<memories>m</memories>", cacheable: false }],
  messages: [
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
    { role: "user", content: "how are you?" },
  ],
  maxOutputTokens: 512,
  effort: "low",
  timeoutMs: 5000,
  ...over,
});

async function collect(p: InstanceType<typeof GeminiProvider>, r = req()) {
  const out: StreamEvent[] = [];
  for await (const e of p.stream(r)) out.push(e);
  return out;
}

beforeEach(() => {
  state.chunks = [];
  state.error = null;
  state.lastArgs = null;
  state.errorFor = {};
  state.calls = [];
});

describe("Gemini provider", () => {
  const provider = new GeminiProvider("test-key", "gemini-3.8-flash");

  it("streams text, maps roles and system prompt, and reports real usage", async () => {
    state.chunks = [
      { text: "Hel" },
      { text: "lo!", candidates: [{ finishReason: "STOP" }], usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 20, thoughtsTokenCount: 5 } },
    ];
    const events = await collect(provider);
    expect(events.filter((e) => e.type === "text").map((e) => (e as { text: string }).text).join("")).toBe("Hello!");
    expect(events.at(-1)).toEqual({ type: "done", stopReason: "end_turn", model: "gemini-3.8-flash", usage: { inputTokens: 120, outputTokens: 25 } });
    const args = state.lastArgs as { model: string; contents: { role: string }[]; config: { systemInstruction: string; maxOutputTokens: number; thinkingConfig?: unknown; safetySettings?: unknown[] } };
    // A non-Gemini model name falls back to the provider default.
    expect(args.model).toBe("gemini-3.8-flash");
    expect(args.contents.map((c) => c.role)).toEqual(["user", "model", "user"]);
    expect(args.config.systemInstruction).toContain("POLICY");
    expect(args.config.systemInstruction).toContain("<memories>");
    expect(args.config.maxOutputTokens).toBe(512);
    expect(args.config.thinkingConfig).toEqual({ thinkingLevel: "LOW" });
    // Harassment (insults) is not filtered by Google; other categories keep a backstop.
    expect(args.config.safetySettings).toContainEqual({ category: "HARASSMENT", threshold: "NONE" });
  });

  it("keeps an explicitly chosen Gemini model", async () => {
    state.chunks = [{ text: "ok", candidates: [{ finishReason: "STOP" }] }];
    const events = await collect(provider, req({ model: "gemini-2.5-flash" }));
    expect((state.lastArgs as { model: string }).model).toBe("gemini-2.5-flash");
    expect(events.at(-1)).toMatchObject({ model: "gemini-2.5-flash" });
  });

  it("treats Google safety blocks as a content-policy refusal", async () => {
    state.chunks = [{ text: "partial", candidates: [{ finishReason: "SAFETY" }] }];
    expect((await collect(provider)).at(-1)).toMatchObject({ type: "done", stopReason: "refusal" });
    state.chunks = [{ promptFeedback: { blockReason: "PROHIBITED_CONTENT" } }];
    await expect(collect(provider)).rejects.toMatchObject({ kind: "content_policy" });
  });

  it("maps HTTP errors to provider-neutral errors without leaking details", async () => {
    state.error = new ApiError({ message: "quota exceeded for key test-key", status: 429 });
    const err = await collect(provider).catch((e) => e);
    expect(err).toMatchObject({ kind: "rate_limit", retryable: true });
    expect(String(err.message)).not.toContain("test-key");
    state.error = new ApiError({ message: "bad key", status: 403 });
    await expect(collect(provider)).rejects.toMatchObject({ kind: "authentication" });
    state.error = new ApiError({ message: "boom", status: 503 });
    await expect(collect(provider)).rejects.toMatchObject({ kind: "provider", retryable: true });
  });

  it("falls back to the next model when one model's quota is used up", async () => {
    const withFallback = new GeminiProvider("test-key", "gemini-3.5-flash-lite", ["gemini-3.8-flash"]);
    state.errorFor["gemini-3.5-flash-lite"] = new ApiError({ message: "quota", status: 429 });
    state.chunks = [{ text: "hi", candidates: [{ finishReason: "STOP" }] }];
    const events = await collect(withFallback);
    expect(state.calls).toEqual(["gemini-3.5-flash-lite", "gemini-3.8-flash"]);
    expect(events.at(-1)).toMatchObject({ type: "done", model: "gemini-3.8-flash" });
  });

  it("reports busy only when every model's quota is used up", async () => {
    const withFallback = new GeminiProvider("test-key", "gemini-3.5-flash-lite", ["gemini-3.8-flash"]);
    state.error = new ApiError({ message: "quota", status: 429 });
    await expect(collect(withFallback)).rejects.toMatchObject({ kind: "rate_limit" });
    expect(state.calls).toEqual(["gemini-3.5-flash-lite", "gemini-3.8-flash"]);
  });

  it("reports cancellation when the caller aborts", async () => {
    const ctl = new AbortController();
    ctl.abort();
    state.error = new Error("aborted");
    await expect(collect(provider, req({ signal: ctl.signal }))).rejects.toMatchObject({ kind: "cancelled" });
  });

  it("flags an empty reply as an error", async () => {
    state.chunks = [{ candidates: [{ finishReason: "STOP" }] }];
    await expect(collect(provider)).rejects.toMatchObject({ kind: "provider" });
  });
});
