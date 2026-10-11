import { notFound } from "next/navigation";
import { Badge, Card, PageHeader } from "@/components/ui/misc";
import { pageStaff } from "@/server/auth/current";
import { db } from "@/server/db";
import { getLocale, getT, pageTitle } from "@/i18n/server";
import { INTL_LOCALE } from "@/i18n/config";

export const generateMetadata = pageTitle("adminCharacter");

export default async function AdminCharacter({ params }: { params: Promise<{ id: string }> }) {
  await pageStaff("characters.moderate");
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  const T = t.admin.characters;
  const L = INTL_LOCALE[locale];
  const { id } = await params;
  const c = await db.character.findUnique({ where: { id }, include: { owner: { select: { id: true, displayName: true } }, versions: { orderBy: { version: "desc" } } } });
  if (!c) notFound();
  const [reports, audit] = await Promise.all([
    db.report.findMany({ where: { targetType: "character", targetId: id }, orderBy: { createdAt: "desc" } }),
    db.auditLog.findMany({ where: { targetType: "character", targetId: id }, orderBy: { createdAt: "desc" } }),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader title={c.name} description={`${T.owner(c.owner.displayName, c.owner.id)} · ${t.enums.visibility[c.visibility]} · ${t.enums.publication[c.publicationStatus]}`} />
      <Card className="p-5">
        <h2 className="mb-3 font-semibold">{T.revisions(c.versions.length)}</h2>
        <div className="space-y-3">
          {c.versions.map((v) => {
            const s = JSON.parse(v.snapshot) as Record<string, string>;
            return (
              <details key={v.id} className="rounded-xl border border-line p-3">
                <summary className="cursor-pointer text-sm">
                  <Badge tone={v.version === c.currentVersion ? "accent" : "neutral"}>v{v.version}</Badge> <span className="ml-2 text-faint">{v.createdAt.toLocaleString(L)}</span>
                </summary>
                <dl className="mt-3 space-y-2 text-sm">
                  {Object.entries(s).map(([k, val]) => (
                    <div key={k}>
                      <dt className="text-xs font-semibold text-faint uppercase">{k}</dt>
                      <dd className="whitespace-pre-wrap text-muted">{val || "—"}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            );
          })}
        </div>
      </Card>
      <Card className="p-5">
        <h2 className="mb-3 font-semibold">{T.reportsN(reports.length)}</h2>
        <ul className="divide-y divide-line text-sm">
          {reports.map((r) => (
            <li key={r.id} className="py-2">
              <Badge tone={r.severity === "critical" || r.severity === "high" ? "danger" : "warn"}>{t.enums.severity[r.severity]}</Badge> {t.enums.reportCategory[r.category] ?? r.category} · <Badge>{t.enums.reportStatus[r.status]}</Badge>
              {r.details && <p className="mt-1 text-muted">{r.details}</p>}
            </li>
          ))}
          {reports.length === 0 && <li className="text-faint">{t.common.none}</li>}
        </ul>
      </Card>
      <Card className="p-5">
        <h2 className="mb-3 font-semibold">{T.modHistory}</h2>
        <ul className="divide-y divide-line text-sm">
          {audit.map((a) => (
            <li key={a.id} className="py-2">
              <span className="font-mono text-xs">{a.action}</span> <span className="text-faint">{t.common.by(a.actorId ?? T.system)} · {a.createdAt.toLocaleString(L)}</span>
              <p className="text-muted">{(JSON.parse(a.details) as { reason?: string }).reason}</p>
            </li>
          ))}
          {audit.length === 0 && <li className="text-faint">{t.common.none}</li>}
        </ul>
      </Card>
    </div>
  );
}
