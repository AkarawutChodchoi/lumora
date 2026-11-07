import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { currentUser } from "@/lib/server/access";
import { mockAllowed } from "@/lib/server/payments/gateway";
import { mockSetCharge, mockSign } from "@/lib/server/payments/mock";

// Development only: pretend the customer paid (or not) on the mock gateway, then
// deliver a signed webhook to our own endpoint — exactly the path a real
// gateway would take. Disabled unless ALLOW_MOCK_GATEWAY=1 (never on Vercel production).

export async function POST(req: Request) {
  if (!mockAllowed()) return new Response("Not found", { status: 404 });
  const uid = (await currentUser())?.id;
  if (!uid) return new Response("sign in first", { status: 401 });
  const { paymentId, outcome, amount, replay } = (await req.json().catch(() => ({}))) as { paymentId?: string; outcome?: "paid" | "failed" | "expired"; amount?: number; replay?: number };
  if (!paymentId || !outcome || !["paid", "failed", "expired"].includes(outcome)) return new Response("bad request", { status: 400 });
  const [p] = await db
    .select()
    .from(schema.payment)
    .where(and(eq(schema.payment.id, paymentId), eq(schema.payment.userId, uid), eq(schema.payment.gateway, "mock")));
  if (!p?.gatewayChargeId || !mockSetCharge(p.gatewayChargeId, outcome, amount)) return new Response("no such mock payment", { status: 404 });

  const body = JSON.stringify({ id: `mock_evnt_${randomBytes(8).toString("hex")}`, type: "charge.complete", chargeId: p.gatewayChargeId });
  const results = [];
  // `replay` re-sends the identical event (tests duplicate delivery)
  for (let i = 0; i < 1 + Math.min(5, replay ?? 0); i++) {
    const { ts, sig } = mockSign(body);
    const res = await fetch(new URL("/api/webhooks/payment/mock", req.url), { method: "POST", body, headers: { "content-type": "application/json", "x-mock-timestamp": ts, "x-mock-signature": sig } });
    results.push({ status: res.status, body: await res.json().catch(() => null) });
  }
  return Response.json({ ok: true, results });
}
