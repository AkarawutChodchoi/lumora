import { eq } from "drizzle-orm";
import { ok, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/access";
import { deleteAllConversations } from "@/lib/server/conversations";
import { db, schema } from "@/db";

/** Privacy: delete all of the user's chat history and memories immediately. */
export const DELETE = route(async () => {
  const user = await requireUser();
  const conversations = await deleteAllConversations(user);
  const memories = await db.delete(schema.memory).where(eq(schema.memory.userId, user.id)).returning({ id: schema.memory.id });
  return ok({ deletedConversations: conversations, deletedMemories: memories.length });
});
