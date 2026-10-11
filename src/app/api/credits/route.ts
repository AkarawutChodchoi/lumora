import { ok, route } from "@/server/http";
import { requireUser } from "@/server/auth/guards";
import { dailyBonusClaimedToday, getBalance } from "@/server/services/credits";
import { getActiveSubscription, getEntitlements } from "@/server/services/entitlements";

export const GET = route(async () => {
  const user = await requireUser();
  const [balance, entitlements, dailyClaimed, subscription] = await Promise.all([
    getBalance(user.id),
    getEntitlements(user.id),
    dailyBonusClaimedToday(user.id),
    getActiveSubscription(user.id),
  ]);
  return ok({ balance, entitlements, dailyClaimed, subscription: subscription && { planId: subscription.planId, status: subscription.status, currentPeriodEnd: subscription.currentPeriodEnd } });
});
