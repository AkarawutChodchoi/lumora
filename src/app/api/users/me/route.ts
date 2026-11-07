import { headers } from "next/headers";
import { z } from "zod";
import { ok, parseJson, route } from "@/lib/server/http";
import { loadAppUser, requireUser } from "@/lib/server/access";
import { auth } from "@/lib/server/auth";
import { rateLimit } from "@/lib/server/rateLimit";
import { profileSchema, requestAccountDeletion, toPublicUser, updateProfile } from "@/lib/server/users";

export const GET = route(async () => ok({ user: toPublicUser(await requireUser()) }));

export const PATCH = route(async (req: Request) => {
  const user = await requireUser();
  await updateProfile(user, await parseJson(req, profileSchema));
  return ok({ user: toPublicUser((await loadAppUser(user.id))!) });
});

/** Request account deletion (starts the grace period) and sign out of this device. */
export const DELETE = route(async (req: Request) => {
  const user = await requireUser();
  await rateLimit(`password-check:${user.id}`, 10, 15 * 60 * 1000);
  const { password } = await parseJson(req, z.object({ password: z.string().min(1).max(128) }));
  await requestAccountDeletion(user, password);
  await auth.api.signOut({ headers: await headers() }).catch(() => undefined);
  return ok({ ok: true });
});
