import { ok, route } from "@/server/http";
import { requirePermission } from "@/server/auth/guards";
import { overview, rangeSchema } from "@/server/services/admin";

export const GET = route(async (req: Request) => {
  await requirePermission("admin.view");
  const { days } = rangeSchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  return ok(await overview(days));
});
