// Display preferences (theme tone, accent colour, text size). Stored in cookies so the
// server renders the right colours on first paint (no flash), and in the user's
// profile (user.prefs) so a new device picks them up after sign-in.
// Safe to import from client and server.

export const THEMES = ["dark", "midnight", "light", "system"] as const;
export const ACCENTS = ["amber", "rose", "violet", "sky", "emerald", "crimson"] as const;
export const TEXT_SIZES = ["small", "normal", "large"] as const;
export type Theme = (typeof THEMES)[number];
export type Accent = (typeof ACCENTS)[number];
export type TextSize = (typeof TEXT_SIZES)[number];

/** Swatch shown in the picker (the real values live in globals.css). */
export const ACCENT_SWATCH: Record<Accent, string> = {
  amber: "#f5a524",
  rose: "#f472b6",
  violet: "#a78bfa",
  sky: "#38bdf8",
  emerald: "#34d399",
  crimson: "#f87171",
};
export const THEME_SWATCH: Record<Exclude<Theme, "system">, { bg: string; card: string }> = {
  dark: { bg: "#0f0f12", card: "#17171c" },
  midnight: { bg: "#0b1020", card: "#121a2e" },
  light: { bg: "#f6f6f8", card: "#ffffff" },
};

export const THEME_COOKIE = "lumora_theme";
export const ACCENT_COOKIE = "lumora_accent";
export const TEXT_COOKIE = "lumora_text";

const COOKIE = { theme: THEME_COOKIE, accent: ACCENT_COOKIE, text: TEXT_COOKIE } as const;
export type DisplayPrefs = { theme: Theme; accent: Accent; text: TextSize };
export const DEFAULT_PREFS: DisplayPrefs = { theme: "dark", accent: "amber", text: "normal" };

const pick = <T extends string>(v: string | undefined, list: readonly T[], d: T): T => (v && (list as readonly string[]).includes(v) ? (v as T) : d);

export function readDisplayPrefs(jar: { get(name: string): { value: string } | undefined }): DisplayPrefs {
  return {
    theme: pick(jar.get(THEME_COOKIE)?.value, THEMES, DEFAULT_PREFS.theme),
    accent: pick(jar.get(ACCENT_COOKIE)?.value, ACCENTS, DEFAULT_PREFS.accent),
    text: pick(jar.get(TEXT_COOKIE)?.value, TEXT_SIZES, DEFAULT_PREFS.text),
  };
}

/** Merge saved profile prefs over cookie prefs (profile wins once signed in). */
export function mergePrefs(cookie: DisplayPrefs, saved: Partial<Record<keyof DisplayPrefs, string>> | null | undefined): DisplayPrefs {
  return {
    theme: pick(saved?.theme, THEMES, cookie.theme),
    accent: pick(saved?.accent, ACCENTS, cookie.accent),
    text: pick(saved?.text, TEXT_SIZES, cookie.text),
  };
}

/** Browser only: save a preference on this device and apply it immediately. */
export function applyDisplayPref(kind: keyof DisplayPrefs, value: string) {
  document.cookie = `${COOKIE[kind]}=${value}; path=/; max-age=31536000; samesite=lax`;
  document.documentElement.dataset[kind] = value;
}
