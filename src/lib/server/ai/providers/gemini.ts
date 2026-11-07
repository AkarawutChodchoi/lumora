import { ApiError, GoogleGenAI, HarmBlockThreshold, HarmCategory, ThinkingLevel, type Content, type GenerateContentConfig, type SafetySetting } from "@google/genai";
import type { AIProvider, GenerateRequest, StopReason, StreamEvent } from "../types";
import { ProviderError } from "../types";

// Finish reasons that mean Google's safety systems withheld the reply.
const BLOCKED = new Set(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"]);

// Roleplay needs room for swearing and insults (allowed by our policy). Google's filters
// are relaxed for harassment; hate speech, dangerous content and sexual content keep a backstop.
const SAFETY: SafetySetting[] = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
];

const LEVEL = { low: ThinkingLevel.LOW, medium: ThinkingLevel.MEDIUM, high: ThinkingLevel.HIGH } as const;

function mapStop(reason: string | undefined): StopReason {
  if (!reason || reason === "STOP") return "end_turn";
  if (reason === "MAX_TOKENS") return "max_tokens";
  if (BLOCKED.has(reason)) return "refusal";
  return "other";
}

/** Translate SDK errors into provider-neutral errors without leaking request details. */
function toProviderError(err: unknown, signal: AbortSignal): ProviderError {
  if (err instanceof ProviderError) return err;
  if (signal.aborted) {
    const timedOut = signal.reason instanceof DOMException && signal.reason.name === "TimeoutError";
    return timedOut ? new ProviderError("timeout", "The AI took too long to respond", true) : new ProviderError("cancelled", "Generation was cancelled");
  }
  if (err instanceof ApiError) {
    if (err.status === 401 || err.status === 403) return new ProviderError("authentication", "The AI service is not configured correctly");
    if (err.status === 429) return new ProviderError("rate_limit", "The AI service is busy. Please try again shortly.", true);
    if (err.status === 400) return new ProviderError("invalid_request", "The AI service rejected the request");
    return new ProviderError("provider", "The AI service is temporarily unavailable", err.status >= 500);
  }
  return new ProviderError("provider", "Unexpected error from the AI service", true);
}

/**
 * Google Gemini adapter. Model names that are not Gemini models (e.g. the Claude
 * defaults in admin settings) fall back to this provider's default model, so
 * switching providers never requires editing routing settings first.
 *
 * Free-tier quotas are per model, so when a model reports 429 before producing any
 * text, the next model in the fallback list is tried before giving up.
 */
export class GeminiProvider implements AIProvider {
  readonly name = "gemini";
  readonly isDevelopmentStub = false;
  readonly capabilities = { streaming: true, effort: true, realUsage: true };
  private client: GoogleGenAI;

  constructor(
    apiKey: string,
    private readonly defaultModel: string,
    private readonly fallbackModels: string[] = [],
  ) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async *stream(req: GenerateRequest): AsyncIterable<StreamEvent> {
    const first = req.model.startsWith("gemini") ? req.model : this.defaultModel;
    const models = [...new Set([first, ...this.fallbackModels, this.defaultModel].filter(Boolean))];
    const signal = req.signal ? AbortSignal.any([req.signal, AbortSignal.timeout(req.timeoutMs)]) : AbortSignal.timeout(req.timeoutMs);
    const contents: Content[] = req.messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));

    for (let i = 0; i < models.length; i++) {
      const model = models[i];
      const config: GenerateContentConfig = {
        systemInstruction: req.systemBlocks.map((b) => b.text).join("\n\n"),
        maxOutputTokens: req.maxOutputTokens,
        abortSignal: signal,
        safetySettings: SAFETY,
        // Gemini 3 models take a thinking level; keep chat replies quick.
        ...(model.startsWith("gemini-3") && req.effort ? { thinkingConfig: { thinkingLevel: LEVEL[req.effort] } } : {}),
      };

      let finish: string | undefined;
      let input = 0;
      let output = 0;
      let produced = false;
      try {
        const stream = await this.client.models.generateContentStream({ model, contents, config });
        for await (const chunk of stream) {
          const blocked = chunk.promptFeedback?.blockReason;
          if (blocked) throw new ProviderError("content_policy", "The AI declined to continue this part of the story. Try steering it differently.");
          const text = chunk.text;
          if (text) {
            produced = true;
            yield { type: "text", text };
          }
          finish = chunk.candidates?.[0]?.finishReason ?? finish;
          const u = chunk.usageMetadata;
          if (u) {
            input = u.promptTokenCount ?? input;
            // Thinking tokens are billed as output.
            output = (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) || output;
          }
        }
      } catch (err) {
        const quotaHit = err instanceof ApiError && err.status === 429 && !produced && !signal.aborted;
        if (quotaHit && i < models.length - 1) continue; // try the next model's quota
        throw toProviderError(err, signal);
      }
      const stopReason = mapStop(finish);
      if (!produced && stopReason === "end_turn") throw new ProviderError("provider", "The AI returned an empty reply");
      yield { type: "done", stopReason, model, usage: { inputTokens: input, outputTokens: output } };
      return;
    }
  }
}
