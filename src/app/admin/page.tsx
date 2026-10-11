import Link from "next/link";
import { Card, PageHeader } from "@/components/ui/misc";
import { SelfTopUp } from "@/components/admin/admin-actions";
import { can } from "@/server/domain/permissions";
import { getBalance } from "@/server/services/credits";
import { pageStaff } from "@/server/auth/current";
import { overview } from "@/server/services/admin";
import { AI_PROVIDER_LABEL, activeAiProvider, paymentsEnabled } from "@/server/config";
import { getLocale, getT, pageTitle } from "@/i18n/server";
import { INTL_LOCALE } from "@/i18n/config";

export const generateMetadata = pageTitle("adminOverview");

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="min-w-0 p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 font-display text-xl font-bold break-all tabular-nums sm:text-2xl">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-faint">{sub}</p>}
    </Card>
  );
}

export default async function AdminOverview({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const actor = await pageStaff("admin.view");
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  const T = t.admin.overview;
  const L = INTL_LOCALE[locale];
  const n = (v: number) => v.toLocaleString(L);
  const raw = Number((await searchParams).days);
  const days = [1, 7, 30, 90].includes(raw) ? raw : 7;
  const o = await overview(days);
  const total = o.generations.completed + o.generations.failed;
  const failRate = total ? ((o.generations.failed / total) * 100).toFixed(1) + "%" : "–";
  return (
    <div>
      <PageHeader
        title={t.titles.adminOverview}
        description={T.window(days, o.since.toLocaleString(L))}
        actions={
          <div className="flex gap-1 rounded-xl border border-line p-1 text-sm">
            {[1, 7, 30, 90].map((d) => (
              <Link key={d} href={`/admin?days=${d}`} className={`rounded-lg px-2.5 py-1 ${d === days ? "bg-surface-3 text-fg" : "text-muted hover:text-fg"}`}>
                {d}d
              </Link>
            ))}
          </div>
        }
      />
      {can(actor.role, "billing.adjust") && (
        <Card className="mb-6 flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="font-semibold">{t.admin.account.selfTopUp}</p>
            <p className="text-xs break-all text-faint">{t.common.coins(n(await getBalance(actor.id)))}</p>
          </div>
          <SelfTopUp selfId={actor.id} />
        </Card>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={T.users} value={n(o.users.total)} sub={T.newInWindow(o.users.new)} />
        <Stat label={T.active} value={n(o.users.active)} sub={T.activeSub} />
        <Stat label={T.messages} value={n(o.userMessages)} sub={T.messagesSub} />
        <Stat label={T.characters} value={n(o.characters.total)} sub={T.publicN(o.characters.public)} />
        <Stat label={T.completed} value={n(o.generations.completed)} sub={T.cancelledN(o.generations.cancelled)} />
        <Stat label={T.failed} value={n(o.generations.failed)} sub={T.failRate(failRate)} />
        <Stat label={T.cost} value={`$${o.estimatedAiCostUsd.toFixed(2)}`} sub={T.costSub} />
        <Stat label={T.revenue} value={new Intl.NumberFormat(L, { style: "currency", currency: "THB" }).format(o.revenue.amountMinor / 100)} sub={T.revenueSub(o.revenue.purchases)} />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_280px]">
        <Card className="overflow-x-auto p-0">
          <h2 className="px-5 pt-5 font-semibold">{T.usageTitle}</h2>
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-xs text-faint">
              <tr>
                <th className="px-5 py-2 font-medium">{T.model}</th>
                <th className="px-3 py-2 text-right font-medium">{T.replies}</th>
                <th className="px-3 py-2 text-right font-medium">{T.inTok}</th>
                <th className="px-3 py-2 text-right font-medium">{T.outTok}</th>
                <th className="px-3 py-2 text-right font-medium">{T.latency}</th>
                <th className="px-5 py-2 text-right font-medium">{T.estCost}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line tabular-nums">
              {o.aiUsage.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-6 text-center text-faint">{T.noUsage}</td>
                </tr>
              )}
              {o.aiUsage.map((m) => (
                <tr key={m.model}>
                  <td className="px-5 py-2.5 font-mono text-xs">{m.model}</td>
                  <td className="px-3 py-2.5 text-right">{n(m.generations)}</td>
                  <td className="px-3 py-2.5 text-right">{n(m.inputTokens)}</td>
                  <td className="px-3 py-2.5 text-right">{n(m.outputTokens)}</td>
                  <td className="px-3 py-2.5 text-right">{(m.avgLatencyMs / 1000).toFixed(1)}s</td>
                  <td className="px-5 py-2.5 text-right">{m.estimatedCostUsd === null ? "n/a" : `$${m.estimatedCostUsd.toFixed(2)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-5 py-3 text-xs text-faint">{T.usageNote}</p>
        </Card>
        <Card className="space-y-3 p-5 text-sm">
          <h2 className="font-semibold">{T.system}</h2>
          <p className="flex justify-between gap-2"><span className="text-muted">{T.provider}</span><span>{activeAiProvider() === "dev" ? T.devProvider : AI_PROVIDER_LABEL[activeAiProvider()]}</span></p>
          <p className="flex justify-between gap-2"><span className="text-muted">{T.payments}</span><span>{paymentsEnabled() ? T.configured : T.notConfigured}</span></p>
          <p className="flex justify-between gap-2"><span className="text-muted">{T.openReports}</span><Link href="/admin/reports" className="text-accent">{o.openReports}</Link></p>
        </Card>
      </div>
    </div>
  );
}
