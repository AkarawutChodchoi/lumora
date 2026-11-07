import { ok, route } from "@/lib/server/http";
import { requirePermission } from "@/lib/server/access";
import { overview, rangeSchema } from "@/lib/server/admin";

export const GET = route(async (req: Request) => {
  await requirePermission("admin.view");
  const { days } = rangeSchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  return ok(await overview(days));
});
