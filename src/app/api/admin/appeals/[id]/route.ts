import { ok, parseJson, route } from "@/server/http";
type Ctx = { params: Promise<{ id: string }> };
import { requirePermission } from "@/server/auth/guards";
import { decideAppeal, decideAppealSchema } from "@/server/services/admin";

export const POST = route(async (req: Request, { params }: Ctx) => {
  const actor = await requirePermission("appeals.decide");
  await decideAppeal(actor, (await params).id, await parseJson(req, decideAppealSchema));
  return ok({ ok: true });
});
