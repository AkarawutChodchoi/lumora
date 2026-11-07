import { ok, route } from "@/lib/server/http";
import { requireActiveUser } from "@/lib/server/access";
import { AppError } from "@/lib/server/errors";
import { claimDailyBonus } from "@/lib/server/wallet";
import { getFeatureFlags } from "@/lib/server/settings";

export const POST = route(async () => {
  const user = await requireActiveUser();
  if (!(await getFeatureFlags()).dailyBonus) throw new AppError("forbidden", "Daily bonus is currently unavailable");
  const entry = await claimDailyBonus(user.id);
  return ok({ granted: entry.paidDelta + entry.bonusDelta, balance: entry.balanceAfter });
});
