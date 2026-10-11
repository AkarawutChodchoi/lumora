import Link from "next/link";
import { Badge, PageHeader } from "@/components/ui/misc";
import { pageStaff } from "@/server/auth/current";
import { searchUsers } from "@/server/services/admin";
import { USER_STATUSES } from "@/server/domain/enums";
import { getLocale, getT, pageTitle } from "@/i18n/server";
import { INTL_LOCALE } from "@/i18n/config";

export const generateMetadata = pageTitle("adminUsers");

const TONE = { active: "ok", restricted: "warn", suspended: "danger", deletion_requested: "danger" } as const;

export default async function AdminUsers({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  await pageStaff("users.view");
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  const T = t.admin.users;
  const sp = await searchParams;
  const q = sp.q?.slice(0, 100);
  const status = sp.status?.slice(0, 30);
  const users = await searchUsers(q, status);
  return (
    <div>
      <PageHeader title={t.titles.adminUsers} description={T.subtitle} />
      <form className="mb-5 flex flex-wrap gap-2" role="search">
        <input name="q" defaultValue={q} placeholder={T.placeholder} aria-label={t.common.search} className="h-10 min-w-48 flex-1 rounded-xl border border-line bg-surface-2 px-3 text-sm" />
        <select name="status" defaultValue={status ?? ""} aria-label={T.status} className="h-10 rounded-xl border border-line bg-surface-2 px-3 text-sm">
          <option value="">{T.anyStatus}</option>
          {USER_STATUSES.map((s) => (
            <option key={s} value={s}>{t.enums.userStatus[s]}</option>
          ))}
        </select>
        <button className="h-10 rounded-xl bg-accent px-4 text-sm font-semibold text-white">{t.common.search}</button>
      </form>
      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-faint">
            <tr>
              <th className="px-4 py-2.5 font-medium">{T.user}</th>
              <th className="px-4 py-2.5 font-medium">{T.role}</th>
              <th className="px-4 py-2.5 font-medium">{T.status}</th>
              <th className="px-4 py-2.5 font-medium">{T.joined}</th>
              <th className="px-4 py-2.5 font-medium">{T.lastActive}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-surface-2">
                <td className="px-4 py-2.5">
                  <Link href={`/admin/users/${u.id}`} className="font-medium text-accent hover:underline">{u.displayName}</Link>
                  <span className="block text-xs text-faint">{u.email}</span>
                </td>
                <td className="px-4 py-2.5">{t.enums.role[u.role] ?? u.role}</td>
                <td className="px-4 py-2.5"><Badge tone={TONE[u.status as keyof typeof TONE] ?? "neutral"}>{t.enums.userStatus[u.status] ?? u.status}</Badge></td>
                <td className="px-4 py-2.5 text-muted">{u.createdAt.toLocaleDateString(INTL_LOCALE[locale])}</td>
                <td className="px-4 py-2.5 text-muted">{u.lastActiveAt.toLocaleDateString(INTL_LOCALE[locale])}</td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-faint">{T.none}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
