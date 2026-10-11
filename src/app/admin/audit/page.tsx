import { PageHeader } from "@/components/ui/misc";
import { pageStaff } from "@/server/auth/current";
import { listAudit } from "@/server/services/admin";
import { getLocale, getT, pageTitle } from "@/i18n/server";
import { INTL_LOCALE } from "@/i18n/config";

export const generateMetadata = pageTitle("adminAudit");

export default async function AdminAudit() {
  await pageStaff("audit.view");
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  const T = t.admin.audit;
  const items = await listAudit(200);
  return (
    <div>
      <PageHeader title={t.titles.adminAudit} description={T.subtitle} />
      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-faint">
            <tr><th className="px-4 py-2">{T.when}</th><th className="px-4 py-2">{T.actor}</th><th className="px-4 py-2">{T.action}</th><th className="px-4 py-2">{T.target}</th><th className="px-4 py-2">{T.details}</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {items.map((a) => (
              <tr key={a.id}>
                <td className="px-4 py-2 text-xs whitespace-nowrap text-faint">{a.createdAt.toLocaleString(INTL_LOCALE[locale])}</td>
                <td className="px-4 py-2 font-mono text-xs">{a.actorId ?? t.admin.characters.system}</td>
                <td className="px-4 py-2 font-mono text-xs">{a.action}</td>
                <td className="px-4 py-2 text-xs">{a.targetType}:{a.targetId}</td>
                <td className="max-w-md truncate px-4 py-2 text-xs text-muted" title={a.details}>{a.details}</td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-faint">{T.empty}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
