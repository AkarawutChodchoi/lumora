import { ok, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/access";
import { listVersions } from "@/lib/server/characters";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req: Request, { params }: Ctx) => ok({ versions: await listVersions(await requireUser(), (await params).id) }));
