"use client";

import { useRouter } from "next/navigation";
import { Languages } from "lucide-react";
import { LOCALE_COOKIE, LOCALES, type Locale } from "@/i18n/config";
import { dictionaries } from "@/i18n/dictionaries";
import { useLocale, useT } from "@/i18n/client";

function saveLocaleCookie(next: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
}

/** Saves the choice in a cookie (1 year) and re-renders server components in the new language. */
export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const locale = useLocale();
  const t = useT();

  function choose(next: Locale) {
    if (next === locale) return;
    saveLocaleCookie(next);
    router.refresh();
  }

  return (
    <div className="inline-flex items-center gap-1 rounded-[10px] border border-line2 bg-field p-1" role="group" aria-label={t.common.language}>
      {!compact && <Languages className="mx-1 size-4 text-faint" aria-hidden="true" />}
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => choose(l)}
          aria-pressed={l === locale}
          lang={l}
          className={`cursor-pointer rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${l === locale ? "bg-accent text-on-accent" : "text-muted hover:text-fg"}`}
        >
          {compact ? l.toUpperCase() : dictionaries[l].langName}
        </button>
      ))}
    </div>
  );
}
