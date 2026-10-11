import Link from "next/link";
import { LayoutDashboard, Users, Drama, Flag, Scale, Wallet, Cpu, ScrollText, ArrowLeft } from "lucide-react";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { pageStaff } from "@/server/auth/current";
import { can, type Permission } from "@/server/domain/permissions";
import { getT } from "@/i18n/server";
import { staffInbox } from "@/server/services/admin";
import { BackButton } from "@/components/layout/back-button";

export const dynamic = "force-dynamic";
export const metadata = { title: { default: "Admin", template: "%s · Lumora Admin" } };

const NAV: { href: string; key: "overview" | "users" | "characters" | "reports" | "appeals" | "billing" | "ai" | "audit"; icon: typeof Users; perm: Permission }[] = [
  { href: "/admin", key: "overview", icon: LayoutDashboard, perm: "admin.view" },
  { href: "/admin/users", key: "users", icon: Users, perm: "users.view" },
  { href: "/admin/characters", key: "characters", icon: Drama, perm: "characters.moderate" },
  { href: "/admin/reports", key: "reports", icon: Flag, perm: "reports.review" },
  { href: "/admin/appeals", key: "appeals", icon: Scale, perm: "appeals.decide" },
  { href: "/admin/billing", key: "billing", icon: Wallet, perm: "billing.view" },
  { href: "/admin/ai", key: "ai", icon: Cpu, perm: "ai.configure" },
  { href: "/admin/audit", key: "audit", icon: ScrollText, perm: "audit.view" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await pageStaff("admin.view");
  const t = await getT();
  const nav = NAV.filter((n) => can(user.role, n.perm));
  const inbox = await staffInbox();
  const badge: Record<string, number> = { reports: inbox.reports, appeals: inbox.appeals };
  return (
    <div className="min-h-dvh md:pl-60">
      <aside className="border-b border-line bg-surface/80 pt-[env(safe-area-inset-top)] md:fixed md:inset-y-0 md:left-0 md:w-60 md:border-r md:border-b-0">
        <div className="flex items-center justify-between gap-2 px-4 py-3 md:py-4">
          <span className="flex min-w-0 items-center gap-1">
            <BackButton fallback="/admin" />
            <span className="font-display font-extrabold">{t.admin.brand}</span>
          </span>
          <Link href="/discover" className="ml-auto shrink-0 rounded-full border border-line px-3 py-1 text-xs text-muted hover:text-fg md:hidden">
            {t.admin.backToApp}
          </Link>
          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent">{t.enums.role[user.role] ?? user.role}</span>
        </div>
        <nav className="scrollbar-thin flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col" aria-label={t.nav.admin}>
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className="flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-muted hover:bg-surface-2 hover:text-fg">
              <n.icon className="size-4" /> {t.admin.nav[n.key]}
              {badge[n.key] ? <span className="ml-auto rounded-full bg-danger px-1.5 text-[11px] font-bold text-white">{badge[n.key]}</span> : null}
            </Link>
          ))}
          <Link href="/discover" className="flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-faint hover:text-fg md:mt-6">
            <ArrowLeft className="size-4" /> {t.admin.backToApp}
          </Link>
        </nav>
        <div className="hidden px-4 pb-4 md:block">
          <LanguageSwitcher compact />
        </div>
      </aside>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
