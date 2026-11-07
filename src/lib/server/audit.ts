import "server-only";
import { headers } from "next/headers";
import { db, schema, type Q } from "@/db";

/**
 * Append a row to the audit log (privileged or security-relevant actions).
 * Keep `details` free of message content and secrets. `details.before`/`after`/`reason`
 * land in their own columns; anything else is kept under `after`.
 */
export async function audit(
  entry: { actorId: string | null; action: string; targetType: string; targetId: string; details?: Record<string, unknown> },
  tx: Q = db,
) {
  const { before, after, reason, ...rest } = entry.details ?? {};
  let ip: string | null = null;
  try {
    ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  } catch {
    // outside a request (cron, scripts, tests)
  }
  await tx.insert(schema.auditLog).values({
    actorId: entry.actorId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    before: before ?? null,
    after: after ?? (Object.keys(rest).length ? rest : null),
    reason: typeof reason === "string" ? reason : null,
    ip,
  });
}
