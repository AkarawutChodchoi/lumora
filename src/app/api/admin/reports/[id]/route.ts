import { ok, parseJson, route } from "@/lib/server/http";
type Ctx = { params: Promise<{ id: string }> };
import { requirePermission } from "@/lib/server/access";
import { resolveReport, resolveReportSchema } from "@/lib/server/admin";

export const POST = route(async (req: Request, { params }: Ctx) => {
  const actor = await requirePermission("reports.review");
  await resolveReport(actor, (await params).id, await parseJson(req, resolveReportSchema));
  return ok({ ok: true });
});
