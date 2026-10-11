import { ok, parseJson, route } from "@/server/http";
import { clientIp } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";
import { createSession } from "@/server/auth/session";
import { registerSchema, registerUser, toPublicUser } from "@/server/services/users";

export const POST = route(async (req: Request) => {
  rateLimit(`register:${clientIp(req)}`, 5, 60 * 60 * 1000);
  const input = await parseJson(req, registerSchema);
  const user = await registerUser(input);
  await createSession(user.id, req.headers.get("user-agent"));
  return ok({ user: toPublicUser(user) }, { status: 201 });
});
