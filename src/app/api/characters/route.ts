import { ok, parseJson, route } from "@/lib/server/http";
import { requireActiveUser } from "@/lib/server/access";
import { currentUser } from "@/lib/server/access";
import { rateLimit } from "@/lib/server/rateLimit";
import { characterInputSchema, createCharacter, searchCharacters, searchSchema } from "@/lib/server/characters";

export const GET = route(async (req: Request) => {
  const params = searchSchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  return ok(await searchCharacters(params, await currentUser()));
});

export const POST = route(async (req: Request) => {
  const user = await requireActiveUser();
  await rateLimit(`character-create:${user.id}`, 20, 60 * 60 * 1000);
  const character = await createCharacter(user, await parseJson(req, characterInputSchema));
  return ok({ id: character.id }, { status: 201 });
});
