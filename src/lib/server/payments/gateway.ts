import "server-only";
import { mockGateway } from "./mock";
import { omiseGateway } from "./omise";

export type ChargeStatus = "pending" | "paid" | "failed" | "expired";

export type Gateway = {
  name: string;
  /** Ask the gateway for a PromptPay QR for this exact amount. */
  createCharge(o: { paymentId: string; amount: number; currency: "THB"; description: string; expiresAt: Date }): Promise<{ chargeId: string; qr: string }>;
  /** The gateway's own view of a charge — the only source of truth for "paid". */
  retrieveCharge(chargeId: string): Promise<{ status: ChargeStatus; amount: number; currency: string; paymentId?: string; failure?: string }>;
  /** Check the webhook's signature and pull out the event + charge ids. */
  verifyWebhook(rawBody: string, headers: Headers): { ok: boolean; eventId: string; chargeId?: string; type?: string };
};

const GATEWAYS: Record<string, Gateway> = { mock: mockGateway, omise: omiseGateway };

/** The gateway new payments go to (PAYMENT_GATEWAY). */
export function activeGateway(): Gateway {
  const name = process.env.PAYMENT_GATEWAY ?? "mock";
  const g = GATEWAYS[name];
  if (!g) throw new Error(`unknown PAYMENT_GATEWAY "${name}"`);
  if (name === "mock" && !mockAllowed()) throw new Error("the mock payment gateway is disabled here (set ALLOW_MOCK_GATEWAY=1 only for local testing)");
  return g;
}

export const gatewayByName = (name: string): Gateway | undefined => (name === "mock" && !mockAllowed() ? undefined : GATEWAYS[name]);

/** Never on the real site: Vercel production or no explicit opt-in. */
export const mockAllowed = () => process.env.ALLOW_MOCK_GATEWAY === "1" && process.env.VERCEL_ENV !== "production";
