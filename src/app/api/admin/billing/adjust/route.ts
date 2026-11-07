import { ok, parseJson, route } from "@/lib/server/http";
import { requirePermission } from "@/lib/server/access";
import { adjustCredits, adjustSchema } from "@/lib/server/admin";

export const POST = route(async (req: Request) => {
  const actor = await requirePermission("billing.adjust");
  const entry = await adjustCredits(actor, await parseJson(req, adjustSchema));
  return ok({ entry });
});
