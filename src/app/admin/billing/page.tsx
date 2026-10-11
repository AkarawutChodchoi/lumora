import Link from "next/link";
import { Badge, Card, PageHeader } from "@/components/ui/misc";
import { pageStaff } from "@/server/auth/current";
import { billingAnomalies, billingSnapshot } from "@/server/services/admin";
import { getLocale, getT, pageTitle } from "@/i18n/server";
import { INTL_LOCALE } from "@/i18n/config";

export const generateMetadata = pageTitle("adminBilling");

export default async function AdminBilling({ searchParams }: { searchParams: Promise<{ userId?: string }> }) {
  await pageStaff("billing.view");
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  const T = t.admin.billing;
  const L = INTL_LOCALE[locale];
  const userId = (await searchParams).userId?.slice(0, 60) || undefined;
  const [snap, anomalies] = await Promise.all([billingSnapshot(userId), billingAnomalies()]);
  return (
    <div className="space-y-6">
      <PageHeader title={t.titles.adminBilling} description={T.subtitle} />
      <form className="flex gap-2" role="search">
        <input name="userId" defaultValue={userId} placeholder={T.filterUser} aria-label={T.filterUser} className="h-10 flex-1 rounded-xl border border-line bg-surface-2 px-3 text-sm" />
        <button className="h-10 rounded-xl bg-accent px-4 text-sm font-semibold text-white">{t.common.filter}</button>
      </form>

      <Card className="p-5">
        <h2 className="mb-3 font-semibold">{T.anomalies}</h2>
        <div className="grid gap-4 text-sm md:grid-cols-3">
          <div>
            <p className="text-xs text-faint">{T.heavy}</p>
            {anomalies.heavyUsageLastHour.length ? anomalies.heavyUsageLastHour.map((h) => <p key={h.userId}><Link className="text-accent" href={`/admin/users/${h.userId}`}>{h.userId}</Link>: {h.charges}</p>) : <p className="text-ok">{t.common.none}</p>}
          </div>
          <div>
            <p className="text-xs text-faint">{T.large}</p>
            {anomalies.largeAdjustments.length ? anomalies.largeAdjustments.map((a) => <p key={a.id}>{a.userId}: {a.delta} · {t.common.by(a.actorId ?? "")}</p>) : <p className="text-ok">{t.common.none}</p>}
          </div>
          <div>
            <p className="text-xs text-faint">{T.inconsistent}</p>
            {anomalies.negativeOrInconsistent.length ? anomalies.negativeOrInconsistent.map((a) => <p key={a.userId} className="text-danger">{a.userId}: {a.balance} / {a.ledgerSum}</p>) : <p className="text-ok">{T.allConsistent}</p>}
          </div>
        </div>
      </Card>

      <Card className="overflow-x-auto p-0">
        <h2 className="px-5 pt-5 font-semibold">{T.ledger}</h2>
        <table className="mt-3 w-full text-sm">
          <thead className="text-left text-xs text-faint">
            <tr><th className="px-5 py-2">{T.when}</th><th className="px-3 py-2">{T.user}</th><th className="px-3 py-2">{T.type}</th><th className="px-3 py-2 text-right">{T.delta}</th><th className="px-3 py-2 text-right">{T.after}</th><th className="px-5 py-2">{T.note}</th></tr>
          </thead>
          <tbody className="divide-y divide-line tabular-nums">
            {snap.ledger.map((l) => (
              <tr key={l.id}>
                <td className="px-5 py-2 text-xs text-faint">{l.createdAt.toLocaleString(L)}</td>
                <td className="px-3 py-2"><Link className="text-accent" href={`/admin/billing?userId=${l.userId}`}>{l.user.displayName}</Link></td>
                <td className="px-3 py-2"><Badge>{t.enums.ledger[l.type] ?? l.type}</Badge></td>
                <td className={`px-3 py-2 text-right ${l.delta > 0 ? "text-ok" : ""}`}>{l.delta > 0 ? "+" : ""}{l.delta}</td>
                <td className="px-3 py-2 text-right">{l.balanceAfter}</td>
                <td className="px-5 py-2 text-xs text-muted">{l.note ?? ""} {l.actorId ? `(${l.actorId})` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5 text-sm">
          <h2 className="mb-3 font-semibold">{T.purchases}</h2>
          {snap.purchases.length === 0 ? <p className="text-faint">{T.noneYet}</p> : snap.purchases.map((p) => (
            <p key={p.id} className="flex justify-between border-b border-line py-1.5 last:border-0"><span>{p.productId} · {p.userId}</span><Badge tone={p.status === "completed" ? "ok" : "warn"}>{p.status}</Badge></p>
          ))}
        </Card>
        <Card className="p-5 text-sm">
          <h2 className="mb-3 font-semibold">{T.subscriptions}</h2>
          {snap.subscriptions.length === 0 ? <p className="text-faint">{T.noneYet}</p> : snap.subscriptions.map((s) => (
            <p key={s.id} className="flex justify-between border-b border-line py-1.5 last:border-0"><span>{s.userId} · {T.until(s.currentPeriodEnd.toLocaleDateString(L))}</span><Badge>{s.status}</Badge></p>
          ))}
        </Card>
        {!userId && (
          <Card className="p-5 text-sm lg:col-span-2">
            <h2 className="mb-3 font-semibold">{T.events}</h2>
            {snap.events.length === 0 ? <p className="text-faint">{T.noEvents}</p> : snap.events.map((e) => (
              <p key={e.id} className="flex justify-between border-b border-line py-1.5 last:border-0"><span className="font-mono text-xs">{e.provider}/{e.eventId} · {e.type}</span><span className="text-xs text-muted">{e.result}</span></p>
            ))}
          </Card>
        )}
      </div>
    </div>
  );
}
