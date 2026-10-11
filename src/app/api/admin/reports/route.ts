import { ok, route } from "@/server/http";
import { requirePermission } from "@/server/auth/guards";
import { listReports } from "@/server/services/admin";

export const GET = route(async (req: Request) => {
  await requirePermission("reports.review");
  return ok({ items: await listReports(new URL(req.url).searchParams.get("status")?.slice(0, 20) || undefined) });
});
