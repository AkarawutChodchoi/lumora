import { ok, parseJson, route } from "@/lib/server/http";
type Ctx = { params: Promise<{ id: string }> };
import { requireActiveUser, requireUser } from "@/lib/server/access";
import { currentUser } from "@/lib/server/access";
import { characterInputSchema, deleteCharacter, getViewableCharacter, toDetail, updateCharacter } from "@/lib/server/characters";

export const GET = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const viewer = await currentUser();
  return ok({ character: toDetail(await getViewableCharacter(id, viewer), viewer) });
});

export const PUT = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const user = await requireActiveUser();
  const updated = await updateCharacter(user, id, await parseJson(req, characterInputSchema));
  return ok({ id: updated.id, version: updated.currentVersion });
});

export const DELETE = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  await deleteCharacter(await requireUser(), id);
  return ok({ ok: true });
});
