import { ok, parseJson, route } from "@/server/http";
import { requirePermission } from "@/server/auth/guards";
import { adjustCredits, adjustSchema } from "@/server/services/admin";

export const POST = route(async (req: Request) => {
  const actor = await requirePermission("billing.adjust");
  const entry = await adjustCredits(actor, await parseJson(req, adjustSchema));
  return ok({ entry });
});
