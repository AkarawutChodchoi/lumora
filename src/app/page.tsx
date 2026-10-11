import { redirect } from "next/navigation";
import { Brain, Feather, ShieldCheck, Sparkles, Wand2, MessagesSquare } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Logo } from "@/components/layout/app-shell";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { currentUser } from "@/server/auth/current";
import { getT } from "@/i18n/server";

export const dynamic = "force-dynamic";

const ICONS = [MessagesSquare, Brain, Wand2, Feather, ShieldCheck, Sparkles];

export default async function Landing() {
  if (await currentUser()) redirect("/discover");
  const t = await getT();
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-5">
        <Logo />
        <nav className="flex items-center gap-2">
          <LanguageSwitcher compact />
          <ButtonLink href="/discover" variant="ghost" size="sm" className="hidden sm:inline-flex">
            {t.landing.explore}
          </ButtonLink>
          <ButtonLink href="/login" variant="secondary" size="sm">
            {t.nav.signIn}
          </ButtonLink>
        </nav>
      </header>

      <main>
        <section className="mx-auto max-w-4xl px-5 pt-14 pb-20 text-center sm:pt-24">
          <p className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-line bg-surface/60 px-3 py-1 text-xs text-muted">
            <span className="size-1.5 rounded-full bg-accent" /> {t.landing.badge}
          </p>
          <h1 className="font-display text-4xl leading-[1.15] font-extrabold tracking-tight text-balance sm:text-6xl">
            {t.landing.titleA} <span className="bg-gradient-to-r from-accent via-glow to-accent bg-clip-text text-transparent">{t.landing.titleB}</span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base text-pretty text-muted sm:text-lg">{t.landing.subtitle}</p>
          <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
            <ButtonLink href="/register" size="lg">
              {t.landing.start}
            </ButtonLink>
            <ButtonLink href="/discover" variant="secondary" size="lg">
              {t.landing.browse}
            </ButtonLink>
          </div>
          <p className="mt-4 text-xs text-faint">{t.landing.fine}</p>
        </section>

        <section className="mx-auto grid max-w-6xl gap-4 px-5 pb-24 sm:grid-cols-2 lg:grid-cols-3" aria-label={t.landing.featuresLabel}>
          {t.landing.features.map((f, i) => {
            const Icon = ICONS[i];
            return (
              <div key={f.title} className="rounded-[var(--radius-card)] border border-line bg-surface/70 p-6">
                <div className="mb-4 grid size-10 place-items-center rounded-xl bg-accent-soft text-accent">
                  <Icon className="size-5" />
                </div>
                <h2 className="font-semibold">{f.title}</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{f.body}</p>
              </div>
            );
          })}
        </section>
      </main>

      <footer className="border-t border-line px-5 py-8 text-center text-xs text-faint">{t.landing.footer}</footer>
    </div>
  );
}
