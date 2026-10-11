import { parseJson, route } from "@/server/http";
import { z } from "zod";
import { requireActiveUser } from "@/server/auth/guards";
import { AppError } from "@/server/errors";
import { paymentsEnabled } from "@/server/config";
import { COIN_PACKAGES } from "@/server/domain/catalog";

/**
 * Starts a checkout with the payment provider. Coins are granted only by the
 * verified webhook, never by this endpoint or the client.
 */
export const POST = route(async (req: Request) => {
  await requireActiveUser();
  const { productId } = await parseJson(req, z.object({ productId: z.string().min(1).max(40) }));
  if (!COIN_PACKAGES.some((p) => p.id === productId) && productId !== "premium") throw new AppError("bad_request", "Unknown product");
  if (!paymentsEnabled()) {
    throw new AppError("ai_unavailable", "Payments are not available yet. No charge was made.");
  }
  // A provider adapter would create a checkout session here and return its URL.
  throw new AppError("ai_unavailable", "The configured payment provider has no checkout adapter yet. No charge was made.");
});
