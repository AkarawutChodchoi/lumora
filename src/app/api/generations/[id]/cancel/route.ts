import { ok, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/access";
import { cancelGeneration } from "@/lib/server/chat";

type Ctx = { params: Promise<{ id: string }> };

export const POST = route(async (_req: Request, { params }: Ctx) => ok(await cancelGeneration(await requireUser(), (await params).id)));
