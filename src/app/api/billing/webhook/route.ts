import { NextResponse } from "next/server";
import { paymentsEnabled, config } from "@/server/config";
import { logger } from "@/server/logger";
import { AppError } from "@/server/errors";
import { paymentEventSchema, processPaymentEvent, verifySignature, webhookSecret } from "@/server/services/billing";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!paymentsEnabled()) return NextResponse.json({ error: "payments_not_configured" }, { status: 503 });
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-lumora-signature"), webhookSecret())) {
    logger.warn("webhook_bad_signature");
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }
  let event;
  try {
    event = paymentEventSchema.parse(JSON.parse(raw));
  } catch {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }
  try {
    const result = await processPaymentEvent(config().PAYMENT_PROVIDER, event);
    return NextResponse.json({ received: true, ...result });
  } catch (err) {
    if (err instanceof AppError) {
      logger.warn("webhook_rejected", { eventId: event.id, reason: err.message });
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    logger.error("webhook_failed", { eventId: event.id });
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }
}
