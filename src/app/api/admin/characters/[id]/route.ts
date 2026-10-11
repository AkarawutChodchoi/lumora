import { ok, parseJson, route } from "@/server/http";
type Ctx = { params: Promise<{ id: string }> };
import { requirePermission } from "@/server/auth/guards";
import { characterModerationSchema, moderateCharacter } from "@/server/services/admin";

export const POST = route(async (req: Request, { params }: Ctx) => {
  const actor = await requirePermission("characters.moderate");
  await moderateCharacter(actor, (await params).id, await parseJson(req, characterModerationSchema));
  return ok({ ok: true });
});
