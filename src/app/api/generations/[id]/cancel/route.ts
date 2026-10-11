import { ok, route } from "@/server/http";
import { requireUser } from "@/server/auth/guards";
import { cancelGeneration } from "@/server/services/chat";

type Ctx = { params: Promise<{ id: string }> };

export const POST = route(async (_req: Request, { params }: Ctx) => ok(await cancelGeneration(await requireUser(), (await params).id)));
