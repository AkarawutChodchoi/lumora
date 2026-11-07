import Link from "next/link";
import { Bell, Coins, Crown, ShieldAlert } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { MarkAllRead } from "@/components/notifications/mark-all-read";
import { pageUser } from "@/lib/server/access";
import { listNotifications } from "@/lib/server/notify";
import { getLocale, getT } from "@/i18n/server";
import { INTL_LOCALE } from "@/i18n/config";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  return { title: (await getT()).notifications.title };
}

const ICON = { coins: Coins, membership: Crown, safety: ShieldAlert, system: Bell } as const;

export default async function NotificationsPage() {
  const user = await pageUser("/notifications");
  const [t, locale, items] = await Promise.all([getT(), getLocale(), listNotifications(user.id)]);
  const T = t.notifications;
  const unread = items.some((n) => !n.readAt);
  return (
    <div className="mx-auto max-w-2xl animate-fade-in">
      <PageHeader title={T.title} actions={unread ? <MarkAllRead label={T.markAll} /> : undefined} />
      {items.length === 0 ? (
        <EmptyState icon={<Bell className="size-6" />} title={T.empty} description={T.emptySub} />
      ) : (
        <ul className="overflow-hidden rounded-2xl border border-line">
          {items.map((n) => {
            const Icon = ICON[n.kind] ?? Bell;
            return (
              <li key={n.id} className="border-t border-line first:border-t-0">
                <Link href={n.href} className={`flex items-start gap-3 px-4 py-3.5 hover:bg-field ${n.readAt ? "bg-bg" : "bg-card"}`}>
                  <span className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-full ${n.readAt ? "bg-chip text-muted" : "bg-accent-deep text-accent-ink"}`}>
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm leading-relaxed">{n.text}</span>
                    <span className="mt-0.5 block text-xs text-muted">{n.createdAt.toLocaleString(INTL_LOCALE[locale], { dateStyle: "medium", timeStyle: "short" })}</span>
                  </span>
                  {!n.readAt && <span className="mt-1.5 rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-on-accent">{T.new}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
