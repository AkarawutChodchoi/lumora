import Link from "next/link";
import { Badge, PageHeader } from "@/components/ui/misc";
import { ReasonAction } from "@/components/admin/admin-actions";
import { pageStaff } from "@/server/auth/current";
import { listReports } from "@/server/services/admin";
import { getLocale, getT, pageTitle } from "@/i18n/server";
import { INTL_LOCALE } from "@/i18n/config";

export const generateMetadata = pageTitle("adminReports");

const SEV = { critical: "danger", high: "danger", medium: "warn", low: "neutral" } as const;

export default async function AdminReports({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await pageStaff("reports.review");
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  const T = t.admin.reports;
  const status = (await searchParams).status?.slice(0, 20);
  const items = await listReports(status);
  return (
    <div>
      <PageHeader title={T.title} description={T.subtitle} />
      <div className="mb-5 flex flex-wrap gap-1 text-sm">
        {["", "open", "reviewing", "actioned", "dismissed"].map((s) => (
          <Link key={s} href={s ? `/admin/reports?status=${s}` : "/admin/reports"} className={`rounded-lg px-3 py-1.5 ${(status ?? "") === s ? "bg-surface-3" : "text-muted hover:text-fg"}`}>
            {s ? t.enums.reportStatus[s] : T.openReviewing}
          </Link>
        ))}
      </div>
      <ul className="space-y-3">
        {items.map((r) => {
          const snap = (() => {
            try {
              return JSON.parse(r.snapshot) as Record<string, string>;
            } catch {
              return {};
            }
          })();
          return (
            <li key={r.id} className="rounded-2xl border border-line bg-surface p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={SEV[r.severity as keyof typeof SEV] ?? "neutral"}>{t.enums.severity[r.severity]}</Badge>
                <Badge>{t.enums.reportStatus[r.status]}</Badge>
                <span className="text-sm font-semibold">{t.enums.reportCategory[r.category] ?? r.category}</span>
                <span className="text-xs text-faint">{T.on(t.enums.targetType[r.targetType], r.reporter.displayName, r.createdAt.toLocaleString(INTL_LOCALE[locale]))}</span>
              </div>
              {r.details && <p className="mt-2 text-sm">“{r.details}”</p>}
              <div className="mt-3 max-h-48 overflow-auto rounded-xl bg-surface-2 p-3 text-xs whitespace-pre-wrap text-muted">
                {Object.entries(snap).map(([k, v]) => (
                  <p key={k}>
                    <span className="font-semibold text-faint uppercase">{k}:</span> {String(v)}
                  </p>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {r.targetType === "character" && <Link href={`/admin/characters/${r.targetId}`} className="rounded-xl border border-line px-3 py-1.5 text-sm hover:bg-surface-2">{T.openCharacter}</Link>}
                {r.targetType === "user" && <Link href={`/admin/users/${r.targetId}`} className="rounded-xl border border-line px-3 py-1.5 text-sm hover:bg-surface-2">{T.openUser}</Link>}
                {r.status === "open" && <ReasonAction label={T.startReview} reasonKey="note" minReason={0} endpoint={`/api/admin/reports/${r.id}`} body={{ status: "reviewing" }} />}
                <ReasonAction label={T.markActioned} reasonKey="note" endpoint={`/api/admin/reports/${r.id}`} body={{ status: "actioned" }} variant="primary" />
                <ReasonAction label={T.dismiss} reasonKey="note" endpoint={`/api/admin/reports/${r.id}`} body={{ status: "dismissed" }} />
              </div>
              {r.resolutionNote && <p className="mt-2 text-xs text-faint">{T.note} {r.resolutionNote}</p>}
            </li>
          );
        })}
        {items.length === 0 && <p className="py-10 text-center text-sm text-faint">{T.empty}</p>}
      </ul>
    </div>
  );
}
