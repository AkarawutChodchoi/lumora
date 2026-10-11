import { ok, route } from "@/server/http";
import { requirePermission } from "@/server/auth/guards";
import { searchUsers, userSearchSchema } from "@/server/services/admin";

export const GET = route(async (req: Request) => {
  await requirePermission("users.view");
  const { q, status } = userSearchSchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  return ok({ items: await searchUsers(q, status) });
});
