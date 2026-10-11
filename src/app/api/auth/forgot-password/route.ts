import { ok, parseJson, route } from "@/server/http";
import { clientIp } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";
import { config, emailDeliveryEnabled } from "@/server/config";
import { requestPasswordReset, resetRequestSchema } from "@/server/services/users";

export const POST = route(async (req: Request) => {
  await rateLimit(`reset:${clientIp(req)}`, 5, 60 * 60 * 1000);
  const { email } = await parseJson(req, resetRequestSchema);
  // Also per address, so one inbox cannot be flooded with reset emails from many IPs.
  await rateLimit(`reset:acct:${email}`, 3, 60 * 60 * 1000);
  await requestPasswordReset(email);
  // Same response whether or not the account exists. In development the link is printed
  // to the server log; in production say plainly that no email could be sent.
  const emailSent = emailDeliveryEnabled() || config().NODE_ENV !== "production";
  return ok({ ok: true, emailSent });
});
