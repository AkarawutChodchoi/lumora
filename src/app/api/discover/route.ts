import { ok, route } from "@/server/http";
import { getSessionUser } from "@/server/auth/session";
import { discover } from "@/server/services/characters";

export const GET = route(async () => ok(await discover(await getSessionUser())));
