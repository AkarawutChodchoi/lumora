import { ok, parseJson, route } from "@/server/http";
import { clientIp } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";
import { createSession } from "@/server/auth/session";
import { authenticate, loginSchema, toPublicUser } from "@/server/services/users";

export const POST = route(async (req: Request) => {
  const input = await parseJson(req, loginSchema);
  // Limit per IP and per account to slow down password guessing.
  await rateLimit(`login:ip:${clientIp(req)}`, 20, 15 * 60 * 1000);
  await rateLimit(`login:acct:${input.email}`, 8, 15 * 60 * 1000);
  const user = await authenticate(input);
  await createSession(user.id, req.headers.get("user-agent"));
  return ok({ user: toPublicUser(user) });
});
