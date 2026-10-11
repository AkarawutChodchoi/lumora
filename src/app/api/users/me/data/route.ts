import { ok, route } from "@/server/http";
import { requireUser } from "@/server/auth/guards";
import { deleteAllConversations } from "@/server/services/conversations";
import { db } from "@/server/db";

/** Privacy: delete all of the user's chat history and memories immediately. */
export const DELETE = route(async () => {
  const user = await requireUser();
  const conversations = await deleteAllConversations(user);
  const memories = await db.memory.deleteMany({ where: { userId: user.id } });
  return ok({ deletedConversations: conversations, deletedMemories: memories.count });
});
