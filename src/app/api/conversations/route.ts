import { ok, parseJson, route } from "@/lib/server/http";
import { z } from "zod";
import { requireActiveUser, requireUser } from "@/lib/server/access";
import { listConversations, startConversation } from "@/lib/server/conversations";

export const GET = route(async (req: Request) => {
  const characterId = new URL(req.url).searchParams.get("characterId") ?? undefined;
  return ok({ items: await listConversations(await requireUser(), characterId) });
});

export const POST = route(async (req: Request) => {
  const user = await requireActiveUser();
  const { characterId } = await parseJson(req, z.object({ characterId: z.string().min(1).max(60) }));
  const conv = await startConversation(user, characterId);
  return ok({ id: conv.id }, { status: 201 });
});
