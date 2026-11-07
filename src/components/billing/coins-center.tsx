"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, Crown, Download, Gift, QrCode } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { CoinIcon } from "@/components/layout/site-chrome";
import { api, errorMessage } from "@/lib/api";
import { useLocale, useT } from "@/i18n/client";
import { INTL_LOCALE } from "@/i18n/config";
import { createPayment, getPayment, type PaymentView } from "@/lib/server/payments/actions";

type Pack = { id: string; price: number; coins: number; bonus: number; tag?: string };
type Plan = { id: string; name: string; days: number; price: number; tag?: string; coins: number };

const card = "rounded-2xl border border-line bg-card";

function Countdown({ until, onExpire, label, warn }: { until: number; onExpire: () => void; label: string; warn: string }) {
  const [left, setLeft] = useState(() => Math.max(0, Math.round((until - Date.now()) / 1000)));
  useEffect(() => {
    if (left <= 0) {
      onExpire();
      return;
    }
    const t = setTimeout(() => setLeft(Math.max(0, Math.round((until - Date.now()) / 1000))), 1000);
    return () => clearTimeout(t);
  }, [left, until, onExpire]);
  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");
  return (
    <div role="timer" aria-live="off" className="rounded-[10px] bg-danger-bg px-3 py-2.5 text-center text-[13px] leading-normal text-danger-soft">
      {label}{" "}
      <b className="font-display text-base tabular-nums">
        {mm}:{ss}
      </b>{" "}
      · {warn}
    </div>
  );
}

export function CoinsCenter(props: {
  wallet: { paid: number; bonus: number };
  dailyClaimed: boolean;
  dailyEnabled: boolean;
  dailyAmount: number;
  paymentsEnabled: boolean;
  mockPayments: boolean;
  packs: Pack[];
  plans: Plan[];
  plusUntil: string | null;
  payments: PaymentView[];
  models: { id: string; label: string; blurb: string; cost: number }[];
}) {
  const t = useT();
  const P = t.pay;
  const locale = useLocale();
  const L = INTL_LOCALE[locale];
  const num = (n: number) => n.toLocaleString(L);
  const router = useRouter();
  const toast = useToast();

  const [wallet, setWallet] = useState(props.wallet);
  const [claimed, setClaimed] = useState(props.dailyClaimed);
  const [busy, setBusy] = useState(false);
  const [product, setProduct] = useState(props.packs.find((p) => p.tag)?.id ?? props.packs[0]?.id);
  const [live, setLive] = useState<PaymentView | null>(null);
  // render-stable clock for "is this still pending?" checks
  const [now] = useState(() => Date.now());

  const pack = props.packs.find((p) => p.id === product);
  const plan = props.plans.find((p) => p.id === product);
  const price = pack?.price ?? plan?.price ?? 0;
  const pendingOld = props.payments.find((p) => p.status === "pending" && p.expiresAt > now - 30 * 60_000);
  const resultUrl = (id: string) => `/coins/result?tx=${encodeURIComponent(id)}`;

  async function claim() {
    setBusy(true);
    try {
      const r = await api<{ granted: number; balance: number }>("/api/credits/daily", { method: "POST" });
      setWallet((w) => ({ ...w, bonus: w.bonus + r.granted }));
      setClaimed(true);
      toast.success(t.coins.added(r.granted));
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function pay() {
    if (!product) return;
    setBusy(true);
    try {
      const r = await createPayment({ productId: product });
      if (!r.ok) {
        toast.error(r.error === "rate" ? P.rate : r.error === "auth" ? t.common.genericError : P.gateway);
        return;
      }
      setLive(r.payment);
    } catch {
      toast.error(P.gateway);
    } finally {
      setBusy(false);
    }
  }

  // watch the payment while its QR is on screen; the server settles it with the gateway
  useEffect(() => {
    if (!live) return;
    const id = live.id;
    const timer = setInterval(async () => {
      const p = await getPayment(id).catch(() => null);
      if (p && p.status !== "pending") {
        clearInterval(timer);
        router.push(resultUrl(id));
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [live, router]);

  function saveQr() {
    if (!live?.qr) return;
    const a = document.createElement("a");
    a.href = live.qr;
    a.download = `lumora-qr-${live.id}.png`;
    a.click();
    toast.success(P.saved);
  }

  const fmtDate = (ms: number) => new Date(ms).toLocaleString(L, { dateStyle: "medium", timeStyle: "short" });
  const statusColor: Record<PaymentView["status"], string> = {
    paid: "text-free",
    pending: "text-accent-ink",
    failed: "text-danger",
    expired: "text-danger",
    mismatch: "text-warn",
    refunded: "text-muted",
  };
  const itemLabel = (p: PaymentView) => {
    if (p.kind === "membership") return props.plans.find((x) => x.id === p.productId)?.name ?? "Lumora Plus";
    return `${num(p.coins + p.bonus)} ${P.coins}`;
  };

  return (
    <div className="flex flex-col gap-7 lg:flex-row">
      <div className="flex min-w-0 flex-1 flex-col gap-7">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="font-display text-[28px] font-bold md:text-[34px]">{P.title}</h1>
            <p className="mt-1.5 text-sm text-muted">{P.subtitle}</p>
          </div>
          <div className={`${card} flex items-center gap-3 rounded-[14px] px-[18px] py-3`}>
            <CoinIcon size={30} />
            <div>
              <div className="text-xs text-muted">{P.balance}</div>
              <div className="font-display text-2xl font-semibold tabular-nums">{num(wallet.paid + wallet.bonus)}</div>
            </div>
            <div className="ml-3 border-l border-line pl-3 text-xs leading-relaxed text-muted">
              {P.paidCoins} {num(wallet.paid)}
              <br />
              {P.bonusCoins} <span className="text-free">{num(wallet.bonus)}</span>
            </div>
          </div>
        </div>

        {pendingOld && !live && (
          <div role="status" className="flex flex-col gap-2 rounded-xl border border-accent-line bg-accent-soft p-4 text-sm md:flex-row md:items-center md:justify-between">
            <span className="flex items-center gap-2">
              <AlertTriangle size={18} className="shrink-0 text-accent-ink" /> {P.pendingBanner(pendingOld.id)}
            </span>
            <Link href={resultUrl(pendingOld.id)} className="font-semibold text-accent-ink">
              {P.viewStatus}
            </Link>
          </div>
        )}

        {!props.paymentsEnabled && <p className="rounded-xl border border-warn/30 bg-warn-bg p-4 text-sm text-warn">{P.paymentsOff}</p>}

        {/* daily bonus */}
        <section className={`${card} flex flex-wrap items-center justify-between gap-4 p-5`}>
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-xl bg-free-bg text-free">
              <Gift className="size-5" />
            </span>
            <div>
              <h2 className="font-display text-lg font-semibold">{t.coins.daily}</h2>
              <p className="text-sm text-muted">{t.coins.dailySub}</p>
            </div>
          </div>
          <button onClick={claim} disabled={busy || claimed || !props.dailyEnabled} className="inline-flex h-10 cursor-pointer items-center rounded-[9px] border border-line2 bg-field px-4 text-sm font-semibold text-ink2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50">
            {!props.dailyEnabled ? t.coins.dailyUnavailable : claimed ? t.coins.dailyClaimed : `+${props.dailyAmount}`}
          </button>
        </section>

        <section className="flex flex-col gap-3.5">
          <h2 className="font-display text-xl font-semibold">{P.choosePack}</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-3.5" role="radiogroup" aria-label={P.choosePack}>
            {props.packs.map((p) => {
              const on = p.id === product;
              return (
                <button
                  key={p.id}
                  role="radio"
                  aria-checked={on}
                  disabled={!!live}
                  onClick={() => setProduct(p.id)}
                  className={`relative flex h-[140px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[14px] border-2 disabled:cursor-not-allowed md:h-[150px] ${on ? "border-accent bg-accent-soft" : "border-line2 bg-card"}`}
                >
                  {p.tag && <span className="absolute -top-px left-1/2 -translate-x-1/2 rounded-b-lg bg-accent px-2.5 py-[3px] text-[11px] font-bold text-on-accent">{p.tag}</span>}
                  <span className="flex items-center gap-1.5 font-display text-[24px] font-bold md:text-[26px]">
                    <CoinIcon size={22} />
                    {num(p.coins + p.bonus)}
                  </span>
                  <span className="min-h-4 text-xs font-semibold text-free">{p.bonus ? P.bonus(num(p.bonus)) : ""}</span>
                  <span className="text-[15px] font-semibold text-ink2">฿{num(p.price)}</span>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted">{P.bonusNote}</p>
        </section>

        {/* Lumora Plus */}
        <section className="flex flex-col gap-3.5">
          <div>
            <h2 className="flex items-center gap-2 font-display text-xl font-semibold">
              <Crown size={20} className="text-accent-ink" aria-hidden="true" /> {P.plusTitle}
            </h2>
            <p className="mt-1 text-sm text-muted">{P.plusSub}</p>
            {props.plusUntil && <p className="mt-2 text-sm text-free">{P.plusActive(new Date(props.plusUntil).toLocaleDateString(L, { dateStyle: "long" }))}</p>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label={P.plusTitle}>
            {props.plans.map((p) => {
              const on = p.id === product;
              return (
                <button
                  key={p.id}
                  role="radio"
                  aria-checked={on}
                  disabled={!!live}
                  onClick={() => setProduct(p.id)}
                  className={`relative flex cursor-pointer flex-col items-start gap-1 rounded-[14px] border-2 p-5 text-left disabled:cursor-not-allowed ${on ? "border-accent bg-accent-soft" : "border-line2 bg-card"}`}
                >
                  {p.tag && <span className="absolute top-3 right-3 rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-bold text-on-accent">{p.tag}</span>}
                  <span className="font-display text-lg font-semibold">{p.name}</span>
                  <span className="text-sm text-muted">
                    {P.plusDays(p.days)} · {P.plusCoins(num(p.coins))}
                  </span>
                  <span className="mt-2 font-display text-2xl font-bold">฿{num(p.price)}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className={`${card} flex flex-col gap-4 p-5 md:p-6`} aria-labelledby="howto">
          <h2 id="howto" className="flex items-center gap-2 font-display text-xl font-semibold">
            <QrCode size={22} className="text-accent-ink" aria-hidden="true" /> {P.howTo}
          </h2>
          <ol className="flex flex-col gap-3.5">
            {P.steps.map((x, i) => (
              <li key={x.t} className="flex gap-3.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent font-display font-bold text-on-accent">{i + 1}</span>
                <span className="flex flex-col gap-0.5">
                  <span className="font-semibold">{x.t}</span>
                  <span className="text-[13px] leading-relaxed text-sub">{x.d}</span>
                </span>
              </li>
            ))}
          </ol>
          <div className="rounded-xl bg-field p-3.5 text-[13px] leading-relaxed text-sub">
            {P.caution}{" "}
            <Link href="/safety" className="font-semibold text-accent-ink">
              {P.report}
            </Link>
          </div>
        </section>

        {props.models.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="font-display text-xl font-semibold">{t.coins.prices}</h2>
            <p className="text-sm text-muted">{t.coins.pricesSub}</p>
            <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
              {props.models.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-4 bg-card px-4 py-3 text-sm">
                  <span className="min-w-0">
                    <span className="block font-semibold">{m.label}</span>
                    <span className="block truncate text-xs text-muted">{m.blurb}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1 font-semibold">
                    <CoinIcon size={16} /> {m.cost}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="flex flex-col gap-3">
          <h2 className="font-display text-xl font-semibold">{P.history}</h2>
          {props.payments.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line2 p-6 text-center text-sm text-muted">{P.noHistory}</div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-line">
              <div className="hidden grid-cols-4 bg-card px-[18px] py-3 text-xs text-muted md:grid">
                <span>{P.colDate}</span>
                <span>{P.colItem}</span>
                <span>{P.colAmount}</span>
                <span>{P.colStatus}</span>
              </div>
              {props.payments.map((p) => (
                <Link key={p.id} href={resultUrl(p.id)} className="grid grid-cols-2 gap-1 border-t border-line px-[18px] py-3.5 text-sm first:border-t-0 hover:bg-card md:grid-cols-4 md:first:border-t">
                  <span className="text-muted md:text-ink">{fmtDate(p.createdAt)}</span>
                  <span className="text-right md:text-left">{itemLabel(p)}</span>
                  <span className="text-muted md:text-ink">฿{num(p.amount)}</span>
                  <span className={`text-right font-semibold md:text-left ${statusColor[p.status]}`}>{P.status[p.status]}</span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      <aside className="w-full shrink-0 lg:w-[340px]">
        <div className={`${card} flex flex-col gap-3.5 rounded-[18px] p-6 lg:sticky lg:top-24`}>
          {!live ? (
            <>
              <h2 className="font-display text-xl font-semibold">{P.summary}</h2>
              {pack ? (
                <>
                  <Row label={P.coins} value={num(pack.coins)} />
                  <Row label={P.bonusCoins} value={<span className="text-free">+{num(pack.bonus)}</span>} />
                </>
              ) : plan ? (
                <>
                  <Row label={P.plusTitle} value={P.plusDays(plan.days)} />
                  <Row label={P.bonusCoins} value={<span className="text-free">+{num(plan.coins)}</span>} />
                </>
              ) : null}
              <Row label={P.method} value="QR Code (PromptPay)" />
              <div className="h-px bg-line" />
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-sub">{P.total}</span>
                <span className="font-display text-[20px] font-semibold">{pack ? `${num(pack.coins + pack.bonus)} ${P.coins}` : plan ? plan.name : ""}</span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-sub">{P.toPay}</span>
                <span className="font-display text-[30px] font-bold text-accent-ink">฿{num(price)}</span>
              </div>
              <button onClick={pay} disabled={busy || !props.paymentsEnabled || !product} className="inline-flex h-[52px] cursor-pointer items-center justify-center gap-2 rounded-xl bg-accent text-base font-bold text-on-accent hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40">
                <QrCode size={18} /> {P.createQr}
              </button>
            </>
          ) : (
            <>
              <h2 className="font-display text-xl font-semibold">{P.scanTitle}</h2>
              <div className="self-center">
                {live.qr && (
                  // eslint-disable-next-line @next/next/no-img-element -- gateway QR (data URL or gateway URL)
                  <img src={live.qr} alt="PromptPay QR" width={220} height={220} className="h-[220px] w-[220px] rounded-xl bg-white p-2" />
                )}
              </div>
              <div className="text-center font-display text-[26px] font-bold text-accent-ink">฿{num(live.amount)}</div>
              <div className="text-center text-xs text-muted">{P.payee(live.id)}</div>
              <Countdown until={live.expiresAt} label={P.expiresIn} warn={P.expiredWarn} onExpire={() => router.push(resultUrl(live.id))} />
              <button onClick={saveQr} className="inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-line3 font-semibold hover:bg-field">
                <Download size={16} /> {P.saveQr}
              </button>
              <Link href={resultUrl(live.id)} className="inline-flex h-12 items-center justify-center rounded-xl bg-accent font-bold text-on-accent hover:opacity-90">
                {P.iPaid}
              </Link>
              <button onClick={() => setLive(null)} className="h-10 cursor-pointer text-sm font-semibold text-sub hover:text-ink">
                {P.changePack}
              </button>
              {props.mockPayments && <p className="text-xs text-muted">{P.mockNote}</p>}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between text-sm text-sub">
      <span>{label}</span>
      <span className="text-ink">{value}</span>
    </div>
  );
}
