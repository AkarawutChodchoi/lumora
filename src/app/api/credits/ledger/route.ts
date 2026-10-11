import { ok, route } from "@/server/http";
import { requireUser } from "@/server/auth/guards";
import { listLedger } from "@/server/services/credits";

export const GET = route(async (req: Request) => {
  const cursor = new URL(req.url).searchParams.get("cursor") ?? undefined;
  return ok(await listLedger((await requireUser()).id, cursor));
});
