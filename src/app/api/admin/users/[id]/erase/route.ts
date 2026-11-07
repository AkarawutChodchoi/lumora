type Ctx = { params: Promise<{ id: string }> };
import { ok, route } from "@/lib/server/http";
import { requirePermission } from "@/lib/server/access";
import { processDeletion } from "@/lib/server/admin";

export const POST = route(async (_req: Request, { params }: Ctx) => {
  const actor = await requirePermission("users.process_deletion");
  await processDeletion(actor, (await params).id);
  return ok({ ok: true });
});
