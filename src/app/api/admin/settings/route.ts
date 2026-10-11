import { ok, parseJson, route } from "@/server/http";
import { z } from "zod";
import { requirePermission } from "@/server/auth/guards";
import { getAiSettings, getFeatureFlags, updateSettings } from "@/server/services/settings";

export const GET = route(async () => {
  await requirePermission("ai.configure");
  return ok({ ai: await getAiSettings(), flags: await getFeatureFlags() });
});

export const PUT = route(async (req: Request) => {
  const actor = await requirePermission("ai.configure");
  const body = await parseJson(req, z.object({ key: z.enum(["ai", "flags"]), value: z.unknown() }));
  return ok({ value: await updateSettings(body.key, body.value, actor.id) });
});
