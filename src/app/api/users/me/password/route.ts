import { ok, parseJson, route } from "@/server/http";
import { requireUser } from "@/server/auth/guards";
import { createSession } from "@/server/auth/session";
import { rateLimit } from "@/server/rate-limit";
import { changePassword, changePasswordSchema } from "@/server/services/users";

export const POST = route(async (req: Request) => {
  const user = await requireUser();
  // The current password is checked here, so limit guessing with a stolen session.
  await rateLimit(`password-check:${user.id}`, 10, 15 * 60 * 1000);
  await changePassword(user, await parseJson(req, changePasswordSchema));
  // All sessions were revoked; keep this device signed in with a fresh session.
  await createSession(user.id, req.headers.get("user-agent"));
  return ok({ ok: true });
});
