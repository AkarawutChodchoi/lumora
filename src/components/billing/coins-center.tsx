"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Coins, Gift, Crown, Check, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api";
import { useLocale, useT } from "@/i18n/client";
import { INTL_LOCALE } from "@/i18n/config";

interface LedgerRow {
  id: string;
  delta: number;
  balanceAfter: number;
  type: string;
  note: string | null;
  createdAt: string;
}

export function CoinsCenter(props: {
  balance: number;
  dailyClaimed: boolean;
  dailyEnabled: boolean;
  paymentsEnabled: boolean;
  packages: { id: string; coins: number; priceMinor: number; currency: string }[];
  plans: Record<string, { name: string; priceMinor: number; currency: string; perks: string[] }>;
  plan: string;
  subscription: { status: string; currentPeriodEnd: string } | null;
  ledger: LedgerRow[];
  nextCursor: string | null;
  models: { id: string; label: string; blurb: string; cost: number }[];
}) {
  const t = useT();
  const locale = useLocale();
  const price = (minor: number, currency: string) => new Intl.NumberFormat(INTL_LOCALE[locale], { style: "currency", currency }).format(minor / 100);
  const router = useRouter();
  const toast = useToast();
  const [balance, setBalance] = useState(props.balance);
  const [claimed, setClaimed] = useState(props.dailyClaimed);
  const [busy, setBusy] = useState<string | null>(null);
  const [ledger, setLedger] = useState(props.ledger);
  const [cursor, setCursor] = useState(props.nextCursor);

  async function claim() {
    setBusy("daily");
    try {
      const r = await api<{ granted: number; balance: number }>("/api/credits/daily", { method: "POST" });
      setBalance(r.balance);
      setClaimed(true);
      toast.success(t.coins.added(r.granted));
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function buy(productId: string) {
    setBusy(productId);
    try {
      const r = await api<{ url: string }>("/api/billing/checkout", { method: "POST", body: { productId } });
      window.location.href = r.url;
    } catch (e) {
      toast.error(errorMessage(e));
      setBusy(null);
    }
  }

  async function more() {
    if (!cursor) return;
    try {
      const r = await api<{ items: LedgerRow[]; nextCursor: string | null }>(`/api/credits/ledger?cursor=${cursor}`);
      setLedger((l) => [...l, ...r.items]);
      setCursor(r.nextCursor);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const premium = { ...props.plans.premium, ...t.plans.premium };

  return (
    <div className="space-y-10">
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="relative overflow-hidden p-6">
          <div className="absolute -top-16 -right-16 size-48 rounded-full bg-warn/10 blur-2xl" aria-hidden="true" />
          <p className="text-sm text-muted">{t.coins.balance}</p>
          <p className="mt-1 flex items-center gap-2 font-display text-3xl font-extrabold break-all tabular-nums sm:text-4xl">
            <Coins className="size-8 text-warn" /> {balance.toLocaleString(INTL_LOCALE[locale])}
          </p>
          <p className="mt-2 text-xs text-faint">{t.coins.balanceNote}</p>
        </Card>
        <Card className="flex flex-col justify-between gap-4 p-6">
          <div>
            <p className="flex items-center gap-2 font-semibold">
              <Gift className="size-5 text-accent" /> {t.coins.daily}
            </p>
            <p className="mt-1 text-sm text-muted">{t.coins.dailySub}</p>
          </div>
          <Button onClick={claim} loading={busy === "daily"} disabled={claimed || !props.dailyEnabled} variant={claimed ? "secondary" : "primary"}>
            {!props.dailyEnabled ? t.coins.dailyUnavailable : claimed ? t.coins.dailyClaimed : t.coins.dailyClaim}
          </Button>
        </Card>
      </div>

      {props.models.length > 0 && (
        <section aria-labelledby="prices">
          <h2 id="prices" className="font-display text-lg font-bold">{t.coins.prices}</h2>
          <p className="mb-3 text-sm text-muted">{t.coins.pricesSub}</p>
          <Card className="divide-y divide-line">
            {props.models.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{m.label}</p>
                  <p className="truncate text-xs text-faint">{t.chat.models[m.blurb] ?? ""}</p>
                </div>
                <span className="flex shrink-0 items-center gap-1 text-sm font-semibold tabular-nums">
                  <Coins className="size-4 text-warn" /> {t.chat.perReply(m.cost)}
                </span>
              </div>
            ))}
          </Card>
        </section>
      )}

      {!props.paymentsEnabled && (
        <p className="rounded-xl border border-warn/30 bg-warn/10 px-4 py-3 text-sm text-warn" role="status">
          {t.coins.paymentsOff}
        </p>
      )}

      <section>
        <h2 className="mb-4 font-display text-lg font-bold">{t.coins.packs}</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {props.packages.map((p, i) => (
            <Card key={p.id} className={`flex flex-col p-5 ${i === 1 ? "border-accent/60" : ""}`}>
              {i === 1 && <Badge tone="accent" className="mb-3 self-start">{t.coins.popular}</Badge>}
              <p className="flex items-center gap-2 font-display text-2xl font-bold">
                <Coins className="size-6 text-warn" /> {p.coins.toLocaleString(INTL_LOCALE[locale])}
              </p>
              <p className="mt-1 text-sm text-muted">{price(p.priceMinor, p.currency)}</p>
              <Button className="mt-5" variant={i === 1 ? "primary" : "secondary"} onClick={() => buy(p.id)} loading={busy === p.id} disabled={!props.paymentsEnabled}>
                {t.coins.buy}
              </Button>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <Card className="relative overflow-hidden p-6 sm:p-8">
          <div className="absolute inset-0 -z-0 bg-gradient-to-br from-accent/15 via-transparent to-glow/10" aria-hidden="true" />
          <div className="relative grid gap-6 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <p className="flex items-center gap-2 font-display text-xl font-bold">
                <Crown className="size-6 text-warn" /> {premium.name}
                {props.plan === "premium" && <Badge tone="ok">{t.coins.active}</Badge>}
              </p>
              <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                {premium.perks.map((perk) => (
                  <li key={perk} className="flex items-start gap-2 text-sm text-muted">
                    <Check className="mt-0.5 size-4 shrink-0 text-ok" /> {perk}
                  </li>
                ))}
              </ul>
              {props.subscription && (
                <p className="mt-4 text-xs text-faint">
                  {props.subscription.status === "cancelled" ? t.coins.cancelledUntil : t.coins.renews} {t.coins.on} {new Date(props.subscription.currentPeriodEnd).toLocaleDateString(INTL_LOCALE[locale])}
                </p>
              )}
            </div>
            <div className="text-center md:text-right">
              <p className="font-display text-3xl font-extrabold">{price(premium.priceMinor, premium.currency)}</p>
              <p className="text-xs text-faint">{t.coins.perMonth}</p>
              <Button className="mt-4 w-full md:w-auto" onClick={() => buy("premium")} loading={busy === "premium"} disabled={!props.paymentsEnabled || props.plan === "premium"}>
                {props.plan === "premium" ? t.coins.member : t.coins.getPlus}
              </Button>
            </div>
          </div>
        </Card>
      </section>

      <section>
        <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-bold">
          <Receipt className="size-5 text-accent" /> {t.coins.history}
        </h2>
        {ledger.length === 0 ? (
          <EmptyState title={t.coins.noTx} />
        ) : (
          <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
            <ul className="divide-y divide-line">
              {ledger.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{t.enums.ledger[r.type] ?? r.type}</p>
                    <p className="text-xs text-faint">{new Date(r.createdAt).toLocaleString(INTL_LOCALE[locale])}</p>
                  </div>
                  <div className="text-right tabular-nums">
                    <p className={r.delta > 0 ? "font-semibold text-ok" : "text-fg"}>
                      {r.delta > 0 ? "+" : ""}
                      {r.delta}
                    </p>
                    <p className="text-xs text-faint">{t.coins.bal(r.balanceAfter)}</p>
                  </div>
                </li>
              ))}
            </ul>
            {cursor && (
              <div className="border-t border-line p-2 text-center">
                <Button variant="ghost" size="sm" onClick={more}>
                  {t.common.loadMore}
                </Button>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
