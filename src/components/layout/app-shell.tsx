import Link from "next/link";
import { Compass, Search, PlusCircle, MessageCircle, UserRound, Heart, Coins, ShieldCheck, LayoutDashboard, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { Avatar } from "@/components/ui/misc";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { getT } from "@/i18n/server";
import { NavLink } from "./nav-link";
import { shortNumber } from "@/lib/format";
import { BackButton } from "./back-button";

export interface ShellUser {
  displayName: string;
  avatarUrl: string | null;
  isStaff: boolean;
  balance: number;
  status: string;
  /** Open reports + appeals, shown to staff. */
  staffInbox?: number;
}

export function Logo({ className = "", textClassName = "" }: { className?: string; textClassName?: string }) {
  return (
    <Link href="/" className={`flex items-center gap-2 font-display text-lg font-extrabold tracking-tight ${className}`} aria-label="Lumora">
      <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-accent to-glow shadow-[0_0_24px_-4px_#8b7bff]">
        <Sparkles className="size-4 text-white" />
      </span>
      <span className={textClassName}>Lumora</span>
    </Link>
  );
}

export async function AppShell({ user, devMode, children }: { user: ShellUser | null; devMode: boolean; children: ReactNode }) {
  const t = await getT();
  const primary = [
    { href: "/discover", label: t.nav.discover, icon: Compass },
    { href: "/search", label: t.nav.search, icon: Search },
    { href: "/characters/new", label: t.nav.create, icon: PlusCircle },
    { href: "/chats", label: t.nav.chats, icon: MessageCircle },
    { href: "/profile", label: t.nav.me, icon: UserRound },
  ];
  const secondary = [
    { href: "/library", label: t.nav.library, icon: Heart },
    { href: "/coins", label: t.nav.coins, icon: Coins },
    { href: "/safety", label: t.nav.safety, icon: ShieldCheck },
  ];

  return (
    <div className="min-h-dvh md:pl-64">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-accent focus:px-3 focus:py-2">
        {t.nav.skip}
      </a>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-surface/70 px-4 py-5 backdrop-blur md:flex">
        <Logo className="px-2" />
        <nav className="mt-8 flex flex-col gap-1" aria-label={t.nav.main}>
          {primary.slice(0, 4).map((i) => (
            <NavLink key={i.href} href={i.href} icon={<i.icon className="size-5" />} label={i.label} variant="side" />
          ))}
          <div className="my-3 border-t border-line" />
          {secondary.map((i) => (
            <NavLink key={i.href} href={i.href} icon={<i.icon className="size-5" />} label={i.label} variant="side" />
          ))}
          {user?.isStaff && <NavLink href="/admin" icon={<LayoutDashboard className="size-5" />} label={user.staffInbox ? `${t.nav.admin} (${user.staffInbox})` : t.nav.admin} variant="side" />}
        </nav>
        <div className="mt-auto space-y-3">
          <LanguageSwitcher />
          {user ? (
            <Link href="/profile" className="flex items-center gap-3 rounded-2xl border border-line bg-surface-2 p-3 hover:border-line-strong">
              <Avatar name={user.displayName} src={user.avatarUrl} className="size-9" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{user.displayName}</p>
                <p className="flex items-center gap-1 text-xs text-muted">
                  <Coins className="size-3.5 text-warn" /> {t.common.coins(user.balance.toLocaleString())}
                </p>
              </div>
            </Link>
          ) : (
            <div className="flex flex-col gap-2">
              <Link href="/register" className="rounded-xl bg-accent px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-accent-strong">
                {t.nav.createAccount}
              </Link>
              <Link href="/login" className="rounded-xl px-4 py-2 text-center text-sm text-muted hover:text-fg">
                {t.nav.signIn}
              </Link>
            </div>
          )}
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-20 flex h-[calc(3.5rem+env(safe-area-inset-top))] items-center pt-[env(safe-area-inset-top)] justify-between gap-2 border-b border-line bg-bg/80 px-4 backdrop-blur md:hidden">
        <div className="flex min-w-0 items-center gap-1">
          <BackButton />
          <Logo textClassName="max-[389px]:hidden" />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {user?.isStaff && (
            <Link href={user.staffInbox ? "/admin/reports" : "/admin"} className="relative grid size-9 place-items-center rounded-full border border-line bg-surface-2" aria-label={t.nav.admin}>
              <LayoutDashboard className="size-4 text-accent" />
              {user.staffInbox ? <span className="absolute -top-1 -right-1 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] font-bold text-white">{user.staffInbox}</span> : null}
            </Link>
          )}
          <LanguageSwitcher compact />
          {user ? (
            <Link href="/coins" className="flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface-2 px-3 py-1 text-sm font-semibold tabular-nums" aria-label={`${t.nav.coinBalance}: ${user.balance.toLocaleString()}`}>
              <Coins className="size-4 text-warn" /> {shortNumber(user.balance)}
            </Link>
          ) : (
            <Link href="/login" className="text-sm font-semibold text-accent">
              {t.nav.signIn}
            </Link>
          )}
        </div>
      </header>

      {devMode && (
        <div className="border-b border-warn/30 bg-warn/10 px-4 py-2 text-center text-xs text-warn" role="status">
          {t.nav.devBanner}
        </div>
      )}
      {user?.status === "restricted" && (
        <div className="border-b border-danger/30 bg-danger/10 px-4 py-2 text-center text-xs text-danger" role="status">
          {t.nav.restrictedBanner}{" "}
          <Link className="underline" href="/safety">
            {t.nav.restrictedLink}
          </Link>{" "}
          {t.nav.restrictedSuffix}
        </div>
      )}

      <main id="main" className="mx-auto w-full max-w-6xl px-4 pt-6 pb-28 sm:px-6 md:pb-12">
        <div className="hidden md:block">
          <BackButton className="mb-2" />
        </div>
        {children}
      </main>

      {/* Mobile bottom navigation */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-surface/90 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" aria-label={t.nav.main}>
        {primary.map((i) => (
          <NavLink key={i.href} href={i.href} icon={<i.icon className="size-5" />} label={i.label} variant="bottom" />
        ))}
      </nav>
    </div>
  );
}
