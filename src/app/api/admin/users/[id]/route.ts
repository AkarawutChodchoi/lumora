type Ctx = { params: Promise<{ id: string }> };
import { ok, route } from "@/server/http";
import { requirePermission } from "@/server/auth/guards";
import { userDetail } from "@/server/services/admin";

export const GET = route(async (_req: Request, { params }: Ctx) => {
  await requirePermission("users.view");
  return ok({ user: await userDetail((await params).id) });
});
