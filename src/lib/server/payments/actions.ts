"use server";

import { randomBytes } from "node:crypto";
import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { COIN_PACKS, MEMBERSHIP_PLANS } from "@/lib/domain/catalog";
import { currentUser, requirePermission } from "../access";
import { audit } from "../audit";
import { allow } from "../rateLimit";
import { activeGateway } from "./gateway";
import { settle } from "./settle";

const { payment } = schema;
const TTL_MS = 10 * 60_000;

const newId = () => {
  const d = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10).replace(/-/g, "");
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return `PAY-${d}-${[...randomBytes(6)].map((b) => alphabet[b % alphabet.length]).join("")}`;
};

export type PaymentView = {
  id: string;
  kind: "coins" | "membership";
  productId: string;
  status: "pending" | "paid" | "failed" | "expired" | "mismatch" | "refunded";
  amount: number;
  coins: number;
  bonus: number;
  qr: string | null;
  expiresAt: number;
  createdAt: number;
};

const view = (p: typeof payment.$inferSelect): PaymentView => ({
  id: p.id,
  kind: p.kind,
  productId: p.productId,
  status: p.status,
  amount: p.amount / 100,
  coins: p.coins,
  bonus: p.bonus,
  qr: p.status === "pending" ? p.qr : null,
  expiresAt: p.expiresAt.getTime(),
  createdAt: p.createdAt.getTime(),
});

/** Signed-in, not suspended (restricted accounts may still top up). */
async function payerId() {
  const u = await currentUser();
  return u && u.status !== "suspended" ? u.id : null;
}

const createInput = z.object({ productId: z.string().max(40) });

/** Start a QR payment. Amount and coins come from the server's price list, never from the browser. */
export async function createPayment(input: z.input<typeof createInput>): Promise<{ ok: true; payment: PaymentView } | { ok: false; error: "auth" | "invalid" | "rate" | "gateway" }> {
  const uid = await payerId();
  if (!uid) return { ok: false, error: "auth" };
  const parsed = createInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const pack = COIN_PACKS.find((p) => p.id === parsed.data.productId);
  const plan = MEMBERSHIP_PLANS.find((p) => p.id === parsed.data.productId);
  if (!pack && !plan) return { ok: false, error: "invalid" };
  if (!(await allow(`pay:${uid}`, 5, 60_000))) return { ok: false, error: "rate" };
  // at most 3 open QR codes per user
  const [{ open }] = await db
    .select({ open: count() })
    .from(payment)
    .where(and(eq(payment.userId, uid), eq(payment.status, "pending"), gte(payment.expiresAt, new Date())));
  if (open >= 3) return { ok: false, error: "rate" };

  let gw;
  try {
    gw = activeGateway();
  } catch (e) {
    console.error(e);
    return { ok: false, error: "gateway" };
  }
  const id = newId();
  const amount = (pack?.price ?? plan!.price) * 100;
  const expiresAt = new Date(Date.now() + TTL_MS);
  // recorded before calling the gateway, so every attempt leaves a trace
  await db.insert(payment).values({
    id,
    userId: uid,
    kind: pack ? "coins" : "membership",
    productId: parsed.data.productId,
    amount,
    coins: pack?.coins ?? 0,
    bonus: pack?.bonus ?? 0,
    gateway: gw.name,
    expiresAt,
  });
  try {
    const c = await gw.createCharge({ paymentId: id, amount, currency: "THB", description: `Lumora ${id}`, expiresAt });
    const [p] = await db.update(payment).set({ gatewayChargeId: c.chargeId, qr: c.qr }).where(eq(payment.id, id)).returning();
    return { ok: true, payment: view(p) };
  } catch (e) {
    console.error("createCharge failed", e);
    await db
      .update(payment)
      .set({ status: "failed", failureReason: String((e as Error).message).slice(0, 300) })
      .where(eq(payment.id, id));
    return { ok: false, error: "gateway" };
  }
}

/** Polled by the payment page. Display only: it can nudge settlement, never decide it. */
export async function getPayment(id: string): Promise<PaymentView | null> {
  const uid = await payerId();
  if (!uid || typeof id !== "string" || id.length > 40) return null;
  let [p] = await db
    .select()
    .from(payment)
    .where(and(eq(payment.id, id), eq(payment.userId, uid)));
  if (!p) return null;
  if (p.status === "pending" && p.gatewayChargeId && (await allow(`poll:${uid}`, 40, 60_000))) {
    await settle(p.gateway, p.gatewayChargeId);
    [p] = await db.select().from(payment).where(eq(payment.id, id));
  }
  return view(p);
}

/** The signed-in user's recent payment attempts (coins page history). */
export async function myPayments(): Promise<PaymentView[]> {
  const uid = await payerId();
  if (!uid) return [];
  const rows = await db.select().from(payment).where(eq(payment.userId, uid)).orderBy(desc(payment.createdAt)).limit(50);
  return rows.map(view);
}

// ---------------- admin ----------------

export type AdminPaymentRow = { id: string; user: string; kind: string; product: string; status: string; thb: number; coins: number; bonus: number; gateway: string; chargeId: string | null; at: number; paidAt: number | null; reason: string | null };

const listInput = z.object({
  status: z.enum(["all", "pending", "paid", "failed", "expired", "mismatch", "refunded"]).default("all"),
  q: z.string().max(80).default(""),
  limit: z.number().int().min(1).max(1000).default(200),
});

export async function adminListPayments(input: z.input<typeof listInput>): Promise<{
  rows: AdminPaymentRow[];
  revenue: { day: string; thb: number; count: number }[];
  webhooks: { at: number; event: string; ok: boolean; result: string | null }[];
}> {
  await requirePermission("billing.view");
  const { status, q, limit } = listInput.parse(input);
  const term = q.trim();
  const rows = await db
    .select({ p: payment, email: schema.user.email })
    .from(payment)
    .innerJoin(schema.user, eq(schema.user.id, payment.userId))
    .where(and(status === "all" ? undefined : eq(payment.status, status), term ? sql`(${payment.id} ilike ${"%" + term + "%"} or ${schema.user.email} ilike ${"%" + term + "%"})` : undefined))
    .orderBy(desc(payment.createdAt))
    .limit(limit);
  // money actually received, per Bangkok day
  const revenue = await db.execute<{ day: string; thb: number; count: number }>(sql`
    select to_char(paid_at at time zone 'Asia/Bangkok', 'YYYY-MM-DD') as day, (sum(amount) / 100)::int as thb, count(*)::int as count
    from payment where status = 'paid' and paid_at > now() - interval '90 days' group by 1 order by 1 desc`);
  const hooks = await db.select().from(schema.webhookEvent).orderBy(desc(schema.webhookEvent.receivedAt)).limit(50);
  return {
    rows: rows.map(({ p, email }) => ({
      id: p.id,
      user: email,
      kind: p.kind,
      product: p.productId,
      status: p.status,
      thb: p.amount / 100,
      coins: p.coins,
      bonus: p.bonus,
      gateway: p.gateway,
      chargeId: p.gatewayChargeId,
      at: p.createdAt.getTime(),
      paidAt: p.paidAt?.getTime() ?? null,
      reason: p.failureReason,
    })),
    revenue: revenue.rows.map((r) => ({ day: r.day, thb: Number(r.thb), count: Number(r.count) })),
    webhooks: hooks.map((h) => {
      const body = h.payload as { key?: string; type?: string };
      return { at: h.receivedAt.getTime(), event: `${h.gateway} · ${body.key ?? body.type ?? h.eventId}`, ok: h.signatureOk, result: h.result };
    }),
  };
}

/** "Re-check with gateway": the only way staff can move a payment — by asking the gateway again. */
export async function adminRecheckPayment(id: string) {
  const me = await requirePermission("payments.recheck");
  const [p] = await db
    .select()
    .from(payment)
    .where(eq(payment.id, String(id).slice(0, 40)));
  if (!p?.gatewayChargeId) return { ok: false as const, error: "ไม่พบรายการ หรือรายการนี้ยังไม่ได้สร้าง QR" };
  const before = p.status;
  const result = await settle(p.gateway, p.gatewayChargeId);
  await audit({ actorId: me.id, action: "payment.recheck", targetType: "payment", targetId: p.id, details: { before: { status: before }, after: { result } } });
  return { ok: true as const, result };
}
