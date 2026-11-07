import Link from "next/link";
import type { ReactNode } from "react";
import { getT } from "@/i18n/server";
import { MobileNav, SiteFooter, SiteHeader, type ShellUser } from "./site-chrome";

export type { ShellUser };
export { Logo } from "./site-chrome";

/** Alinmanga-style page frame: sticky top header, 1280px content column, footer, phone bottom tabs. */
export async function AppShell({ user, devMode, needs2fa = false, children }: { user: ShellUser | null; devMode: boolean; needs2fa?: boolean; children: ReactNode }) {
  const t = await getT();
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-accent focus:px-3 focus:py-2 focus:text-on-accent">
        {t.nav.skip}
      </a>
      <SiteHeader user={user} />

      {devMode && (
        <div className="border-b border-warn/30 bg-warn-bg px-4 py-2 text-center text-xs text-warn" role="status">
          {t.nav.devBanner}
        </div>
      )}
      {needs2fa && (
        <div className="border-b border-accent-line bg-accent-soft px-4 py-2 text-center text-xs text-accent-ink" role="status">
          {t.nav.staff2fa}{" "}
          <Link className="font-semibold underline" href="/profile#security">
            {t.nav.staff2faLink}
          </Link>
        </div>
      )}
      {user?.status === "restricted" && (
        <div className="border-b border-danger/30 bg-danger-bg px-4 py-2 text-center text-xs text-danger-soft" role="status">
          {t.nav.restrictedBanner}{" "}
          <Link className="underline" href="/safety">
            {t.nav.restrictedLink}
          </Link>{" "}
          {t.nav.restrictedSuffix}
        </div>
      )}

      <main id="main" className="mx-auto w-full max-w-[1280px] flex-1 px-4 pt-5 pb-8 md:px-10 md:pt-8">
        {children}
      </main>
      <SiteFooter />
      <MobileNav />
    </>
  );
}
