import { db, type Tx } from "../db";

/** Record a privileged or security-relevant action. Keep `details` free of message content and secrets. */
export async function audit(
  entry: { actorId: string | null; action: string; targetType: string; targetId: string; details?: Record<string, unknown> },
  tx: Tx = db,
) {
  await tx.auditLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      details: JSON.stringify(entry.details ?? {}),
    },
  });
}
