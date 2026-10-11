import { ok, parseJson, route } from "@/server/http";
import { requirePermission } from "@/server/auth/guards";
import { premiumSchema, setPremium } from "@/server/services/admin";

type Ctx = { params: Promise<{ id: string }> };

/** Grant Lumora Plus for N days without payment (days = 0 ends it). */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const actor = await requirePermission("users.grant_premium");
  await setPremium(actor, (await params).id, await parseJson(req, premiumSchema));
  return ok({ ok: true });
});
