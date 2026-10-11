import { ok, parseJson, route } from "@/server/http";
type Ctx = { params: Promise<{ id: string }> };
import { requireUser } from "@/server/auth/guards";
import { conversationPatchSchema, deleteConversation, getOwnedConversation, updateConversation } from "@/server/services/conversations";

export const GET = route(async (_req: Request, { params }: Ctx) => ok({ conversation: await getOwnedConversation(await requireUser(), (await params).id) }));

export const PATCH = route(async (req: Request, { params }: Ctx) => {
  const user = await requireUser();
  const conv = await updateConversation(user, (await params).id, await parseJson(req, conversationPatchSchema));
  return ok({ conversation: conv });
});

export const DELETE = route(async (_req: Request, { params }: Ctx) => {
  await deleteConversation(await requireUser(), (await params).id);
  return ok({ ok: true });
});
