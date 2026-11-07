import { CoinsCenter } from "@/components/billing/coins-center";
import { pageUser } from "@/lib/server/access";
import { paymentsEnabled } from "@/lib/server/config";
import { COIN_PACKS, DAILY_BONUS, MEMBERSHIP_PLANS, PLANS } from "@/lib/domain/catalog";
import { dailyBonusClaimedToday, getWallet } from "@/lib/server/wallet";
import { membershipEnd } from "@/lib/server/entitlements";
import { getFeatureFlags } from "@/lib/server/settings";
import { myPayments } from "@/lib/server/payments/actions";
import { mockAllowed } from "@/lib/server/payments/gateway";
import { pageTitle } from "@/i18n/server";
import { modelOptions } from "@/lib/server/ai/models";

export const dynamic = "force-dynamic";
export const generateMetadata = pageTitle("coins");

export default async function CoinsPage() {
  const user = await pageUser("/coins");
  const [w, claimed, plusUntil, flags, payments] = await Promise.all([getWallet(user.id), dailyBonusClaimedToday(user.id), membershipEnd(user.id), getFeatureFlags(), myPayments()]);
  return (
    <div className="animate-fade-in">
      <CoinsCenter
        wallet={{ paid: w.paid, bonus: w.bonus }}
        dailyClaimed={claimed}
        dailyEnabled={flags.dailyBonus}
        dailyAmount={DAILY_BONUS}
        paymentsEnabled={paymentsEnabled()}
        mockPayments={process.env.PAYMENT_GATEWAY === "mock" && mockAllowed()}
        packs={COIN_PACKS.map((p) => ({ ...p }))}
        plans={MEMBERSHIP_PLANS.map((p) => ({ ...p, coins: PLANS[p.plan].monthlyCreditAllowance * Math.max(1, Math.round(p.days / 30)) }))}
        plusUntil={plusUntil?.toISOString() ?? null}
        payments={payments}
        models={modelOptions()}
      />
    </div>
  );
}
