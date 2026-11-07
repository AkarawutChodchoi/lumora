import { ok, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/access";
import { cancelAccountDeletion } from "@/lib/server/users";

export const POST = route(async () => {
  await cancelAccountDeletion(await requireUser());
  return ok({ ok: true });
});
