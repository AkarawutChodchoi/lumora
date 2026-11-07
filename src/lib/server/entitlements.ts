import "server-only";
import { and, desc, eq, gt, lte } from "drizzle-orm";
import { db, schema } from "@/db";
import { PLANS, type Entitlements } from "@/lib/domain/catalog";

/** Entitlements are always derived on the server from membership rows (gateway-paid or staff-granted). */
export async function getEntitlements(userId: string, now = new Date()): Promise<Entitlements> {
  const active = await getActiveMembership(userId, now);
  const plan = active ? "premium" : "free";
  const p = PLANS[plan];
  return {
    plan,
    modelTier: p.modelTier,
    monthlyCreditAllowance: p.monthlyCreditAllowance,
    memoryCharLimit: p.memoryCharLimit,
    features: [...p.features],
    until: active ? await membershipEnd(userId, now) : null,
  };
}

/** The membership period covering `now`, if any. */
export async function getActiveMembership(userId: string, now = new Date()) {
  const [m] = await db
    .select()
    .from(schema.membership)
    .where(and(eq(schema.membership.userId, userId), lte(schema.membership.startsAt, now), gt(schema.membership.endsAt, now)))
    .orderBy(desc(schema.membership.endsAt))
    .limit(1);
  return m ?? null;
}

/** When the user's Plus time runs out, counting periods queued after the current one. */
export async function membershipEnd(userId: string, now = new Date()) {
  const [m] = await db
    .select({ endsAt: schema.membership.endsAt })
    .from(schema.membership)
    .where(and(eq(schema.membership.userId, userId), gt(schema.membership.endsAt, now)))
    .orderBy(desc(schema.membership.endsAt))
    .limit(1);
  return m?.endsAt ?? null;
}
