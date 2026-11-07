import { ok, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/access";
import { markAllRead } from "@/lib/server/notify";

/** Mark every notification as read. */
export const POST = route(async () => {
  await markAllRead((await requireUser()).id);
  return ok({ ok: true });
});
