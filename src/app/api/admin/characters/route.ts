import { ok, route } from "@/lib/server/http";
import { requirePermission } from "@/lib/server/access";
import { searchAllCharacters } from "@/lib/server/admin";

export const GET = route(async (req: Request) => {
  await requirePermission("characters.moderate");
  const sp = new URL(req.url).searchParams;
  return ok({ items: await searchAllCharacters(sp.get("q")?.slice(0, 100) || undefined, sp.get("status")?.slice(0, 30) || undefined) });
});
