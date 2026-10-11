import { ok, parseJson, route } from "@/server/http";
import { requireActiveUser } from "@/server/auth/guards";
import { getSessionUser } from "@/server/auth/session";
import { rateLimit } from "@/server/rate-limit";
import { characterInputSchema, createCharacter, searchCharacters, searchSchema } from "@/server/services/characters";

export const GET = route(async (req: Request) => {
  const params = searchSchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  return ok(await searchCharacters(params, await getSessionUser()));
});

export const POST = route(async (req: Request) => {
  const user = await requireActiveUser();
  rateLimit(`character-create:${user.id}`, 20, 60 * 60 * 1000);
  const character = await createCharacter(user, await parseJson(req, characterInputSchema));
  return ok({ id: character.id }, { status: 201 });
});
