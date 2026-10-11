import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { claimDailyBonus, getBalance, postLedgerEntry, verifyLedgerConsistency } from "@/server/services/credits";
import { processPaymentEvent, signPayload, verifySignature, type PaymentEventInput } from "@/server/services/billing";
import { getEntitlements } from "@/server/services/entitlements";
import { adjustCredits } from "@/server/services/admin";
import { SIGNUP_BONUS } from "@/server/domain/catalog";
import { makeUser, rid } from "./helpers";

describe("credit ledger", () => {
  it("grants the signup bonus exactly once and keeps ledger and balance consistent", async () => {
    const u = await makeUser();
    expect(await getBalance(u.id)).toBe(SIGNUP_BONUS);
    expect((await verifyLedgerConsistency(u.id)).consistent).toBe(true);
  });

  it("never overdraws under concurrent spending", async () => {
    const u = await makeUser();
    // Spend the signup bonus down to 5 coins.
    await postLedgerEntry({ userId: u.id, delta: -(SIGNUP_BONUS - 5), type: "generation_charge", idempotencyKey: `t:${rid()}` });
    const attempts = await Promise.allSettled(
      Array.from({ length: 12 }, () => postLedgerEntry({ userId: u.id, delta: -1, type: "generation_charge", idempotencyKey: `t:${rid()}` })),
    );
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(5);
    expect(attempts.filter((a) => a.status === "rejected").every((a) => (a as PromiseRejectedResult).reason.code === "insufficient_credits")).toBe(true);
    expect(await getBalance(u.id)).toBe(0);
    expect((await verifyLedgerConsistency(u.id)).consistent).toBe(true);
  });

  it("is idempotent: replaying a key does not change the balance", async () => {
    const u = await makeUser();
    const key = `t:${rid()}`;
    const a = await postLedgerEntry({ userId: u.id, delta: -3, type: "generation_charge", idempotencyKey: key });
    const b = await postLedgerEntry({ userId: u.id, delta: -3, type: "generation_charge", idempotencyKey: key });
    expect(b.replayed).toBe(true);
    expect(b.entry.id).toBe(a.entry.id);
    expect(await getBalance(u.id)).toBe(SIGNUP_BONUS - 3);
  });

  it("allows the daily bonus once per day", async () => {
    const u = await makeUser();
    await claimDailyBonus(u.id);
    await expect(claimDailyBonus(u.id)).rejects.toMatchObject({ code: "conflict" });
  });

  it("only lets admins adjust credits, always through the ledger with an audit log", async () => {
    const admin = await makeUser({ role: "admin" });
    const mod = await makeUser({ role: "moderator" });
    const u = await makeUser();
    await expect(adjustCredits(mod, { userId: u.id, delta: 100, reason: "goodwill credit", requestId: rid() })).rejects.toMatchObject({ code: "forbidden" });
    const entry = await adjustCredits(admin, { userId: u.id, delta: 100, reason: "goodwill credit", requestId: rid() });
    expect(entry.type).toBe("admin_adjustment");
    expect(await getBalance(u.id)).toBe(SIGNUP_BONUS + 100);
    expect(await db.auditLog.count({ where: { action: "billing.adjust", targetId: u.id } })).toBe(1);
  });
});

describe("payment webhooks", () => {
  const secret = "whsec_test_secret";

  it("verifies signatures and rejects tampered or stale payloads", () => {
    const body = JSON.stringify({ hello: "world" });
    const header = signPayload(body, secret);
    expect(verifySignature(body, header, secret)).toBe(true);
    expect(verifySignature(body + " ", header, secret)).toBe(false);
    expect(verifySignature(body, header, "wrong")).toBe(false);
    const old = signPayload(body, secret, Math.floor(Date.now() / 1000) - 3600);
    expect(verifySignature(body, old, secret)).toBe(false);
    expect(verifySignature(body, null, secret)).toBe(false);
  });

  const purchase = (userId: string, ref: string, amount = 9900): PaymentEventInput => ({
    id: `evt_${rid()}`,
    type: "purchase.completed",
    data: { userId, providerRef: ref, productId: "coins_300", amountMinor: amount, currency: "THB" },
  });

  it("grants coins once even when the same webhook is delivered twice", async () => {
    const u = await makeUser();
    const evt = purchase(u.id, `pi_${rid()}`);
    const first = await processPaymentEvent("testpay", evt);
    const second = await processPaymentEvent("testpay", evt);
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(await getBalance(u.id)).toBe(SIGNUP_BONUS + 300);
  });

  it("rejects payments whose amount does not match the catalog price", async () => {
    const u = await makeUser();
    await expect(processPaymentEvent("testpay", purchase(u.id, `pi_${rid()}`, 1))).rejects.toMatchObject({ code: "bad_request" });
    expect(await getBalance(u.id)).toBe(SIGNUP_BONUS);
    expect(await db.purchase.count({ where: { userId: u.id } })).toBe(0);
  });

  it("claws back coins on refund", async () => {
    const u = await makeUser();
    const ref = `pi_${rid()}`;
    await processPaymentEvent("testpay", purchase(u.id, ref));
    await processPaymentEvent("testpay", { id: `evt_${rid()}`, type: "purchase.refunded", data: { userId: u.id, providerRef: ref } });
    expect(await getBalance(u.id)).toBe(SIGNUP_BONUS);
    expect((await db.purchase.findUnique({ where: { providerRef: ref } }))?.status).toBe("refunded");
  });

  it("derives premium entitlements from verified subscription records and expires them", async () => {
    const u = await makeUser();
    expect((await getEntitlements(u.id)).plan).toBe("free");
    const ref = `sub_${rid()}`;
    const periodEnd = new Date(Date.now() + 30 * 86400000).toISOString();
    await processPaymentEvent("testpay", { id: `evt_${rid()}`, type: "subscription.activated", data: { userId: u.id, providerRef: ref, planId: "premium", amountMinor: 19900, currency: "THB", periodEnd } });
    expect((await getEntitlements(u.id)).plan).toBe("premium");
    expect(await getBalance(u.id)).toBe(SIGNUP_BONUS + 1500);
    await processPaymentEvent("testpay", { id: `evt_${rid()}`, type: "subscription.expired", data: { userId: u.id, providerRef: ref } });
    expect((await getEntitlements(u.id)).plan).toBe("free");
  });
});
