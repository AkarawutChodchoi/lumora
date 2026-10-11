import { createHmac, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "../db";
import { AppError } from "../errors";
import { config } from "../config";
import { logger } from "../logger";
import { COIN_PACKAGES, PLANS } from "../domain/catalog";
import { applyLedgerEntry } from "./credits";
import { audit } from "./audit";

// Provider-neutral payment event processing.
//
// A real payment provider (Stripe, Omise, Apple/Google IAP server notifications)
// is integrated by writing an adapter that verifies the provider's own signature
// and translates its webhook into a `PaymentEventInput`. Until then, the
// endpoint accepts events signed with PAYMENT_WEBHOOK_SECRET using:
//   x-lumora-signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">
// The client can never mark a payment as successful.

const SIGNATURE_TOLERANCE_S = 300;

export const paymentEventSchema = z.object({
  id: z.string().min(1).max(200),
  type: z.enum([
    "purchase.completed",
    "purchase.refunded",
    "subscription.activated",
    "subscription.renewed",
    "subscription.cancelled",
    "subscription.expired",
  ]),
  data: z.object({
    userId: z.string().min(1),
    providerRef: z.string().min(1).max(200),
    productId: z.string().optional(),
    planId: z.enum(["premium"]).optional(),
    amountMinor: z.number().int().nonnegative().optional(),
    currency: z.string().length(3).optional(),
    periodEnd: z.string().datetime().optional(),
  }),
});
export type PaymentEventInput = z.infer<typeof paymentEventSchema>;

export function signPayload(rawBody: string, secret: string, timestamp = Math.floor(Date.now() / 1000)) {
  const sig = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `t=${timestamp},v1=${sig}`;
}

export function verifySignature(rawBody: string, header: string | null, secret: string, nowS = Math.floor(Date.now() / 1000)) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2) as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(nowS - t) > SIGNATURE_TOLERANCE_S || !parts.v1) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest();
  const given = Buffer.from(parts.v1, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Process a verified event exactly once. Duplicate deliveries are acknowledged and ignored. */
export async function processPaymentEvent(provider: string, event: PaymentEventInput) {
  try {
    return await db.$transaction(async (tx) => {
      // Insert the event first: the unique (provider, eventId) key makes replays fail fast.
      const record = await tx.paymentEvent.create({
        data: { provider, eventId: event.id, type: event.type, payload: JSON.stringify(event), result: "processing" },
      });
      const result = await applyEvent(tx, provider, event);
      await tx.paymentEvent.update({ where: { id: record.id }, data: { result } });
      return { duplicate: false, result };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { duplicate: true, result: "already_processed" };
    }
    throw err;
  }
}

async function applyEvent(tx: Prisma.TransactionClient, provider: string, event: PaymentEventInput): Promise<string> {
  const { data } = event;
  const user = await tx.user.findUnique({ where: { id: data.userId }, select: { id: true } });
  if (!user) throw new AppError("bad_request", "Unknown user");

  switch (event.type) {
    case "purchase.completed": {
      const pkg = COIN_PACKAGES.find((p) => p.id === data.productId);
      if (!pkg) throw new AppError("bad_request", "Unknown product");
      // Never trust the amount blindly: it must match our own price list.
      if (data.amountMinor !== pkg.priceMinor || data.currency !== pkg.currency) {
        logger.warn("payment_amount_mismatch", { eventId: event.id, productId: pkg.id });
        throw new AppError("bad_request", "Payment amount does not match the product price");
      }
      const purchase = await tx.purchase.create({
        data: {
          userId: data.userId,
          productId: pkg.id,
          provider,
          providerRef: data.providerRef,
          status: "completed",
          amountMinor: pkg.priceMinor,
          currency: pkg.currency,
          coins: pkg.coins,
        },
      });
      await applyLedgerEntry(tx, {
        userId: data.userId,
        delta: pkg.coins,
        type: "purchase",
        idempotencyKey: `purchase:${provider}:${data.providerRef}`,
        referenceType: "purchase",
        referenceId: purchase.id,
      });
      return "coins_granted";
    }
    case "purchase.refunded": {
      const purchase = await tx.purchase.findUnique({ where: { providerRef: data.providerRef } });
      if (!purchase || purchase.userId !== data.userId) throw new AppError("bad_request", "Unknown purchase");
      if (purchase.status === "refunded") return "already_refunded";
      await tx.purchase.update({ where: { id: purchase.id }, data: { status: "refunded" } });
      await applyLedgerEntry(tx, {
        userId: purchase.userId,
        delta: -purchase.coins,
        type: "purchase_refund",
        idempotencyKey: `purchase_refund:${provider}:${data.providerRef}`,
        referenceType: "purchase",
        referenceId: purchase.id,
        allowNegative: true,
      });
      await audit({ actorId: null, action: "billing.purchase_refunded", targetType: "purchase", targetId: purchase.id }, tx);
      return "coins_clawed_back";
    }
    case "subscription.activated":
    case "subscription.renewed": {
      if (!data.planId || !data.periodEnd) throw new AppError("bad_request", "Missing plan or period");
      const plan = PLANS[data.planId];
      if (data.amountMinor !== plan.priceMinor || data.currency !== plan.currency) {
        throw new AppError("bad_request", "Payment amount does not match the plan price");
      }
      const periodEnd = new Date(data.periodEnd);
      const sub = await tx.subscriptionRecord.upsert({
        where: { providerRef: data.providerRef },
        create: { userId: data.userId, planId: data.planId, status: "active", provider, providerRef: data.providerRef, currentPeriodEnd: periodEnd },
        update: { status: "active", currentPeriodEnd: periodEnd },
      });
      if (sub.userId !== data.userId) throw new AppError("bad_request", "Subscription belongs to another user");
      await applyLedgerEntry(tx, {
        userId: data.userId,
        delta: plan.monthlyCreditAllowance,
        type: "subscription_grant",
        idempotencyKey: `subgrant:${provider}:${data.providerRef}:${data.periodEnd}`,
        referenceType: "subscription",
        referenceId: sub.id,
      });
      return "subscription_active";
    }
    case "subscription.cancelled":
    case "subscription.expired": {
      const sub = await tx.subscriptionRecord.findUnique({ where: { providerRef: data.providerRef } });
      if (!sub || sub.userId !== data.userId) throw new AppError("bad_request", "Unknown subscription");
      // Cancelled keeps access until the paid period ends; expired ends it now.
      await tx.subscriptionRecord.update({
        where: { id: sub.id },
        data: event.type === "subscription.expired" ? { status: "expired", currentPeriodEnd: new Date() } : { status: "cancelled" },
      });
      return event.type === "subscription.expired" ? "subscription_expired" : "subscription_cancelled";
    }
  }
}

export function webhookSecret() {
  return config().PAYMENT_WEBHOOK_SECRET;
}
