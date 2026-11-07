import "server-only";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { db, schema, type Q } from "@/db";

type Kind = (typeof schema.notificationKindEnum.enumValues)[number];

/** In-app notification for one or more users (bell icon). */
export async function notify(userIds: string[], kind: Kind, text: string, href = "/", tx: Q = db) {
  if (!userIds.length) return;
  await tx.insert(schema.notification).values(userIds.map((userId) => ({ userId, kind, text: text.slice(0, 300), href })));
}

export async function unreadCount(userId: string) {
  const [r] = await db
    .select({ n: count() })
    .from(schema.notification)
    .where(and(eq(schema.notification.userId, userId), isNull(schema.notification.readAt)));
  return r?.n ?? 0;
}

export async function listNotifications(userId: string, take = 50) {
  return db.select().from(schema.notification).where(eq(schema.notification.userId, userId)).orderBy(desc(schema.notification.id)).limit(take);
}

export async function markAllRead(userId: string) {
  await db
    .update(schema.notification)
    .set({ readAt: new Date() })
    .where(and(eq(schema.notification.userId, userId), isNull(schema.notification.readAt)));
}
