"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Card } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useLocale, useT } from "@/i18n/client";
import { INTL_LOCALE } from "@/i18n/config";
import { adminRecheckPayment, type AdminPaymentRow } from "@/lib/server/payments/actions";

type Data = { rows: AdminPaymentRow[]; revenue: { day: string; thb: number; count: number }[]; webhooks: { at: number; event: string; ok: boolean; result: string | null }[] };
const TONE: Record<string, "ok" | "warn" | "danger" | "neutral" | "accent"> = { paid: "ok", pending: "accent", failed: "danger", expired: "neutral", mismatch: "warn", refunded: "neutral" };

export function PaymentsTable({ data, status, q, statuses, canRecheck }: { data: Data; status: string; q: string; statuses: string[]; canRecheck: boolean }) {
  const t = useT();
  const T = t.admin.payments;
  const L = INTL_LOCALE[useLocale()];
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const when = (ms: number) => new Date(ms).toLocaleString(L, { dateStyle: "short", timeStyle: "short" });
  const label = (s: string) => (s === "all" ? T.all : (t.pay.status as Record<string, string>)[s] ?? s);

  async function recheck(id: string) {
    setBusy(id);
    const r = await adminRecheckPayment(id).catch(() => null);
    setBusy(null);
    if (!r || !r.ok) return toast.error(r && !r.ok ? r.error : t.common.genericError);
    toast.success(T.rechecked(r.result));
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <form className="flex flex-wrap gap-2" role="search">
        <input name="q" defaultValue={q} placeholder={T.search} aria-label={T.search} className="h-10 min-w-48 flex-1 rounded-[10px] border border-line2 bg-field px-3 text-sm" />
        <select name="status" defaultValue={status} aria-label={T.status} className="h-10 rounded-[10px] border border-line2 bg-field px-3 text-sm">
          {statuses.map((s) => (
            <option key={s} value={s}>
              {label(s)}
            </option>
          ))}
        </select>
        <button className="h-10 cursor-pointer rounded-[10px] bg-accent px-4 text-sm font-bold text-on-accent">{t.common.search}</button>
      </form>

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-faint">
            <tr>
              <th className="px-4 py-3">{T.id}</th>
              <th className="px-4 py-3">{T.user}</th>
              <th className="px-4 py-3">{T.item}</th>
              <th className="px-4 py-3 text-right">{T.amount}</th>
              <th className="px-4 py-3">{T.status}</th>
              <th className="px-4 py-3">{T.created}</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data.rows.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">
                  {p.id}
                  <span className="block text-faint">
                    {p.gateway}
                    {p.chargeId ? ` · ${p.chargeId}` : ""}
                  </span>
                </td>
                <td className="px-4 py-3">{p.user}</td>
                <td className="px-4 py-3 whitespace-nowrap">{p.kind === "coins" ? `${p.coins + p.bonus} ${t.pay.coins}` : p.product}</td>
                <td className="px-4 py-3 text-right tabular-nums">฿{p.thb.toLocaleString(L)}</td>
                <td className="px-4 py-3">
                  <Badge tone={TONE[p.status] ?? "neutral"}>{label(p.status)}</Badge>
                  {p.reason && <span className="mt-1 block max-w-56 truncate text-xs text-faint" title={p.reason}>{p.reason}</span>}
                </td>
                <td className="px-4 py-3 text-xs whitespace-nowrap text-muted">{when(p.at)}</td>
                <td className="px-4 py-3">
                  {canRecheck && p.chargeId && p.status !== "paid" && (
                    <Button size="sm" variant="secondary" loading={busy === p.id} onClick={() => recheck(p.id)}>
                      {T.recheck}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {data.rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-faint">
                  {T.none}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5 text-sm">
          <h2 className="mb-3 font-display font-semibold">{T.revenue}</h2>
          {data.revenue.length === 0 ? (
            <p className="text-faint">{T.noRevenue}</p>
          ) : (
            data.revenue.map((r) => (
              <p key={r.day} className="flex justify-between border-b border-line py-1.5 tabular-nums last:border-0">
                <span>{r.day}</span>
                <span>
                  ฿{r.thb.toLocaleString(L)} <span className="text-faint">({r.count})</span>
                </span>
              </p>
            ))
          )}
        </Card>
        <Card className="p-5 text-sm">
          <h2 className="mb-3 font-display font-semibold">{T.webhooks}</h2>
          {data.webhooks.length === 0 ? (
            <p className="text-faint">{T.noWebhooks}</p>
          ) : (
            data.webhooks.map((w, i) => (
              <p key={i} className="flex justify-between gap-3 border-b border-line py-1.5 last:border-0">
                <span className="min-w-0 truncate font-mono text-xs">{w.event}</span>
                <span className={`shrink-0 text-xs ${w.ok ? "text-muted" : "text-danger"}`}>{w.ok ? w.result ?? "…" : T.sigBad}</span>
              </p>
            ))
          )}
          <p className="mt-3 text-xs text-faint">
            <Link href="/admin/billing" className="text-accent-ink">
              {t.admin.nav.billing} ›
            </Link>
          </p>
        </Card>
      </div>
    </div>
  );
}
