import { ok, route } from "@/lib/server/http";
import { requirePermission } from "@/lib/server/access";
import { forceSignOut } from "@/lib/server/admin";

type Ctx = { params: Promise<{ id: string }> };

export const POST = route(async (_req: Request, { params }: Ctx) => {
  const actor = await requirePermission("users.enforce");
  await forceSignOut(actor, (await params).id);
  return ok({ ok: true });
});
