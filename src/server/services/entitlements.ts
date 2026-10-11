import { db } from "../db";
import { PLANS, type Entitlements } from "../domain/catalog";

/** Entitlements are always derived server-side from verified subscription records. */
export async function getEntitlements(userId: string, now = new Date()): Promise<Entitlements> {
  const active = await db.subscriptionRecord.findFirst({
    where: { userId, status: { in: ["active", "cancelled"] }, currentPeriodEnd: { gt: now } },
    orderBy: { currentPeriodEnd: "desc" },
  });
  const plan = active && active.planId === "premium" ? "premium" : "free";
  const p = PLANS[plan];
  return {
    plan,
    modelTier: p.modelTier,
    monthlyCreditAllowance: p.monthlyCreditAllowance,
    memoryCharLimit: p.memoryCharLimit,
    features: [...p.features],
  };
}

export async function getActiveSubscription(userId: string, now = new Date()) {
  return db.subscriptionRecord.findFirst({
    where: { userId, currentPeriodEnd: { gt: now }, status: { in: ["active", "cancelled"] } },
    orderBy: { currentPeriodEnd: "desc" },
  });
}
