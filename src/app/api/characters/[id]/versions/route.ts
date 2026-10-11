import { ok, route } from "@/server/http";
import { requireUser } from "@/server/auth/guards";
import { listVersions } from "@/server/services/characters";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req: Request, { params }: Ctx) => ok({ versions: await listVersions(await requireUser(), (await params).id) }));
