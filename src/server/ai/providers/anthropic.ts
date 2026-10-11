import Anthropic from "@anthropic-ai/sdk";
import type { AIProvider, GenerateRequest, StopReason, StreamEvent } from "../types";
import { ProviderError } from "../types";

// Models that accept the server-side refusal fallback (`fallbacks: "default"`).
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"]);
// Models that accept `output_config.effort`.
const EFFORT_PREFIXES = ["claude-opus-5", "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6", "claude-sonnet-5", "claude-sonnet-4-6", "claude-haiku-5-5", "claude-fable-5"];

function mapStop(reason: string | null | undefined): StopReason {
  if (reason === "end_turn" || reason === "stop_sequence") return "end_turn";
  if (reason === "max_tokens") return "max_tokens";
  if (reason === "refusal") return "refusal";
  return "other";
}

/** Translate SDK errors into provider-neutral errors without leaking request details. */
function toProviderError(err: unknown, signal?: AbortSignal): ProviderError {
  if (signal?.aborted || err instanceof Anthropic.APIUserAbortError) return new ProviderError("cancelled", "Generation was cancelled");
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new ProviderError("authentication", "The AI service is not configured correctly");
  }
  if (err instanceof Anthropic.RateLimitError) return new ProviderError("rate_limit", "The AI service is busy. Please try again shortly.", true);
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new ProviderError("timeout", "The AI took too long to respond", true);
  if (err instanceof Anthropic.BadRequestError) return new ProviderError("invalid_request", "The AI service rejected the request");
  if (err instanceof Anthropic.InternalServerError || err instanceof Anthropic.APIConnectionError) {
    return new ProviderError("provider", "The AI service is temporarily unavailable", true);
  }
  if (err instanceof Anthropic.APIError) return new ProviderError("provider", "The AI service returned an error", (err.status ?? 500) >= 500);
  return new ProviderError("provider", "Unexpected error from the AI service");
}

export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";
  readonly isDevelopmentStub = false;
  readonly capabilities = { streaming: true, effort: true, realUsage: true };
  private client: Anthropic;

  constructor(apiKey: string) {
    // Key stays server-side; the SDK retries 408/409/429/5xx up to twice before the stream starts.
    this.client = new Anthropic({ apiKey, maxRetries: 2 });
  }

  async *stream(req: GenerateRequest): AsyncIterable<StreamEvent> {
    const useFallback = FALLBACK_MODELS.has(req.model);
    const supportsEffort = EFFORT_PREFIXES.some((p) => req.model.startsWith(p));
    let stream;
    try {
      stream = this.client.beta.messages.stream(
        {
          model: req.model,
          max_tokens: req.maxOutputTokens,
          system: req.systemBlocks.map((b) => ({
            type: "text" as const,
            text: b.text,
            ...(b.cacheable ? { cache_control: { type: "ephemeral" as const } } : {}),
          })),
          messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
          ...(supportsEffort && req.effort ? { output_config: { effort: req.effort } } : {}),
          // Retry classifier refusals on Anthropic's recommended fallback model.
          ...(useFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
        },
        { signal: req.signal, timeout: req.timeoutMs },
      );

      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield { type: "text", text: event.delta.text };
        }
      }
      const final = await stream.finalMessage();
      const u = final.usage;
      yield {
        type: "done",
        stopReason: mapStop(final.stop_reason),
        model: final.model,
        usage: {
          inputTokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
          outputTokens: u.output_tokens ?? 0,
        },
      };
    } catch (err) {
      throw toProviderError(err, req.signal);
    }
  }
}
