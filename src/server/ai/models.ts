import { activeAiProvider, config, type AiProviderName } from "../config";

// Chat models users can pick from, with their price in coins per reply.
// Prices are set server-side only and charged before generation (refunded on failure).
//
// Pricing rule of thumb: 1 coin ≈ 0.26–0.33 THB (see COIN_PACKAGES). A typical reply
// uses ~6k input + ~500 output tokens, so the price below keeps a healthy margin
// over the provider's list price for that model while staying simple for users.

export interface ChatModel {
  id: string;
  provider: AiProviderName;
  /** Short label shown in the picker. */
  label: string;
  /** Key into the `chat.models` dictionary for the one-line description. */
  blurb: "lite" | "balanced" | "smart" | "pro" | "dev";
  cost: number;
  /** Relative quality, 1–5, shown as stars. */
  quality: number;
  /** Needs a paid provider plan (the free tier has no quota for it). */
  paidOnly?: boolean;
}

export const CHAT_MODELS: ChatModel[] = [
  { id: "gemini-3.5-flash-lite", provider: "gemini", label: "Gemini Flash-Lite", blurb: "lite", cost: 5, quality: 2 },
  { id: "gemini-3.5-flash", provider: "gemini", label: "Gemini 3.5 Flash", blurb: "balanced", cost: 8, quality: 3 },
  { id: "gemini-3.8-flash", provider: "gemini", label: "Gemini 3.8 Flash", blurb: "smart", cost: 12, quality: 4 },
  { id: "gemini-3.1-pro-preview", provider: "gemini", label: "Gemini Pro", blurb: "pro", cost: 30, quality: 5, paidOnly: true },
  { id: "claude-haiku-5-5", provider: "anthropic", label: "Claude Haiku", blurb: "balanced", cost: 10, quality: 3 },
  { id: "claude-sonnet-5-5", provider: "anthropic", label: "Claude Sonnet", blurb: "smart", cost: 20, quality: 4 },
  { id: "claude-opus-5-5", provider: "anthropic", label: "Claude Opus", blurb: "pro", cost: 40, quality: 5 },
];

/** Used only when no real provider is configured (development and tests). */
export const DEV_MODEL: ChatModel = { id: "dev-echo", provider: "dev", label: "Dev placeholder", blurb: "dev", cost: 1, quality: 1 };

/** Models the current deployment can actually serve. */
export function availableModels(): ChatModel[] {
  if (activeAiProvider() === "dev") return [DEV_MODEL];
  const c = config();
  const has = { gemini: Boolean(c.GEMINI_API_KEY), anthropic: Boolean(c.ANTHROPIC_API_KEY), dev: false };
  return CHAT_MODELS.filter((m) => has[m.provider] && (!m.paidOnly || c.AI_PAID_MODELS === "true"));
}

/** Default model: the configured default of the active provider, else the cheapest available. */
export function defaultModel(): ChatModel {
  const list = availableModels();
  const preferred = activeAiProvider() === "gemini" ? config().AI_MODEL_GEMINI : null;
  return list.find((m) => m.id === preferred) ?? list.find((m) => m.provider === activeAiProvider()) ?? list[0];
}

/** The model to use for a user's saved choice, falling back to the default if it is no longer offered. */
export function resolveModel(choice: string | null | undefined): ChatModel {
  return availableModels().find((m) => m.id === choice) ?? defaultModel();
}

/** Price of a model by id (any known model), used to refund the difference after a fallback. */
export function priceOf(modelId: string): number | null {
  if (modelId === DEV_MODEL.id) return DEV_MODEL.cost;
  return CHAT_MODELS.find((m) => m.id === modelId)?.cost ?? null;
}

/** Client-safe view of the picker. */
export function modelOptions() {
  return availableModels().map(({ id, label, blurb, cost, quality }) => ({ id, label, blurb, cost, quality }));
}
export type ModelOption = ReturnType<typeof modelOptions>[number];
