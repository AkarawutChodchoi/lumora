import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import QRCode from "qrcode";
import type { ChargeStatus, Gateway } from "./gateway";

// A fake gateway for development and automated tests. It behaves like a real
// one: charges live "on the gateway side" (here: process memory), and payment
// results arrive as signed webhooks (see /api/dev/mock-pay).

type Charge = { id: string; paymentId: string; amount: number; currency: string; status: ChargeStatus };
const g = globalThis as unknown as { __mockCharges?: Map<string, Charge> };
const charges = (g.__mockCharges ??= new Map());

export const mockSecret = () => process.env.MOCK_WEBHOOK_SECRET ?? "mock-webhook-secret-for-local-testing-only";

export function mockSign(body: string, ts = Math.floor(Date.now() / 1000)) {
  return { ts: String(ts), sig: createHmac("sha256", mockSecret()).update(`${ts}.${body}`).digest("hex") };
}

/** Dev tool: change a charge's status on the "gateway" (amount can be faked to test mismatches). */
export function mockSetCharge(chargeId: string, status: ChargeStatus, amount?: number) {
  const c = charges.get(chargeId);
  if (!c) return null;
  c.status = status;
  if (amount !== undefined) c.amount = amount;
  return c;
}

export const mockGateway: Gateway = {
  name: "mock",
  async createCharge(o) {
    const id = `mock_chrg_${randomBytes(8).toString("hex")}`;
    charges.set(id, { id, paymentId: o.paymentId, amount: o.amount, currency: o.currency, status: "pending" });
    return { chargeId: id, qr: await QRCode.toDataURL(`MOCK-PROMPTPAY|${id}|${o.amount}`, { margin: 1, width: 240 }) };
  },
  async retrieveCharge(chargeId) {
    const c = charges.get(chargeId);
    if (!c) return { status: "failed", amount: 0, currency: "THB", failure: "unknown charge" };
    return { status: c.status, amount: c.amount, currency: c.currency, paymentId: c.paymentId };
  },
  verifyWebhook(rawBody, headers) {
    const ts = headers.get("x-mock-timestamp") ?? "";
    const sig = headers.get("x-mock-signature") ?? "";
    let body: { id?: string; chargeId?: string; type?: string } = {};
    try {
      body = JSON.parse(rawBody);
    } catch {}
    const fresh = Math.abs(Date.now() / 1000 - Number(ts)) < 300;
    const want = Buffer.from(mockSign(rawBody, Number(ts)).sig);
    const ok = fresh && sig.length === want.length && timingSafeEqual(Buffer.from(sig), want);
    return { ok, eventId: body.id ?? "", chargeId: body.chargeId, type: body.type };
  },
};
