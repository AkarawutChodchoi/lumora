"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Bell, Compass, LayoutDashboard, MessageCircle, PlusCircle, Search, UserRound } from "lucide-react";
import { useT } from "@/i18n/client";
import { Avatar } from "@/components/ui/misc";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { applyDisplayPref, ACCENTS, TEXT_SIZES, THEMES } from "@/lib/display-prefs";
import { BackButton } from "./back-button";

export interface ShellUser {
  displayName: string;
  avatarUrl: string | null;
  isStaff: boolean;
  balance: number;
  status: string;
  unread: number;
  /** Open reports + appeals, shown to staff. */
  staffInbox?: number;
  prefs: { theme?: string; accent?: string; text?: string };
}

export function Logo({ size = "md", showText = true }: { size?: "sm" | "md"; showText?: boolean }) {
  const box = size === "sm" ? "h-[30px] w-[30px] text-base" : "h-[34px] w-[34px] text-lg";
  return (
    <span className="flex items-center gap-2">
      <span className={`${box} flex shrink-0 items-center justify-center rounded-lg bg-accent font-display font-bold text-on-accent`}>L</span>
      {showText && <span className={`${size === "sm" ? "text-lg" : "text-[22px]"} font-display font-bold tracking-[.5px]`}>LUMORA</span>}
    </span>
  );
}

export function CoinIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <circle cx="12" cy="12" r="10" fill="#f5a524" />
      <circle cx="12" cy="12" r="5.5" fill="none" stroke="#8a5a00" strokeWidth="2" />
    </svg>
  );
}

type Section = "home" | "search" | "create" | "chats" | "library" | "me" | null;

function useSection(): Section {
  const p = usePathname();
  if (p === "/" || p.startsWith("/discover") || (p.startsWith("/characters/") && !p.startsWith("/characters/new"))) return "home";
  if (p.startsWith("/search")) return "search";
  if (p.startsWith("/characters/new")) return "create";
  if (p.startsWith("/chats")) return "chats";
  if (p.startsWith("/library") || p.startsWith("/memories")) return "library";
  if (p.startsWith("/profile") || p.startsWith("/coins") || p.startsWith("/notifications") || p.startsWith("/safety")) return "me";
  return null;
}

/** After sign-in on a new device, adopt the display preferences saved in the profile. */
function PrefsSync({ prefs }: { prefs: ShellUser["prefs"] }) {
  useEffect(() => {
    const root = document.documentElement;
    const lists = { theme: THEMES, accent: ACCENTS, text: TEXT_SIZES } as const;
    for (const k of ["theme", "accent", "text"] as const) {
      const v = prefs[k];
      if (v && (lists[k] as readonly string[]).includes(v) && root.dataset[k] !== v) applyDisplayPref(k, v);
    }
  }, [prefs]);
  return null;
}

export function SiteHeader({ user }: { user: ShellUser | null }) {
  const t = useT();
  const section = useSection();
  const router = useRouter();
  const [q, setQ] = useState("");
  const nav: { href: string; label: string; s: Section }[] = [
    { href: "/discover", label: t.nav.home, s: "home" },
    { href: "/search", label: t.nav.search, s: "search" },
    { href: "/chats", label: t.nav.myChats, s: "chats" },
    { href: "/library", label: t.nav.library, s: "library" },
    { href: "/characters/new", label: t.nav.create, s: "create" },
  ];
  const submit = (e: FormEvent) => {
    e.preventDefault();
    router.push(`/search?q=${encodeURIComponent(q.trim())}`);
  };
  const balance = user ? user.balance.toLocaleString("en-US") : "";

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/95 pt-[env(safe-area-inset-top)] backdrop-blur">
      {user && <PrefsSync prefs={user.prefs} />}
      {/* desktop */}
      <div className="mx-auto hidden h-[72px] max-w-[1280px] items-center gap-4 px-6 lg:flex xl:gap-6 xl:px-10">
        <Link href="/discover" aria-label="Lumora">
          <Logo />
        </Link>
        <nav aria-label={t.nav.main} className="flex gap-4 whitespace-nowrap text-[15px] text-ink2 xl:gap-5">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} aria-current={section === n.s ? "page" : undefined} className={section === n.s ? "font-semibold text-accent-ink" : "hover:text-ink"}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="flex-1" />
        <form onSubmit={submit} role="search" className="flex h-10 w-[200px] items-center gap-2 rounded-lg border border-line2 bg-field px-3.5 focus-within:border-line3 xl:w-[250px]">
          <Search size={16} className="text-muted" aria-hidden="true" />
          <input
            aria-label={t.nav.search}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t.nav.searchPlaceholder}
            className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-dim focus-visible:outline-none"
          />
        </form>
        {user ? (
          <>
            <Link href="/coins" aria-label={`${t.nav.coinBalance}: ${balance}`} className="flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-line2 bg-field pr-1.5 pl-3 text-sm font-semibold">
              <CoinIcon />
              <span className="min-w-[2ch] tabular-nums">{balance}</span>
              <span className="flex h-7 items-center rounded-full bg-accent px-3 text-[13px] font-bold text-on-accent">{t.nav.topUp}</span>
            </Link>
            {user.isStaff && (
              <Link href={user.staffInbox ? "/admin/reports" : "/admin"} aria-label={t.nav.admin} className="relative flex h-10 w-10 items-center justify-center rounded-full text-ink2 hover:bg-field">
                <LayoutDashboard size={20} />
                {user.staffInbox ? <span className="absolute -top-0.5 -right-0.5 min-w-[18px] rounded-full bg-danger px-1 text-center text-[10px] font-bold text-white">{user.staffInbox}</span> : null}
              </Link>
            )}
            <Link href="/notifications" aria-label={`${t.nav.notifications}${user.unread ? ` (${user.unread})` : ""}`} className="relative flex h-10 w-10 items-center justify-center rounded-full text-ink2 hover:bg-field">
              <Bell size={20} />
              {user.unread > 0 && <span className="absolute top-1.5 right-1.5 h-2.5 w-2.5 rounded-full border-2 border-bg bg-accent" />}
            </Link>
            <Link href="/profile" aria-label={t.nav.me} className="rounded-full">
              <Avatar name={user.displayName} src={user.avatarUrl} className="size-9" />
            </Link>
          </>
        ) : (
          <Link href="/login" className="flex h-10 items-center rounded-[10px] bg-accent px-5 text-sm font-bold text-on-accent">
            {t.nav.signIn}
          </Link>
        )}
      </div>

      {/* mobile */}
      <div className="flex h-14 items-center gap-2 px-4 lg:hidden">
        <BackButton />
        <Link href="/discover" aria-label="Lumora" className="mr-auto">
          <Logo size="sm" showText={false} />
        </Link>
        {user ? (
          <Link href="/coins" aria-label={`${t.nav.coinBalance}: ${balance}`} className="flex h-9 items-center gap-1.5 rounded-full border border-line2 bg-field pr-1 pl-2.5 text-[13px] font-semibold">
            <CoinIcon size={16} />
            <span className="tabular-nums">{balance}</span>
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-base font-bold text-on-accent">+</span>
          </Link>
        ) : (
          <Link href="/login" className="flex h-9 items-center rounded-lg bg-accent px-3.5 text-[13px] font-bold text-on-accent">
            {t.nav.signIn}
          </Link>
        )}
        {user?.isStaff && (
          <Link href={user.staffInbox ? "/admin/reports" : "/admin"} aria-label={t.nav.admin} className="relative flex h-11 w-11 items-center justify-center rounded-full hover:bg-field">
            <LayoutDashboard size={20} />
            {user.staffInbox ? <span className="absolute top-1 right-1 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] font-bold text-white">{user.staffInbox}</span> : null}
          </Link>
        )}
        {user && (
          <Link href="/notifications" aria-label={t.nav.notifications} className="relative flex h-11 w-11 items-center justify-center rounded-full hover:bg-field">
            <Bell size={20} />
            {user.unread > 0 && <span className="absolute top-2.5 right-2.5 h-2.5 w-2.5 rounded-full border-2 border-bg bg-accent" />}
          </Link>
        )}
      </div>
    </header>
  );
}

export function MobileNav() {
  const t = useT();
  const section = useSection();
  const tabs: { href: string; label: string; Icon: typeof Compass; s: Section }[] = [
    { href: "/discover", label: t.nav.home, Icon: Compass, s: "home" },
    { href: "/search", label: t.nav.search, Icon: Search, s: "search" },
    { href: "/characters/new", label: t.nav.create, Icon: PlusCircle, s: "create" },
    { href: "/chats", label: t.nav.chats, Icon: MessageCircle, s: "chats" },
    { href: "/profile", label: t.nav.me, Icon: UserRound, s: "me" },
  ];
  return (
    <nav aria-label={t.nav.main} className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      {tabs.map(({ href, label, Icon, s }) => {
        const on = section === s || (s === "me" && section === "library");
        return (
          <Link key={href} href={href} aria-current={on ? "page" : undefined} className={`flex h-16 flex-col items-center justify-center gap-1 text-[11px] ${on ? "text-accent-ink" : "text-muted"}`}>
            <Icon size={22} aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export function SiteFooter() {
  const t = useT();
  return (
    <footer className="mt-14 border-t border-line pb-24 lg:pb-0">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-4 px-4 py-7 text-[13px] text-muted md:flex-row md:items-center md:justify-between md:px-10">
        <span>© 2026 Lumora AI</span>
        <nav aria-label="footer" className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <Link href="/safety" className="hover:text-ink">
            {t.nav.footerSafety}
          </Link>
          <Link href="/coins" className="hover:text-ink">
            {t.nav.footerCoins}
          </Link>
          <Link href="/terms" className="hover:text-ink">
            {t.nav.terms}
          </Link>
          <Link href="/privacy" className="hover:text-ink">
            {t.nav.privacy}
          </Link>
          <LanguageSwitcher compact />
        </nav>
      </div>
    </footer>
  );
}
