import { ok, parseJson, route } from "@/lib/server/http";
type Ctx = { params: Promise<{ id: string }> };
import { requirePermission } from "@/lib/server/access";
import { enforce, enforceSchema } from "@/lib/server/admin";

export const POST = route(async (req: Request, { params }: Ctx) => {
  const actor = await requirePermission("users.enforce");
  await enforce(actor, (await params).id, await parseJson(req, enforceSchema));
  return ok({ ok: true });
});
