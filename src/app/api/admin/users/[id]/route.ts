type Ctx = { params: Promise<{ id: string }> };
import { ok, route } from "@/lib/server/http";
import { requirePermission } from "@/lib/server/access";
import { userDetail } from "@/lib/server/admin";

export const GET = route(async (_req: Request, { params }: Ctx) => {
  await requirePermission("users.view");
  return ok({ user: await userDetail((await params).id) });
});
