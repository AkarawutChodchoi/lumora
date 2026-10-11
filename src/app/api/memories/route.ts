import { ok, parseJson, route } from "@/server/http";
import { z } from "zod";
import { requireUser } from "@/server/auth/guards";
import { addMemory, clearMemories, listMemories, memoryInputSchema } from "@/server/services/memory";

const charParam = (req: Request) => z.string().min(1).max(60).parse(new URL(req.url).searchParams.get("characterId"));

export const GET = route(async (req: Request) => ok({ items: await listMemories(await requireUser(), charParam(req)) }));

export const POST = route(async (req: Request) => {
  const user = await requireUser();
  const memory = await addMemory(user, charParam(req), await parseJson(req, memoryInputSchema));
  return ok({ memory }, { status: 201 });
});

export const DELETE = route(async (req: Request) => ok({ deleted: await clearMemories(await requireUser(), charParam(req)) }));
