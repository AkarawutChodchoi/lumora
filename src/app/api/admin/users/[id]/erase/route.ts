type Ctx = { params: Promise<{ id: string }> };
import { ok, route } from "@/server/http";
import { requirePermission } from "@/server/auth/guards";
import { processDeletion } from "@/server/services/admin";

export const POST = route(async (_req: Request, { params }: Ctx) => {
  const actor = await requirePermission("users.process_deletion");
  await processDeletion(actor, (await params).id);
  return ok({ ok: true });
});
