import { ok, parseJson, route } from "@/server/http";
import { requireUser } from "@/server/auth/guards";
import { createSession } from "@/server/auth/session";
import { changePassword, changePasswordSchema } from "@/server/services/users";

export const POST = route(async (req: Request) => {
  const user = await requireUser();
  await changePassword(user, await parseJson(req, changePasswordSchema));
  // All sessions were revoked; keep this device signed in with a fresh session.
  await createSession(user.id, req.headers.get("user-agent"));
  return ok({ ok: true });
});
