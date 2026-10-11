import { z } from "zod";
import { ok, parseJson, route } from "@/server/http";
import { requirePermission } from "@/server/auth/guards";
import { eraseNow } from "@/server/services/admin";

type Ctx = { params: Promise<{ id: string }> };

export const POST = route(async (req: Request, { params }: Ctx) => {
  const actor = await requirePermission("users.erase");
  const { confirmEmail } = await parseJson(req, z.object({ confirmEmail: z.string().max(254) }));
  await eraseNow(actor, (await params).id, confirmEmail);
  return ok({ ok: true });
});
