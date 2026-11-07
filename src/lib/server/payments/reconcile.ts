import "server-only";
import { and, eq, gt, inArray, isNotNull, lt } from "drizzle-orm";
import { db, schema } from "@/db";
import { settle } from "./settle";

/**
 * Catch payments whose webhook never arrived: ask the gateway about every recent
 * unpaid payment and settle it (idempotent), then expire QR codes left pending
 * a day past their expiry (the gateway never received money for them).
 */
export async function reconcilePayments() {
  const { payment } = schema;
  const rows = await db
    .select({ id: payment.id, gateway: payment.gateway, chargeId: payment.gatewayChargeId })
    .from(payment)
    .where(and(inArray(payment.status, ["pending", "expired", "failed"]), isNotNull(payment.gatewayChargeId), gt(payment.createdAt, new Date(Date.now() - 3 * 86_400_000))));
  const tally: Record<string, number> = {};
  const notable: string[] = [];
  for (const r of rows) {
    const result = await settle(r.gateway, r.chargeId!).catch((e) => `error: ${(e as Error).message}`);
    tally[result] = (tally[result] ?? 0) + 1;
    if (result === "credited" || result === "mismatch" || result.startsWith("error")) notable.push(`${r.id}: ${result}`);
  }
  const stale = await db
    .update(payment)
    .set({ status: "expired", failureReason: "no payment before expiry (reconcile)" })
    .where(and(eq(payment.status, "pending"), lt(payment.expiresAt, new Date(Date.now() - 24 * 3_600_000))))
    .returning({ id: payment.id });
  return { checked: rows.length, tally, notable, expired: stale.length };
}
