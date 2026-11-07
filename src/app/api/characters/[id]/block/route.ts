import { ok, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/access";
import { setBlocked } from "@/lib/server/characters";

type Ctx = { params: Promise<{ id: string }> };

export const PUT = route(async (_req: Request, { params }: Ctx) => ok(await setBlocked(await requireUser(), (await params).id, true)));
export const DELETE = route(async (_req: Request, { params }: Ctx) => ok(await setBlocked(await requireUser(), (await params).id, false)));
