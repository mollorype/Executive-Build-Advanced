// STM Financial in English or Myanmar — one setting for the whole app.
//
// The language is chosen in Settings (or with the EN/မြ toggles on the Debt
// Tracker and Salary pages — they share the same setting) and remembered on
// this device. Each screen keeps its own strings next to its code:
//
//   const useT = makeT({ title: { en: "Shifts", my: "ဆိုင်းစာရင်းများ" }, ... });
//   const t = useT();  t("title")
//
// Amounts, dates and names stay as they are; only labels and messages change.

import { useCallback } from "react";
import { setDebtLang, useDebtLang, type DebtLang } from "./debt-i18n";
import type { Role } from "./supabase";

export type Lang = DebtLang;
export type Strings = Record<string, { en: string; my: string }>;

/** The app language (shared with the Debt Tracker / Salary toggles). */
export const useLang = useDebtLang;
export const setLang = setDebtLang;

export function fill(s: string, vars?: Record<string, string | number>): string {
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** A `useT()` hook for one screen's strings. */
export function makeT<D extends Strings>(dict: D) {
  return function useT() {
    const lang = useLang();
    return useCallback((key: keyof D & string, vars?: Record<string, string | number>) => fill(dict[key][lang], vars), [lang]);
  };
}

/** The same strings outside React (e.g. in a confirm() built in a handler). */
export function tr<D extends Strings>(dict: D, lang: Lang, key: keyof D & string, vars?: Record<string, string | number>): string {
  return fill(dict[key][lang], vars);
}

const ROLE: Record<Role, { en: string; my: string }> = {
  ceo: { en: "Owner", my: "ပိုင်ရှင်" },
  accountant: { en: "Accountant", my: "စာရင်းကိုင်" },
  manager: { en: "Manager", my: "မန်နေဂျာ" },
};
export const roleLabel = (role: Role, lang: Lang) => ROLE[role][lang];
