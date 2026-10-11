import { cookies } from "next/headers";
import { cache } from "react";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, type Locale } from "./config";
import { dictionaries, type Dict } from "./dictionaries";

/** The visitor's chosen language (cookie), defaulting to Thai. Memoised per request. */
export const getLocale = cache(async (): Promise<Locale> => {
  const jar = await cookies();
  const v = jar.get(LOCALE_COOKIE)?.value;
  return isLocale(v) ? v : DEFAULT_LOCALE;
});

export async function getT(): Promise<Dict> {
  return dictionaries[await getLocale()];
}

/** `export const generateMetadata = pageTitle("discover")` — localized <title>. */
export function pageTitle(key: keyof Dict["titles"]) {
  return async () => ({ title: (await getT()).titles[key] });
}
