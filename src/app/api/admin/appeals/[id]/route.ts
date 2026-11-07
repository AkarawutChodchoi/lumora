import { ok, parseJson, route } from "@/lib/server/http";
type Ctx = { params: Promise<{ id: string }> };
import { requirePermission } from "@/lib/server/access";
import { decideAppeal, decideAppealSchema } from "@/lib/server/admin";

export const POST = route(async (req: Request, { params }: Ctx) => {
  const actor = await requirePermission("appeals.decide");
  await decideAppeal(actor, (await params).id, await parseJson(req, decideAppealSchema));
  return ok({ ok: true });
});
