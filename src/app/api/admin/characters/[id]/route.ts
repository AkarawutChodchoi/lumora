import { ok, parseJson, route } from "@/lib/server/http";
type Ctx = { params: Promise<{ id: string }> };
import { requirePermission } from "@/lib/server/access";
import { characterModerationSchema, moderateCharacter } from "@/lib/server/admin";

export const POST = route(async (req: Request, { params }: Ctx) => {
  const actor = await requirePermission("characters.moderate");
  await moderateCharacter(actor, (await params).id, await parseJson(req, characterModerationSchema));
  return ok({ ok: true });
});
