import { ok, parseJson, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/access";
import { rateLimit } from "@/lib/server/rateLimit";
import { createReport, listMyReports, reportSchema } from "@/lib/server/reports";

export const GET = route(async () => ok({ items: await listMyReports(await requireUser()) }));

export const POST = route(async (req: Request) => {
  const user = await requireUser();
  await rateLimit(`report:${user.id}`, 10, 60 * 60 * 1000);
  const report = await createReport(user, await parseJson(req, reportSchema));
  return ok({ id: report.id }, { status: 201 });
});
