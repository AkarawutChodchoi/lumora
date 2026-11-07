import { ok, parseJson, route } from "@/lib/server/http";
type Ctx = { params: Promise<{ id: string }> };
import { requireUser } from "@/lib/server/access";
import { deleteMemory, editMemory, memoryInputSchema } from "@/lib/server/memory";

export const PATCH = route(async (req: Request, { params }: Ctx) => {
  const user = await requireUser();
  return ok({ memory: await editMemory(user, (await params).id, await parseJson(req, memoryInputSchema)) });
});

export const DELETE = route(async (_req: Request, { params }: Ctx) => {
  await deleteMemory(await requireUser(), (await params).id);
  return ok({ ok: true });
});
