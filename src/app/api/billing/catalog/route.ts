import { ok, route } from "@/server/http";
import { paymentsEnabled } from "@/server/config";
import { COIN_PACKAGES, PLANS } from "@/server/domain/catalog";

export const GET = route(async () => ok({ paymentsEnabled: paymentsEnabled(), packages: COIN_PACKAGES, plans: PLANS }));
