import type { Locale } from "./config";
import { en } from "./en";
import { th } from "./th";

export type Dict = typeof en;
export const dictionaries: Record<Locale, Dict> = { en, th };
