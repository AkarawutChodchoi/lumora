"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api";
import { ACCENT_SWATCH, ACCENTS, applyDisplayPref, TEXT_SIZES, THEME_SWATCH, THEMES, type DisplayPrefs } from "@/lib/display-prefs";

/**
 * Theme tone + accent colour + text size. Applies instantly (html data-* attributes),
 * remembers it on this device (cookies, so the next page load has no flash) and saves
 * it to the profile so other devices pick it up after sign-in.
 */
export function AppearancePicker({ initial }: { initial: DisplayPrefs }) {
  const t = useT();
  const P = t.profile;
  const [prefs, setPrefs] = useState(initial);

  const set = <K extends keyof DisplayPrefs>(k: K, v: DisplayPrefs[K]) => {
    setPrefs((p) => ({ ...p, [k]: v }));
    applyDisplayPref(k, v);
    // best effort: the device cookie already holds the choice
    api("/api/users/me", { method: "PATCH", body: { prefs: { [k]: v } } }).catch(() => undefined);
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-sm font-medium">{P.theme}</p>
        <div role="radiogroup" aria-label={P.theme} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {THEMES.map((v) => {
            const on = prefs.theme === v;
            const sw = v === "system" ? null : THEME_SWATCH[v];
            return (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => set("theme", v)}
                className={`flex cursor-pointer flex-col gap-2 rounded-xl border-2 p-2.5 text-left text-sm font-semibold ${on ? "border-accent" : "border-line2 hover:border-line3"}`}
              >
                <span
                  className="flex h-12 items-end gap-1 rounded-lg border border-line p-1.5"
                  style={sw ? { background: sw.bg } : { background: `linear-gradient(135deg, ${THEME_SWATCH.dark.bg} 50%, ${THEME_SWATCH.light.bg} 50%)` }}
                  aria-hidden="true"
                >
                  <span className="h-4 flex-1 rounded" style={{ background: sw?.card ?? THEME_SWATCH.dark.card }} />
                  <span className="h-4 w-5 rounded bg-accent" />
                </span>
                <span className="flex items-center justify-between">
                  {P.themes[v]}
                  {on && <Check className="size-4 text-accent-ink" />}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium">{P.accent}</p>
        <div role="radiogroup" aria-label={P.accent} className="flex flex-wrap gap-3">
          {ACCENTS.map((a) => {
            const on = prefs.accent === a;
            return (
              <button
                key={a}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={P.accents[a]}
                title={P.accents[a]}
                onClick={() => set("accent", a)}
                className={`grid size-11 cursor-pointer place-items-center rounded-full ring-offset-2 ring-offset-card ${on ? "ring-2 ring-ink" : "hover:ring-2 hover:ring-line3"}`}
                style={{ background: ACCENT_SWATCH[a] }}
              >
                {on && <Check className="size-5 text-[#111]" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium">{P.textSize}</p>
        <div role="radiogroup" aria-label={P.textSize} className="grid grid-flow-col auto-cols-fr gap-1 rounded-xl border border-line2 bg-field p-1">
          {TEXT_SIZES.map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={prefs.text === v}
              onClick={() => set("text", v)}
              className={`cursor-pointer rounded-lg px-2 py-2 text-sm font-medium transition-colors ${prefs.text === v ? "bg-accent text-on-accent" : "text-muted hover:text-ink"}`}
            >
              {P.textSizes[v]}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-line bg-bg p-4">
        <p className="mb-3 text-xs font-semibold text-muted">{P.preview}</p>
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex h-10 items-center rounded-[10px] bg-accent px-4 text-sm font-bold text-on-accent">Lumora</span>
          <span className="rounded-full bg-accent-deep px-3 py-1 text-xs font-semibold text-accent-ink">#roleplay</span>
          <span className="text-sm text-sub">{P.previewText}</span>
        </div>
      </div>
    </div>
  );
}
