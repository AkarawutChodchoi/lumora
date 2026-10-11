import { z } from "zod";
import { db } from "../db";
import { config } from "../config";
import { audit } from "./audit";

// Non-secret runtime settings, editable from the admin dashboard.
// API keys are never stored here — they live only in environment variables.

export const aiSettingsSchema = z.object({
  standardModel: z.string().min(1).max(100),
  premiumModel: z.string().min(1).max(100),
  maxOutputTokens: z.number().int().min(128).max(16000),
  effort: z.enum(["low", "medium", "high"]),
  contextTokenBudget: z.number().int().min(2000).max(200000),
  memoryTokenBudget: z.number().int().min(0).max(8000),
  requestTimeoutMs: z.number().int().min(5000).max(300000),
  costPerMessage: z.number().int().min(0).max(100),
  premiumCostPerMessage: z.number().int().min(0).max(100),
  promptVersion: z.string().min(1).max(40),
});
export type AiSettings = z.infer<typeof aiSettingsSchema>;

export const featureFlagsSchema = z.object({
  memoryExtraction: z.boolean(),
  dailyBonus: z.boolean(),
  characterCreation: z.boolean(),
  registrationOpen: z.boolean(),
});
export type FeatureFlags = z.infer<typeof featureFlagsSchema>;

const DEFAULTS = {
  ai: (): AiSettings => ({
    standardModel: config().AI_MODEL_STANDARD,
    premiumModel: config().AI_MODEL_PREMIUM,
    maxOutputTokens: 2048,
    effort: "low",
    contextTokenBudget: 24000,
    memoryTokenBudget: 1200,
    requestTimeoutMs: 120000,
    costPerMessage: 1,
    premiumCostPerMessage: 1,
    promptVersion: "policy-v1",
  }),
  flags: (): FeatureFlags => ({ memoryExtraction: true, dailyBonus: true, characterCreation: true, registrationOpen: true }),
};

async function read<T>(key: string, schema: z.ZodType<T>, fallback: T): Promise<T> {
  const row = await db.appSetting.findUnique({ where: { key } });
  if (!row) return fallback;
  try {
    const parsed = schema.safeParse({ ...(fallback as object), ...JSON.parse(row.value) });
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

export const getAiSettings = () => read("ai", aiSettingsSchema, DEFAULTS.ai());
export const getFeatureFlags = () => read("flags", featureFlagsSchema, DEFAULTS.flags());

export async function updateSettings(key: "ai" | "flags", value: unknown, actorId: string) {
  const schema = key === "ai" ? aiSettingsSchema : featureFlagsSchema;
  const parsed = schema.parse(value);
  const before = key === "ai" ? await getAiSettings() : await getFeatureFlags();
  await db.appSetting.upsert({
    where: { key },
    create: { key, value: JSON.stringify(parsed), updatedBy: actorId },
    update: { value: JSON.stringify(parsed), updatedBy: actorId },
  });
  await audit({ actorId, action: `settings.update.${key}`, targetType: "setting", targetId: key, details: { before, after: parsed } });
  return parsed;
}
