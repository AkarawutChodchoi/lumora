// Provider-neutral contracts. Chat and memory services depend only on these,
// so swapping or adding a provider never touches business logic.

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface GenerateRequest {
  model: string;
  /** System prompt split into blocks; `cacheable` marks stable prefixes for providers that support prompt caching. */
  systemBlocks: { text: string; cacheable: boolean }[];
  messages: ChatTurn[];
  maxOutputTokens: number;
  effort?: "low" | "medium" | "high";
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export type StopReason = "end_turn" | "max_tokens" | "refusal" | "other";

export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "done"; usage: TokenUsage | null; stopReason: StopReason; model: string };

export type ProviderErrorKind = "authentication" | "rate_limit" | "timeout" | "content_policy" | "provider" | "invalid_request" | "cancelled";

/** Errors from a provider, normalised. `message` must be safe to show users (no keys or internals). */
export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

export interface ProviderCapabilities {
  streaming: boolean;
  effort: boolean;
  /** Whether usage numbers come from the provider (false for the dev provider). */
  realUsage: boolean;
}

export interface AIProvider {
  readonly name: string;
  /** True for the development echo provider: replies are NOT real AI generations. */
  readonly isDevelopmentStub: boolean;
  readonly capabilities: ProviderCapabilities;
  stream(req: GenerateRequest): AsyncIterable<StreamEvent>;
}
