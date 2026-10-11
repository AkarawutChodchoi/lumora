import { Badge, PageHeader } from "@/components/ui/misc";
import { ReasonAction } from "@/components/admin/admin-actions";
import { pageStaff } from "@/server/auth/current";
import { listAppeals } from "@/server/services/admin";
import { getLocale, getT, pageTitle } from "@/i18n/server";
import { INTL_LOCALE } from "@/i18n/config";

export const generateMetadata = pageTitle("adminAppeals");

export default async function AdminAppeals() {
  await pageStaff("appeals.decide");
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  const T = t.admin.appeals;
  const items = await listAppeals();
  return (
    <div>
      <PageHeader title={t.titles.adminAppeals} description={T.subtitle} />
      <ul className="space-y-3">
        {items.map((a) => (
          <li key={a.id} className="rounded-2xl border border-line bg-surface p-4 text-sm">
            <p>
              <span className="font-semibold">{a.user.displayName}</span> {T.appeals} <Badge>{t.enums.enforcement[a.enforcement.action] ?? a.enforcement.action}</Badge>
              <span className="ml-2 text-xs text-faint">{a.createdAt.toLocaleString(INTL_LOCALE[locale])}</span>
            </p>
            <p className="mt-1 text-xs text-faint">{T.original} {a.enforcement.reason}</p>
            <p className="mt-2 rounded-xl bg-surface-2 p-3">{a.message}</p>
            <div className="mt-3 flex gap-1.5">
              <ReasonAction label={T.accept} variant="primary" reasonKey="note" endpoint={`/api/admin/appeals/${a.id}`} body={{ decision: "accepted" }} />
              <ReasonAction label={T.reject} variant="danger" reasonKey="note" endpoint={`/api/admin/appeals/${a.id}`} body={{ decision: "rejected" }} />
            </div>
          </li>
        ))}
        {items.length === 0 && <p className="py-10 text-center text-sm text-faint">{T.empty}</p>}
      </ul>
    </div>
  );
}
