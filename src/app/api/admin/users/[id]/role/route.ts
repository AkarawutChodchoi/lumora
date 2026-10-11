import { ok, parseJson, route } from "@/server/http";
import { requirePermission } from "@/server/auth/guards";
import { roleSchema, setRole } from "@/server/services/admin";

type Ctx = { params: Promise<{ id: string }> };

export const POST = route(async (req: Request, { params }: Ctx) => {
  const actor = await requirePermission("users.manage_roles");
  await setRole(actor, (await params).id, await parseJson(req, roleSchema));
  return ok({ ok: true });
});
