export const LOCALES = ["th", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "th";
export const LOCALE_COOKIE = "lumora_locale";

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v);
}

/** BCP 47 tag for Intl formatting. Thai uses the Buddhist calendar, as Thai readers expect. */
export const INTL_LOCALE: Record<Locale, string> = { th: "th-TH", en: "en-US" };
