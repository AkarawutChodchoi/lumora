import { ok, parseJson, route } from "@/server/http";
import { requireUser } from "@/server/auth/guards";
import { rateLimit } from "@/server/rate-limit";
import { createReport, listMyReports, reportSchema } from "@/server/services/reports";

export const GET = route(async () => ok({ items: await listMyReports(await requireUser()) }));

export const POST = route(async (req: Request) => {
  const user = await requireUser();
  rateLimit(`report:${user.id}`, 10, 60 * 60 * 1000);
  const report = await createReport(user, await parseJson(req, reportSchema));
  return ok({ id: report.id }, { status: 201 });
});
