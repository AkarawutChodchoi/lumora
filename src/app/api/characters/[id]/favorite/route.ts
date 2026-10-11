import { ok, route } from "@/server/http";
import { requireUser } from "@/server/auth/guards";
import { toggleFavorite } from "@/server/services/characters";

type Ctx = { params: Promise<{ id: string }> };

export const PUT = route(async (_req: Request, { params }: Ctx) => ok(await toggleFavorite(await requireUser(), (await params).id, true)));
export const DELETE = route(async (_req: Request, { params }: Ctx) => ok(await toggleFavorite(await requireUser(), (await params).id, false)));
