import { ok, parseJson, route } from "@/server/http";
type Ctx = { params: Promise<{ id: string }> };
import { requirePermission } from "@/server/auth/guards";
import { resolveReport, resolveReportSchema } from "@/server/services/admin";

export const POST = route(async (req: Request, { params }: Ctx) => {
  const actor = await requirePermission("reports.review");
  await resolveReport(actor, (await params).id, await parseJson(req, resolveReportSchema));
  return ok({ ok: true });
});
