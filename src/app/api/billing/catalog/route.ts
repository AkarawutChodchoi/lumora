import { ok, route } from "@/lib/server/http";
import { paymentsEnabled } from "@/lib/server/config";
import { COIN_PACKS, MEMBERSHIP_PLANS, PAY_METHODS } from "@/lib/domain/catalog";

export const GET = route(async () => ok({ paymentsEnabled: paymentsEnabled(), packs: COIN_PACKS, plans: MEMBERSHIP_PLANS, methods: PAY_METHODS }));
