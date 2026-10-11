import { ok, parseJson, route } from "@/server/http";
type Ctx = { params: Promise<{ id: string }> };
import { requireActiveUser, requireUser } from "@/server/auth/guards";
import { getSessionUser } from "@/server/auth/session";
import { characterInputSchema, deleteCharacter, getViewableCharacter, toDetail, updateCharacter } from "@/server/services/characters";

export const GET = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const viewer = await getSessionUser();
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
