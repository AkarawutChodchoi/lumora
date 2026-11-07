import { ok, parseJson, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/access";
import { rateLimit } from "@/lib/server/rateLimit";
import { appealSchema, createAppeal, listMyEnforcements } from "@/lib/server/reports";

export const GET = route(async () => ok({ items: await listMyEnforcements(await requireUser()) }));

export const POST = route(async (req: Request) => {
  // Suspended users are signed out, so appeals come from warned/restricted users.
  const user = await requireUser();
  await rateLimit(`appeal:${user.id}`, 5, 24 * 60 * 60 * 1000);
  const appeal = await createAppeal(user, await parseJson(req, appealSchema));
  return ok({ id: appeal.id }, { status: 201 });
});
