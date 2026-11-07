import Link from "next/link";
import { LayoutDashboard, Users, Drama, Flag, Scale, Wallet, Receipt, Cpu, ScrollText, ArrowLeft } from "lucide-react";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { pageStaff } from "@/lib/server/access";
import { can, type Permission } from "@/lib/permissions";
import { getT } from "@/i18n/server";
import { staffInbox } from "@/lib/server/admin";
import { BackButton } from "@/components/layout/back-button";
import { Logo } from "@/components/layout/site-chrome";

export const dynamic = "force-dynamic";
export const metadata = { title: { default: "Admin", template: "%s · Lumora Admin" } };

type Key = "overview" | "users" | "characters" | "reports" | "appeals" | "payments" | "billing" | "ai" | "audit";
const NAV: { href: string; key: Key; icon: typeof Users; perm: Permission }[] = [
  { href: "/admin", key: "overview", icon: LayoutDashboard, perm: "admin.view" },
  { href: "/admin/users", key: "users", icon: Users, perm: "users.view" },
  { href: "/admin/characters", key: "characters", icon: Drama, perm: "characters.moderate" },
  { href: "/admin/reports", key: "reports", icon: Flag, perm: "reports.review" },
  { href: "/admin/appeals", key: "appeals", icon: Scale, perm: "appeals.decide" },
  { href: "/admin/payments", key: "payments", icon: Receipt, perm: "billing.view" },
  { href: "/admin/billing", key: "billing", icon: Wallet, perm: "billing.view" },
  { href: "/admin/ai", key: "ai", icon: Cpu, perm: "ai.configure" },
  { href: "/admin/audit", key: "audit", icon: ScrollText, perm: "audit.view" },
];

/** Alinmanga-style back office: dark sidebar with brand, role chips and permission-filtered menu. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await pageStaff("admin.view");
  const t = await getT();
  const nav = NAV.filter((n) => can(user.roles, n.perm));
  const inbox = can(user.roles, "reports.review") ? await staffInbox() : { reports: 0, appeals: 0 };
  const badge: Record<string, number> = { reports: inbox.reports, appeals: inbox.appeals };
  return (
    <div className="min-h-dvh bg-page md:pl-60">
      <aside className="border-b border-line bg-bg pt-[env(safe-area-inset-top)] md:fixed md:inset-y-0 md:left-0 md:w-60 md:border-r md:border-b-0">
        <div className="flex items-center gap-2 px-4 py-3 md:flex-col md:items-start md:py-5">
          <span className="flex min-w-0 items-center gap-1">
            <BackButton fallback="/admin" />
            <Link href="/admin" aria-label={t.admin.brand}>
              <Logo size="sm" />
            </Link>
          </span>
          <span className="ml-auto flex flex-wrap gap-1 md:ml-0">
            {user.roles
              .filter((r) => r !== "member")
              .map((r) => (
                <span key={r} className="rounded-full bg-accent-deep px-2 py-0.5 text-[11px] font-semibold text-accent-ink">
                  {t.enums.role[r] ?? r}
                </span>
              ))}
          </span>
        </div>
        <nav className="scrollbar-thin flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col" aria-label={t.nav.admin}>
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className="flex shrink-0 items-center gap-2.5 rounded-[10px] px-3 py-2 text-sm text-sub hover:bg-field hover:text-ink">
              <n.icon className="size-4" /> {t.admin.nav[n.key]}
              {badge[n.key] ? <span className="ml-auto rounded-full bg-danger px-1.5 text-[11px] font-bold text-white">{badge[n.key]}</span> : null}
            </Link>
          ))}
          <Link href="/discover" className="flex shrink-0 items-center gap-2.5 rounded-[10px] px-3 py-2 text-sm text-dim hover:text-ink md:mt-6">
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
