// Per-device display preferences, stored in cookies so the server renders the
// right theme on first paint (no flash). Safe to import from client and server.

export const THEMES = ["dark", "light", "system"] as const;
export const TEXT_SIZES = ["small", "normal", "large"] as const;
export type Theme = (typeof THEMES)[number];
export type TextSize = (typeof TEXT_SIZES)[number];

export const THEME_COOKIE = "lumora_theme";
export const TEXT_COOKIE = "lumora_text";

export function readDisplayPrefs(jar: { get(name: string): { value: string } | undefined }): { theme: Theme; text: TextSize } {
  const theme = jar.get(THEME_COOKIE)?.value as Theme | undefined;
  const text = jar.get(TEXT_COOKIE)?.value as TextSize | undefined;
  return { theme: theme && THEMES.includes(theme) ? theme : "dark", text: text && TEXT_SIZES.includes(text) ? text : "normal" };
}

/** Browser only: save a preference and apply it immediately. */
export function applyDisplayPref(kind: "theme" | "text", value: string) {
  document.cookie = `${kind === "theme" ? THEME_COOKIE : TEXT_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax`;
  document.documentElement.dataset[kind] = value;
}
