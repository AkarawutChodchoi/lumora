import { ok, route } from "@/lib/server/http";
import { requirePermission } from "@/lib/server/access";
import { listReports } from "@/lib/server/admin";

export const GET = route(async (req: Request) => {
  await requirePermission("reports.review");
  return ok({ items: await listReports(new URL(req.url).searchParams.get("status")?.slice(0, 20) || undefined) });
});
