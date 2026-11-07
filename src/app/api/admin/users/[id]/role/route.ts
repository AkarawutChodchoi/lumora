import { ok, parseJson, route } from "@/lib/server/http";
import { requirePermission } from "@/lib/server/access";
import { roleSchema, setRole } from "@/lib/server/admin";

type Ctx = { params: Promise<{ id: string }> };

export const POST = route(async (req: Request, { params }: Ctx) => {
  const actor = await requirePermission("users.manage_roles");
  await setRole(actor, (await params).id, await parseJson(req, roleSchema));
  return ok({ ok: true });
});
