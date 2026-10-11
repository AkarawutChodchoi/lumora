"use client";

import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_LOCALE, type Locale } from "./config";
import { dictionaries, type Dict } from "./dictionaries";

const LocaleCtx = createContext<Locale>(DEFAULT_LOCALE);

/** Only the locale crosses the server/client boundary; the dictionary (which has functions) is imported here. */
export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleCtx.Provider value={locale}>{children}</LocaleCtx.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleCtx);
}

export function useT(): Dict {
  return dictionaries[useContext(LocaleCtx)];
}
