import { ok, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/access";
import { listLedger } from "@/lib/server/wallet";

export const GET = route(async (req: Request) => {
  const cursor = new URL(req.url).searchParams.get("cursor") ?? undefined;
  return ok(await listLedger((await requireUser()).id, cursor));
});
