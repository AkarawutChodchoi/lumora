import { PageHeader } from "@/components/ui/misc";
import { CoinsCenter } from "@/components/billing/coins-center";
import { pageUser } from "@/server/auth/current";
import { paymentsEnabled } from "@/server/config";
import { COIN_PACKAGES, PLANS } from "@/server/domain/catalog";
import { dailyBonusClaimedToday, getBalance, listLedger } from "@/server/services/credits";
import { getActiveSubscription, getEntitlements } from "@/server/services/entitlements";
import { getFeatureFlags } from "@/server/services/settings";
import { getT, pageTitle } from "@/i18n/server";
import { modelOptions } from "@/server/ai/models";

export const generateMetadata = pageTitle("coins");

export default async function CoinsPage() {
  const user = await pageUser("/coins");
  const [balance, ledger, claimed, entitlements, sub, flags] = await Promise.all([
    getBalance(user.id),
    listLedger(user.id),
    dailyBonusClaimedToday(user.id),
    getEntitlements(user.id),
    getActiveSubscription(user.id),
    getFeatureFlags(),
  ]);
  const t = await getT();
  return (
    <div className="animate-fade-in">
      <PageHeader title={t.coins.title} description={t.coins.subtitle} />
      <CoinsCenter
        balance={balance}
        dailyClaimed={claimed}
        dailyEnabled={flags.dailyBonus}
        paymentsEnabled={paymentsEnabled()}
        packages={COIN_PACKAGES.map((p) => ({ ...p }))}
        plans={JSON.parse(JSON.stringify(PLANS))}
        plan={entitlements.plan}
        subscription={sub ? { status: sub.status, currentPeriodEnd: sub.currentPeriodEnd.toISOString() } : null}
        ledger={JSON.parse(JSON.stringify(ledger.items))}
        nextCursor={ledger.nextCursor}
        models={modelOptions()}
      />
    </div>
  );
}
