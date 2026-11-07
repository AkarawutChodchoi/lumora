import { ok, route } from "@/lib/server/http";
import { requirePermission } from "@/lib/server/access";
import { searchUsers, userSearchSchema } from "@/lib/server/admin";

export const GET = route(async (req: Request) => {
  await requirePermission("users.view");
  const { q, status } = userSearchSchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  return ok({ items: await searchUsers(q, status) });
});
