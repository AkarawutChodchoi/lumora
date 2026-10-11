import { ok, parseJson, route } from "@/server/http";
type Ctx = { params: Promise<{ id: string }> };
import { requireUser } from "@/server/auth/guards";
import { deleteMemory, editMemory, memoryInputSchema } from "@/server/services/memory";

export const PATCH = route(async (req: Request, { params }: Ctx) => {
  const user = await requireUser();
  return ok({ memory: await editMemory(user, (await params).id, await parseJson(req, memoryInputSchema)) });
});

export const DELETE = route(async (_req: Request, { params }: Ctx) => {
  await deleteMemory(await requireUser(), (await params).id);
  return ok({ ok: true });
});
