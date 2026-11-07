import { ok, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/access";
import { dailyBonusClaimedToday, getWallet } from "@/lib/server/wallet";
import { getEntitlements } from "@/lib/server/entitlements";

export const GET = route(async () => {
  const user = await requireUser();
  const [w, entitlements, dailyClaimed] = await Promise.all([getWallet(user.id), getEntitlements(user.id), dailyBonusClaimedToday(user.id)]);
  return ok({ balance: w.total, wallet: { paid: w.paid, bonus: w.bonus }, entitlements, dailyClaimed });
});
