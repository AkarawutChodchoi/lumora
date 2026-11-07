import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { ChargeStatus, Gateway } from "./gateway";

// Omise (Opn Payments) — PromptPay QR charges.
// Env: OMISE_SECRET_KEY (skey_…, server only), OMISE_WEBHOOK_SECRET (from the dashboard's webhook settings).
// Before going live, re-read Omise's current docs for: PromptPay charge creation,
// webhook signature headers, and charge statuses, and run the sandbox tests in the TODO.

const API = "https://api.omise.co";

async function omise<T>(path: string, init?: RequestInit): Promise<T> {
  const key = process.env.OMISE_SECRET_KEY;
  if (!key) throw new Error("OMISE_SECRET_KEY is not set");
  const res = await fetch(API + path, {
    ...init,
    headers: { authorization: "Basic " + Buffer.from(key + ":").toString("base64"), ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Omise ${res.status}: ${json?.message ?? "error"}`);
  return json as T;
}

type OmiseCharge = {
  id: string;
  amount: number;
  currency: string;
  status: "pending" | "successful" | "failed" | "expired" | "reversed";
  failure_message?: string | null;
  metadata?: { payment_id?: string };
  source?: { scannable_code?: { image?: { download_uri?: string } } };
};

const STATUS: Record<OmiseCharge["status"], ChargeStatus> = { pending: "pending", successful: "paid", failed: "failed", expired: "expired", reversed: "failed" };

export const omiseGateway: Gateway = {
  name: "omise",
  async createCharge(o) {
    const body = new URLSearchParams({
      amount: String(o.amount),
      currency: o.currency,
      "source[type]": "promptpay",
      description: o.description,
      "metadata[payment_id]": o.paymentId,
      expires_at: o.expiresAt.toISOString(),
    });
    const c = await omise<OmiseCharge>("/charges", { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" } });
    const qr = c.source?.scannable_code?.image?.download_uri;
    if (!qr) throw new Error("Omise did not return a PromptPay QR");
    return { chargeId: c.id, qr };
  },
  async retrieveCharge(chargeId) {
    const c = await omise<OmiseCharge>(`/charges/${encodeURIComponent(chargeId)}`);
    return { status: STATUS[c.status] ?? "pending", amount: c.amount, currency: c.currency.toUpperCase(), paymentId: c.metadata?.payment_id, failure: c.failure_message ?? undefined };
  },
  verifyWebhook(rawBody, headers) {
    let body: { id?: string; key?: string; data?: { id?: string; object?: string } } = {};
    try {
      body = JSON.parse(rawBody);
    } catch {}
    const secret = process.env.OMISE_WEBHOOK_SECRET;
    const ts = headers.get("omise-signature-timestamp") ?? "";
    const sigs = (headers.get("omise-signature") ?? "").split(",").map((s) => s.trim());
    let ok = false;
    if (secret && ts && Math.abs(Date.now() / 1000 - Number(ts)) < 300) {
      const want = createHmac("sha256", Buffer.from(secret, "base64")).update(`${ts}.${rawBody}`).digest("hex");
      ok = sigs.some((s) => s.length === want.length && timingSafeEqual(Buffer.from(s), Buffer.from(want)));
    }
    return { ok, eventId: body.id ?? "", chargeId: body.data?.object === "charge" ? body.data.id : undefined, type: body.key };
  },
};
