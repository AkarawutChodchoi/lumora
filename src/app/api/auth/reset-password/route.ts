import { ok, parseJson, route } from "@/server/http";
import { clientIp } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";
import { confirmPasswordReset, resetConfirmSchema } from "@/server/services/users";

export const POST = route(async (req: Request) => {
  rateLimit(`reset-confirm:${clientIp(req)}`, 10, 60 * 60 * 1000);
  await confirmPasswordReset(await parseJson(req, resetConfirmSchema));
  return ok({ ok: true });
});
