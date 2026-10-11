import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  AI_PROVIDER: z.enum(["anthropic", "gemini", "dev", ""]).default(""),
  ANTHROPIC_API_KEY: z.string().default(""),
  GEMINI_API_KEY: z.string().default(""),
  // Free-tier daily quotas are per model: flash-lite has far more headroom than flash.
  AI_MODEL_GEMINI: z.string().default("gemini-3.5-flash-lite"),
  // Comma-separated models tried in order when the main one's quota is used up.
  AI_MODEL_GEMINI_FALLBACKS: z.string().default("gemini-3.5-flash,gemini-3.8-flash,gemini-3.6-flash"),
  // "true" once the provider account is on a paid plan: unlocks models with no free quota.
  AI_PAID_MODELS: z.string().default(""),
  AI_MODEL_STANDARD: z.string().default("claude-opus-5-5"),
  AI_MODEL_PREMIUM: z.string().default("claude-opus-5-5"),
  PAYMENT_PROVIDER: z.string().default(""),
  PAYMENT_WEBHOOK_SECRET: z.string().default(""),
  EMAIL_PROVIDER: z.string().default(""),
});

export type AppConfig = z.infer<typeof schema>;

let cached: AppConfig | null = null;

/** Parsed, validated server configuration. Never import this from client code. */
export function config(): AppConfig {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new Error(`Invalid server configuration: ${issues}`);
    }
    cached = parsed.data;
  }
  return cached;
}

export type AiProviderName = "anthropic" | "gemini" | "dev";

/**
 * Which AI provider is actually active. AI_PROVIDER picks one explicitly; otherwise
 * the first provider with a key wins. Without any key, the labelled dev provider is used.
 */
export function activeAiProvider(): AiProviderName {
  const c = config();
  if (c.AI_PROVIDER === "dev") return "dev";
  if (c.AI_PROVIDER === "anthropic") return c.ANTHROPIC_API_KEY ? "anthropic" : "dev";
  if (c.AI_PROVIDER === "gemini") return c.GEMINI_API_KEY ? "gemini" : "dev";
  if (c.ANTHROPIC_API_KEY) return "anthropic";
  if (c.GEMINI_API_KEY) return "gemini";
  return "dev";
}

export const AI_PROVIDER_LABEL: Record<AiProviderName, string> = { anthropic: "Anthropic Claude", gemini: "Google Gemini", dev: "Dev placeholder" };

/** Whether reset emails can actually be delivered. No email adapter exists yet. */
export function emailDeliveryEnabled(): boolean {
  return false;
}

export function paymentsEnabled(): boolean {
  const c = config();
  return Boolean(c.PAYMENT_PROVIDER && c.PAYMENT_WEBHOOK_SECRET);
}
