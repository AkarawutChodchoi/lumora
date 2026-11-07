import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { gatewayByName } from "@/lib/server/payments/gateway";
import { settle } from "@/lib/server/payments/settle";

// Payment gateways call this server-to-server: POST /api/webhooks/payment/<gateway>.
// 1. verify the signature  2. store the raw event (once per event id)
// 3. ask the gateway API for the charge's real status and settle from that.
// Coins never depend on what the webhook body claims.

export async function POST(req: Request, { params }: { params: Promise<{ gateway: string }> }) {
  const { gateway } = await params;
  const gw = gatewayByName(gateway);
  if (!gw) return new Response("unknown gateway", { status: 404 });

  const raw = await req.text();
  if (raw.length > 256_000) return new Response("too large", { status: 413 });
  const v = gw.verifyWebhook(raw, req.headers);
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (!v.eventId) return new Response("missing event id", { status: 400 });

  const [stored] = await db
    .insert(schema.webhookEvent)
    .values({ gateway, eventId: v.ok ? v.eventId : `${v.eventId}:unverified:${Date.now()}`, signatureOk: v.ok, payload, result: v.ok ? null : "rejected: bad signature" })
    .onConflictDoNothing()
    .returning({ id: schema.webhookEvent.id });

  if (!v.ok) return new Response("bad signature", { status: 401 });
  let row = stored;
  if (!row) {
    // same event delivered again: if it was handled, acknowledge so the gateway stops retrying;
    // if the first attempt errored, try again (settle() is idempotent)
    const [prev] = await db
      .select({ id: schema.webhookEvent.id, result: schema.webhookEvent.result })
      .from(schema.webhookEvent)
      .where(and(eq(schema.webhookEvent.gateway, gateway), eq(schema.webhookEvent.eventId, v.eventId)));
    if (!prev || (prev.result && !prev.result.startsWith("error"))) return Response.json({ ok: true, duplicate: true });
    row = { id: prev.id };
  }
  if (!v.chargeId) {
    await db.update(schema.webhookEvent).set({ result: "ignored: not a charge event" }).where(eqId(row.id));
    return Response.json({ ok: true });
  }

  try {
    const result = await settle(gateway, v.chargeId);
    await db.update(schema.webhookEvent).set({ result }).where(eqId(row.id));
    return Response.json({ ok: true, result });
  } catch (e) {
    console.error("webhook settle failed", e);
    await db
      .update(schema.webhookEvent)
      .set({ result: "error: " + String((e as Error).message).slice(0, 200) })
      .where(eqId(row.id));
    // 500 → the gateway retries later; settle() is idempotent
    return new Response("error", { status: 500 });
  }
}

const eqId = (id: number) => eq(schema.webhookEvent.id, id);
