import { ok, parseJson, route } from "@/server/http";
import { clientIp } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";
import { requestPasswordReset, resetRequestSchema } from "@/server/services/users";

export const POST = route(async (req: Request) => {
  rateLimit(`reset:${clientIp(req)}`, 5, 60 * 60 * 1000);
  const { email } = await parseJson(req, resetRequestSchema);
  await requestPasswordReset(email);
  // Same response whether or not the account exists.
  return ok({ ok: true, message: "If an account exists for that email, a reset link has been sent." });
});
