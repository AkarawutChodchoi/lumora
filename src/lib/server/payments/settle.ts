import "server-only";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { MEMBERSHIP_PLANS, PLANS } from "@/lib/domain/catalog";
import { gatewayByName } from "./gateway";
import { applyEntry } from "../wallet";
import { notify } from "../notify";

export type SettleResult = "credited" | "already" | "pending" | "failed" | "expired" | "mismatch" | "unknown";

/**
 * Bring one payment in line with what the gateway says. Safe to call any number
 * of times, from webhooks, polling, the admin "re-check" button or reconciliation:
 * coins (or Lumora Plus) are granted only when the gateway itself reports the charge
 * as paid, with the exact amount and currency we asked for, and only once.
 */
export async function settle(gatewayName: string, chargeId: string): Promise<SettleResult> {
  const gw = gatewayByName(gatewayName);
  if (!gw) return "unknown";
  const [p] = await db
    .select()
    .from(schema.payment)
    .where(and(eq(schema.payment.gateway, gatewayName), eq(schema.payment.gatewayChargeId, chargeId)));
  if (!p) return "unknown";
  if (p.status === "paid") return "already";

  const charge = await gw.retrieveCharge(chargeId);

  if (charge.status === "paid") {
    if (charge.amount !== p.amount || charge.currency.toUpperCase() !== p.currency || (charge.paymentId && charge.paymentId !== p.id)) {
      await db
        .update(schema.payment)
        .set({ status: "mismatch", failureReason: `gateway: ${charge.amount} ${charge.currency}, expected ${p.amount} ${p.currency}` })
        .where(and(eq(schema.payment.id, p.id), inArray(schema.payment.status, ["pending", "expired", "failed"])));
      return "mismatch";
    }
    const plan = p.kind === "membership" ? MEMBERSHIP_PLANS.find((m) => m.id === p.productId) : undefined;
    // one transaction: mark paid (only from an unpaid state) + ledger rows + wallet (+ membership)
    const credited = await db.transaction(async (tx) => {
      const [up] = await tx
        .update(schema.payment)
        .set({ status: "paid", paidAt: new Date(), failureReason: null })
        .where(and(eq(schema.payment.id, p.id), inArray(schema.payment.status, ["pending", "expired", "failed"])))
        .returning();
      if (!up) return false;
      if (up.kind === "coins") {
        await applyEntry(tx, { userId: up.userId, kind: "topup", amount: up.coins, bucket: "paid", reference: up.id, note: `เติมเหรียญ ${up.id}` });
        if (up.bonus > 0) await applyEntry(tx, { userId: up.userId, kind: "bonus", amount: up.bonus, reference: `${up.id}:bonus`, note: `โบนัสแพ็ก ${up.id}` });
      } else {
        if (!plan) throw new Error(`unknown membership plan ${up.productId}`);
        // a new period starts when the current (or queued) one ends
        const [last] = await tx
          .select({ endsAt: schema.membership.endsAt })
          .from(schema.membership)
          .where(and(eq(schema.membership.userId, up.userId), gt(schema.membership.endsAt, new Date())))
          .orderBy(desc(schema.membership.endsAt))
          .limit(1);
        const startsAt = last?.endsAt ?? new Date();
        await tx
          .insert(schema.membership)
          .values({ userId: up.userId, planId: up.productId, paymentId: up.id, startsAt, endsAt: new Date(startsAt.getTime() + plan.days * 86_400_000) })
          .onConflictDoNothing();
        const allowance = PLANS[plan.plan].monthlyCreditAllowance * Math.max(1, Math.round(plan.days / 30));
        if (allowance > 0) await applyEntry(tx, { userId: up.userId, kind: "membership", amount: allowance, reference: `${up.id}:plus`, note: `เหรียญ ${plan.name}` });
      }
      return true;
    });
    if (credited)
      await notify(
        [p.userId],
        p.kind === "coins" ? "coins" : "membership",
        p.kind === "coins" ? `เติมเหรียญสำเร็จ +${(p.coins + p.bonus).toLocaleString("en-US")} เหรียญ (แพ็ก ฿${(p.amount / 100).toLocaleString("en-US")})` : `เปิดใช้ ${plan?.name ?? "Lumora Plus"} แล้ว`,
        "/coins?tab=history",
      ).catch(() => undefined);
    return credited ? "credited" : "already";
  }

  if (charge.status === "failed" || charge.status === "expired") {
    await db
      .update(schema.payment)
      .set({ status: charge.status, failureReason: charge.failure ?? null })
      .where(and(eq(schema.payment.id, p.id), eq(schema.payment.status, "pending")));
    return charge.status;
  }
  return "pending";
}
