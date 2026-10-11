import { ok, route } from "@/server/http";
import { requireUser } from "@/server/auth/guards";
import { cancelAccountDeletion } from "@/server/services/users";

export const POST = route(async () => {
  await cancelAccountDeletion(await requireUser());
  return ok({ ok: true });
});
