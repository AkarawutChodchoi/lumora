import { ok, route } from "@/lib/server/http";
import { currentUser } from "@/lib/server/access";
import { discover } from "@/lib/server/characters";

export const GET = route(async () => ok(await discover(await currentUser())));
