import { ok, parseJson, route } from "@/lib/server/http";
type Ctx = { params: Promise<{ id: string }> };
import { z } from "zod";
import { requireActiveUser } from "@/lib/server/access";
import { publishCharacter, unpublishCharacter } from "@/lib/server/characters";

export const POST = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const user = await requireActiveUser();
  const { visibility } = await parseJson(req, z.object({ visibility: z.enum(["unlisted", "public"]) }));
  const c = await publishCharacter(user, id, visibility);
  return ok({ visibility: c.visibility, publicationStatus: c.publicationStatus });
});

export const DELETE = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const c = await unpublishCharacter(await requireActiveUser(), id);
  return ok({ visibility: c.visibility, publicationStatus: c.publicationStatus });
});
