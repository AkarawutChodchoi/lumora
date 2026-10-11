import { ok, parseJson, route } from "@/server/http";
import { requireUser } from "@/server/auth/guards";
import { rateLimit } from "@/server/rate-limit";
import { appealSchema, createAppeal, listMyEnforcements } from "@/server/services/reports";

export const GET = route(async () => ok({ items: await listMyEnforcements(await requireUser()) }));

export const POST = route(async (req: Request) => {
  // Suspended users are signed out, so appeals come from warned/restricted users.
  const user = await requireUser();
  rateLimit(`appeal:${user.id}`, 5, 24 * 60 * 60 * 1000);
  const appeal = await createAppeal(user, await parseJson(req, appealSchema));
  return ok({ id: appeal.id }, { status: 201 });
});
