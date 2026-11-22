// Volumes: stored in litres, shown and typed in P-P (default) or litres.
// Prices are always MMK per litre. The P-P size comes from Settings (owner),
// 215 L until it has loaded.

import { DEFAULT_LITERS_PER_PIPA } from "./pipa-ledger";

export type VolUnit = "pp" | "l";
const UNIT_KEY = "stm_pp_unit";

let ppSize = DEFAULT_LITERS_PER_PIPA;
/** Litres in one P-P, as set by the owner. */
export const ppLiters = () => ppSize;
export function setPPLiters(n: number | null | undefined) {
  if (n && n > 0) ppSize = n;
}

export function readUnit(): VolUnit {
  try { return (localStorage.getItem(UNIT_KEY) ?? localStorage.getItem("stm_po_unit")) === "l" ? "l" : "pp"; } catch { return "pp"; }
}
export function saveUnit(u: VolUnit) {
  try { localStorage.setItem(UNIT_KEY, u); } catch { /* private mode: just this visit */ }
}
export const unitSuffix = (u: VolUnit) => (u === "pp" ? "P-P" : "L");
/** the chosen unit → litres */
export const fromUnit = (v: number, u: VolUnit) => (u === "pp" ? v * ppSize : v);
/** litres → the chosen unit */
export const toUnit = (litres: number, u: VolUnit) => (u === "pp" ? litres / ppSize : litres);
export const fmtTyped = (n: number) => String(Math.round(n * 1000) / 1000);

export function liters(v: number | null | undefined) {
  if (v == null) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(v) + " L";
}
/** A volume (stored in litres) in the chosen unit. */
export function vol(litres: number | null | undefined, u: VolUnit) {
  if (litres == null) return "—";
  if (u === "l") return liters(litres);
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(litres / ppSize) + " P-P";
}
export const mmk = (v: number | null | undefined) =>
  v == null ? "—" : new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(v)) + " MMK";
