"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { useLocale, useT } from "@/i18n/client";
import { INTL_LOCALE } from "@/i18n/config";
import { getPayment, type PaymentView } from "@/lib/server/payments/actions";

/** Mock gateway (local testing only): pretend the customer paid, then the server receives a signed webhook. */
async function mockPay(paymentId: string, outcome: "paid" | "failed" | "expired", extra: { amount?: number } = {}) {
  await fetch("/api/dev/mock-pay", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ paymentId, outcome, ...extra }) });
}

export function PayResult({ initial, testTools }: { initial: PaymentView | null; testTools: boolean }) {
  const t = useT();
  const P = t.pay;
  const L = INTL_LOCALE[useLocale()];
  const router = useRouter();
  const [p, setP] = useState(initial);

  useEffect(() => {
    if (!p || p.status !== "pending") return;
    const id = p.id;
    const timer = setInterval(async () => {
      const next = await getPayment(id).catch(() => null);
      if (next && next.status !== "pending") {
        setP(next);
        router.refresh();
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [p, router]);

  if (!p) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-20 text-center">
        <XCircle size={44} className="text-danger" aria-hidden="true" />
        <h1 className="font-display text-2xl font-bold">{P.notFound}</h1>
        <Link href="/coins" className="inline-flex h-11 items-center rounded-[10px] bg-accent px-5 font-bold text-on-accent">
          {P.backToCoins}
        </Link>
      </div>
    );
  }

  const ok = p.status === "paid";
  const waiting = p.status === "pending" || p.status === "mismatch";
  const Icon = ok ? CheckCircle2 : waiting ? Clock : XCircle;
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-12 text-center" aria-live="polite">
      <span className={`grid size-20 place-items-center rounded-full ${ok ? "bg-free-bg text-free" : waiting ? "bg-accent-soft text-accent-ink" : "bg-danger-bg text-danger"}`}>
        <Icon size={40} aria-hidden="true" />
      </span>
      <h1 className="font-display text-[26px] font-bold">{P.resultTitle[p.status]}</h1>
      {ok && <p className="font-display text-3xl font-bold text-free">{p.kind === "coins" ? P.received((p.coins + p.bonus).toLocaleString(L)) : P.plusOn}</p>}
      <p className="text-sm leading-relaxed text-sub">{P.resultBody[p.status]}</p>
      <dl className="w-full rounded-2xl border border-line bg-card p-4 text-sm">
        <div className="flex justify-between py-1">
          <dt className="text-muted">{P.ref}</dt>
          <dd className="font-mono">{p.id}</dd>
        </div>
        <div className="flex justify-between py-1">
          <dt className="text-muted">{P.colAmount}</dt>
          <dd>฿{p.amount.toLocaleString(L)}</dd>
        </div>
        <div className="flex justify-between py-1">
          <dt className="text-muted">{P.colDate}</dt>
          <dd>{new Date(p.createdAt).toLocaleString(L, { dateStyle: "medium", timeStyle: "short" })}</dd>
        </div>
      </dl>
      <div className="flex w-full flex-col gap-2">
        {ok ? (
          <Link href="/chats" className="inline-flex h-12 items-center justify-center rounded-xl bg-accent font-bold text-on-accent">
            {P.goChat}
          </Link>
        ) : !waiting ? (
          <Link href="/coins" className="inline-flex h-12 items-center justify-center rounded-xl bg-accent font-bold text-on-accent">
            {P.tryAgain}
          </Link>
        ) : null}
        <Link href="/coins" className="inline-flex h-11 items-center justify-center rounded-xl border border-line3 font-semibold hover:bg-field">
          {P.backToCoins}
        </Link>
      </div>
      {testTools && (
        <div className="mt-4 flex w-full flex-wrap justify-center gap-2 rounded-xl border border-dashed border-line2 p-3 text-xs">
          <span className="w-full text-muted">mock gateway (dev only)</span>
          {(["paid", "failed", "expired"] as const).map((o) => (
            <button key={o} className="h-9 cursor-pointer rounded-[9px] border border-line2 bg-field px-3 font-semibold" onClick={() => mockPay(p.id, o)}>
              {o}
            </button>
          ))}
          <button className="h-9 cursor-pointer rounded-[9px] border border-line2 bg-field px-3 font-semibold" onClick={() => mockPay(p.id, "paid", { amount: 100 })}>
            paid (wrong amount)
          </button>
        </div>
      )}
    </div>
  );
}
