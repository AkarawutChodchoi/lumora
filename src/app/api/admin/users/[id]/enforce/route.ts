import { ok, parseJson, route } from "@/server/http";
type Ctx = { params: Promise<{ id: string }> };
import { requirePermission } from "@/server/auth/guards";
import { enforce, enforceSchema } from "@/server/services/admin";

export const POST = route(async (req: Request, { params }: Ctx) => {
  const actor = await requirePermission("users.enforce");
  await enforce(actor, (await params).id, await parseJson(req, enforceSchema));
  return ok({ ok: true });
});
