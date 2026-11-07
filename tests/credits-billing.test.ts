import { describe, expect, it } from "vitest";
import { and, count, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { applyEntry, claimDailyBonus, getBalance, getWallet, postEntry, refundEntry, verifyLedgerConsistency } from "@/lib/server/wallet";
import { getEntitlements } from "@/lib/server/entitlements";
import { adjustCredits, setPremium } from "@/lib/server/admin";
import { COIN_PACKS, MEMBERSHIP_PLANS, PLANS, SIGNUP_BONUS } from "@/lib/domain/catalog";
import { mockGateway, mockSetCharge, mockSign } from "@/lib/server/payments/mock";
import { settle } from "@/lib/server/payments/settle";
import { POST as webhook } from "@/app/api/webhooks/payment/[gateway]/route";
import { makeUser, rid } from "./helpers";

describe("coin wallet (paid + bonus buckets)", () => {
  it("grants the signup bonus as bonus coins and keeps wallet and ledger consistent", async () => {
    const u = await makeUser();
    expect(await getWallet(u.id)).toMatchObject({ paid: 0, bonus: SIGNUP_BONUS });
    expect((await verifyLedgerConsistency(u.id)).consistent).toBe(true);
  });

  it("spends bonus coins first, then paid coins", async () => {
    const u = await makeUser();
    await postEntry({ userId: u.id, kind: "topup", amount: 20, bucket: "paid", reference: `t:${rid()}` });
    const { entry } = await postEntry({ userId: u.id, kind: "spend", amount: -(SIGNUP_BONUS + 5), reference: `t:${rid()}` });
    expect(entry).toMatchObject({ bonusDelta: -SIGNUP_BONUS, paidDelta: -5, balanceAfter: 15 });
    expect(await getWallet(u.id)).toMatchObject({ paid: 15, bonus: 0 });
  });

  it("never overdraws under concurrent spending", async () => {
    const u = await makeUser();
    await postEntry({ userId: u.id, kind: "spend", amount: -(SIGNUP_BONUS - 5), reference: `t:${rid()}` });
    const attempts = await Promise.allSettled(Array.from({ length: 12 }, () => postEntry({ userId: u.id, kind: "spend", amount: -1, reference: `t:${rid()}` })));
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(5);
    expect(attempts.filter((a) => a.status === "rejected").every((a) => (a as PromiseRejectedResult).reason.code === "insufficient_credits")).toBe(true);
    expect(await getBalance(u.id)).toBe(0);
    expect((await verifyLedgerConsistency(u.id)).consistent).toBe(true);
  });

  it("is idempotent: replaying a reference does not move coins again", async () => {
    const u = await makeUser();
    const ref = `t:${rid()}`;
    const a = await postEntry({ userId: u.id, kind: "spend", amount: -3, reference: ref });
    const b = await postEntry({ userId: u.id, kind: "spend", amount: -3, reference: ref });
    expect(b.replayed).toBe(true);
    expect(b.entry.id).toBe(a.entry.id);
    expect(await getBalance(u.id)).toBe(SIGNUP_BONUS - 3);
  });

  it("refunds a spend to the same buckets, once", async () => {
    const u = await makeUser();
    await postEntry({ userId: u.id, kind: "topup", amount: 10, bucket: "paid", reference: `t:${rid()}` });
    const spendRef = `t:${rid()}`;
    await postEntry({ userId: u.id, kind: "spend", amount: -(SIGNUP_BONUS + 4), reference: spendRef });
    const refundRef = `${spendRef}:refund`;
    await db.transaction((tx) => refundEntry(tx, spendRef, refundRef));
    await db.transaction((tx) => refundEntry(tx, spendRef, refundRef));
    expect(await getWallet(u.id)).toMatchObject({ paid: 10, bonus: SIGNUP_BONUS });
    expect((await verifyLedgerConsistency(u.id)).consistent).toBe(true);
  });

  it("allows the daily bonus once per day", async () => {
    const u = await makeUser();
    await claimDailyBonus(u.id);
    await expect(claimDailyBonus(u.id)).rejects.toMatchObject({ code: "conflict" });
  });

  it("only lets finance/admin adjust coins, always through the ledger with an audit row", async () => {
    const finance = await makeUser({ roles: ["finance"] });
    const mod = await makeUser({ roles: ["moderator"] });
    const u = await makeUser();
    await expect(adjustCredits(mod, { userId: u.id, delta: 100, bucket: "bonus", reason: "goodwill credit", requestId: rid() })).rejects.toMatchObject({ code: "forbidden" });
    const entry = await adjustCredits(finance, { userId: u.id, delta: 100, bucket: "paid", reason: "goodwill credit", requestId: rid() });
    expect(entry.kind).toBe("adjust");
    expect(await getWallet(u.id)).toMatchObject({ paid: 100, bonus: SIGNUP_BONUS });
    const [{ n }] = await db
      .select({ n: count() })
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.action, "billing.adjust"), eq(schema.auditLog.targetId, u.id)));
    expect(n).toBe(1);
  });

  it("keeps staff powers dormant until 2FA is on", async () => {
    const finance = await makeUser({ roles: ["finance"], twoFactorEnabled: false });
    const u = await makeUser();
    expect(finance.roles).toEqual(["member"]);
    await expect(adjustCredits(finance, { userId: u.id, delta: 5, bucket: "bonus", reason: "should not work", requestId: rid() })).rejects.toMatchObject({ code: "forbidden" });
  });
});

/** A payment as createPayment() records it, with a charge on the mock gateway. */
async function openPayment(userId: string, productId: string) {
  const pack = COIN_PACKS.find((p) => p.id === productId);
  const plan = MEMBERSHIP_PLANS.find((p) => p.id === productId);
  const id = `PAY-TEST-${rid().slice(0, 8)}`;
  const amount = (pack?.price ?? plan!.price) * 100;
  const expiresAt = new Date(Date.now() + 600_000);
  await db.insert(schema.payment).values({ id, userId, kind: pack ? "coins" : "membership", productId, amount, coins: pack?.coins ?? 0, bonus: pack?.bonus ?? 0, gateway: "mock", expiresAt });
  const c = await mockGateway.createCharge({ paymentId: id, amount, currency: "THB", description: id, expiresAt });
  await db.update(schema.payment).set({ gatewayChargeId: c.chargeId, qr: c.qr }).where(eq(schema.payment.id, id));
  return { id, chargeId: c.chargeId, amount };
}

function deliver(chargeId: string, eventId = `evt_${rid()}`, tamper = false) {
  const body = JSON.stringify({ id: eventId, type: "charge.complete", chargeId });
  const { ts, sig } = mockSign(body);
  const signature = tamper ? (sig[0] === "a" ? "b" : "a") + sig.slice(1) : sig;
  const req = new Request("http://localhost/api/webhooks/payment/mock", { method: "POST", body, headers: { "x-mock-timestamp": ts, "x-mock-signature": signature } });
  return webhook(req, { params: Promise.resolve({ gateway: "mock" }) });
}

describe("payments (gateway-confirmed only)", () => {
  const pack = COIN_PACKS.find((p) => p.bonus > 0)!;

  it("does nothing while the gateway says the charge is still pending", async () => {
    const u = await makeUser();
    const p = await openPayment(u.id, pack.id);
    expect(await settle("mock", p.chargeId)).toBe("pending");
    expect(await getBalance(u.id)).toBe(SIGNUP_BONUS);
  });

  it("credits paid + bonus coins once, even when the webhook is delivered twice", async () => {
    const u = await makeUser();
    const p = await openPayment(u.id, pack.id);
    mockSetCharge(p.chargeId, "paid");
    const ev = `evt_${rid()}`;
    expect((await deliver(p.chargeId, ev)).status).toBe(200);
    expect((await deliver(p.chargeId, ev)).status).toBe(200);
    expect(await settle("mock", p.chargeId)).toBe("already");
    expect(await getWallet(u.id)).toMatchObject({ paid: pack.coins, bonus: SIGNUP_BONUS + pack.bonus });
    const [row] = await db.select().from(schema.payment).where(eq(schema.payment.id, p.id));
    expect(row.status).toBe("paid");
    expect((await verifyLedgerConsistency(u.id)).consistent).toBe(true);
  });

  it("rejects webhooks with a bad signature and credits nothing", async () => {
    const u = await makeUser();
    const p = await openPayment(u.id, pack.id);
    mockSetCharge(p.chargeId, "paid");
    expect((await deliver(p.chargeId, `evt_${rid()}`, true)).status).toBe(401);
    expect(await getBalance(u.id)).toBe(SIGNUP_BONUS);
  });

  it("marks a wrong amount as mismatch instead of crediting", async () => {
    const u = await makeUser();
    const p = await openPayment(u.id, pack.id);
    mockSetCharge(p.chargeId, "paid", 100);
    expect(await settle("mock", p.chargeId)).toBe("mismatch");
    expect(await getBalance(u.id)).toBe(SIGNUP_BONUS);
  });

  it("records failed and expired charges without crediting", async () => {
    const u = await makeUser();
    const p = await openPayment(u.id, pack.id);
    mockSetCharge(p.chargeId, "expired");
    expect(await settle("mock", p.chargeId)).toBe("expired");
    const [row] = await db.select().from(schema.payment).where(eq(schema.payment.id, p.id));
    expect(row.status).toBe("expired");
    expect(await getBalance(u.id)).toBe(SIGNUP_BONUS);
  });

  it("turns a paid membership into Lumora Plus with its coin allowance, stacking periods", async () => {
    const u = await makeUser();
    expect((await getEntitlements(u.id)).plan).toBe("free");
    const plan = MEMBERSHIP_PLANS[0];
    const a = await openPayment(u.id, plan.id);
    mockSetCharge(a.chargeId, "paid");
    expect(await settle("mock", a.chargeId)).toBe("credited");
    const ent = await getEntitlements(u.id);
    expect(ent.plan).toBe("premium");
    expect(await getBalance(u.id)).toBe(SIGNUP_BONUS + PLANS.premium.monthlyCreditAllowance);
    const b = await openPayment(u.id, plan.id);
    mockSetCharge(b.chargeId, "paid");
    await settle("mock", b.chargeId);
    const until = (await getEntitlements(u.id)).until!;
    expect(until.getTime() - ent.until!.getTime()).toBeGreaterThan((plan.days - 1) * 86400000);
  });

  it("lets staff grant and end Plus without a payment", async () => {
    const admin = await makeUser({ roles: ["admin"] });
    const u = await makeUser();
    await setPremium(admin, u.id, { days: 7, reason: "support case" });
    expect((await getEntitlements(u.id)).plan).toBe("premium");
    await setPremium(admin, u.id, { days: 0, reason: "support case" });
    expect((await getEntitlements(u.id)).plan).toBe("free");
  });

  it("never credits the same top-up reference twice", async () => {
    const u = await makeUser();
    const ref = `PAY-DUP-${rid()}`;
    await db.transaction((tx) => applyEntry(tx, { userId: u.id, kind: "topup", amount: 10, bucket: "paid", reference: ref }));
    const again = await db.transaction((tx) => applyEntry(tx, { userId: u.id, kind: "topup", amount: 10, bucket: "paid", reference: ref }));
    expect(again.replayed).toBe(true);
    expect(await getWallet(u.id)).toMatchObject({ paid: 10 });
  });
});
