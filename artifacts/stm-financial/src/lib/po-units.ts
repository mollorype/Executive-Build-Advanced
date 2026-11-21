// PO volumes: stored in litres, shown and typed in P-P (default) or litres.
// Prices are always MMK per litre.

import { DEFAULT_LITERS_PER_PIPA } from "./pipa-ledger";

export type VolUnit = "pp" | "l";
export const L_PER_PP = DEFAULT_LITERS_PER_PIPA;   // 215 L, as in STM Daily and the P-P Ledger
const UNIT_KEY = "stm_po_unit";

export function readUnit(): VolUnit {
  try { return localStorage.getItem(UNIT_KEY) === "l" ? "l" : "pp"; } catch { return "pp"; }
}
export function saveUnit(u: VolUnit) {
  try { localStorage.setItem(UNIT_KEY, u); } catch { /* private mode: just this visit */ }
}
export const unitSuffix = (u: VolUnit) => (u === "pp" ? "P-P" : "L");
/** the chosen unit → litres */
export const fromUnit = (v: number, u: VolUnit) => (u === "pp" ? v * L_PER_PP : v);
/** litres → the chosen unit */
export const toUnit = (litres: number, u: VolUnit) => (u === "pp" ? litres / L_PER_PP : litres);
export const fmtTyped = (n: number) => String(Math.round(n * 1000) / 1000);

export function liters(v: number | null | undefined) {
  if (v == null) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(v) + " L";
}
/** A volume (stored in litres) in the chosen unit. */
export function vol(litres: number | null | undefined, u: VolUnit) {
  if (litres == null) return "—";
  if (u === "l") return liters(litres);
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(litres / L_PER_PP) + " P-P";
}
export const mmk = (v: number | null | undefined) =>
  v == null ? "—" : new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(v)) + " MMK";
