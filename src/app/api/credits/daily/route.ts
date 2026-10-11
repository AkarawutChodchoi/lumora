import { ok, route } from "@/server/http";
import { requireActiveUser } from "@/server/auth/guards";
import { AppError } from "@/server/errors";
import { claimDailyBonus } from "@/server/services/credits";
import { getFeatureFlags } from "@/server/services/settings";

export const POST = route(async () => {
  const user = await requireActiveUser();
  if (!(await getFeatureFlags()).dailyBonus) throw new AppError("forbidden", "Daily bonus is currently unavailable");
  const entry = await claimDailyBonus(user.id);
  return ok({ granted: entry.delta, balance: entry.balanceAfter });
});
