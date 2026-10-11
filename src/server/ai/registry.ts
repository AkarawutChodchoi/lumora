import { activeAiProvider, config } from "../config";
import { resolveModel } from "./models";
import type { AIProvider } from "./types";
import { AnthropicProvider } from "./providers/anthropic";
import { DevProvider } from "./providers/dev";
import { GeminiProvider } from "./providers/gemini";

let anthropic: AnthropicProvider | null = null;
let gemini: GeminiProvider | null = null;
const dev = new DevProvider();

let override: AIProvider | null = null;
/** Tests can inject a mock provider. */
export function setProviderOverride(p: AIProvider | null) {
  override = p;
}

/** The provider for a model id (or the active provider when no model is given). */
export function getProvider(model?: string): AIProvider {
  if (override) return override;
  if (activeAiProvider() === "dev") return dev;
  const active = model?.startsWith("claude") ? "anthropic" : model?.startsWith("gemini") ? "gemini" : activeAiProvider();
  if (active === "anthropic" && config().ANTHROPIC_API_KEY) {
    anthropic ??= new AnthropicProvider(config().ANTHROPIC_API_KEY);
    return anthropic;
  }
  if (active === "gemini" && config().GEMINI_API_KEY) {
    const fallbacks = config().AI_MODEL_GEMINI_FALLBACKS.split(",").map((m) => m.trim()).filter(Boolean);
    gemini ??= new GeminiProvider(config().GEMINI_API_KEY, config().AI_MODEL_GEMINI, fallbacks);
    return gemini;
  }
  return dev;
}

/**
 * Model routing: the user's saved choice if this deployment offers it, else the default.
 * Price comes from the same catalog entry so pricing and routing never drift.
 */
export function routeModel(choice: string | null | undefined) {
  const m = resolveModel(choice);
  return { model: m.id, cost: m.cost };
}
