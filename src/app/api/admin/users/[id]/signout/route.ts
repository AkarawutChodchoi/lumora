import { ok, route } from "@/server/http";
import { requirePermission } from "@/server/auth/guards";
import { forceSignOut } from "@/server/services/admin";

type Ctx = { params: Promise<{ id: string }> };

export const POST = route(async (_req: Request, { params }: Ctx) => {
  const actor = await requirePermission("users.enforce");
  await forceSignOut(actor, (await params).id);
  return ok({ ok: true });
});
