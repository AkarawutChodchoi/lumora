import { ok, parseJson, route } from "@/server/http";
import { z } from "zod";
import { requireUser } from "@/server/auth/guards";
import { destroyCurrentSession } from "@/server/auth/session";
import { profileSchema, requestAccountDeletion, toPublicUser, updateProfile } from "@/server/services/users";

export const GET = route(async () => ok({ user: toPublicUser(await requireUser()) }));

export const PATCH = route(async (req: Request) => {
  const user = await requireUser();
  const updated = await updateProfile(user, await parseJson(req, profileSchema));
  return ok({ user: toPublicUser(updated) });
});

/** Request account deletion (starts the grace period, signs out everywhere on erase). */
export const DELETE = route(async (req: Request) => {
  const user = await requireUser();
  const { password } = await parseJson(req, z.object({ password: z.string().min(1).max(128) }));
  await requestAccountDeletion(user, password);
  await destroyCurrentSession();
  return ok({ ok: true });
});
