// PO deductions from daily shift sales: what each shift sold of each fuel (and
// for how much), the history the database keeps for every PO, and the profit
// worked out from that history — the price each day actually sold at, not a
// fixed retail price.
//
// The deduction itself happens in the database (record_po_shift_usage), which
// takes the litres off the POs oldest-first and records each piece.

import { supabase, type FuelPurchaseOrder, type Shift } from "./supabase";

export const PO_USAGE_TABLE = "po_usage";
export const PO_DEDUCTED_TABLE = "po_shift_deductions";
export const PO_PRODUCTS = ["92", "95", "PD", "D"] as const;
export type POProduct = (typeof PO_PRODUCTS)[number];
const LITERS_PER_PP = 215;   // same as STM Daily, the P-P Ledger and the FIFO count

export type POUsage = {
  id: string;
  batch_id: string;
  po_id: string;
  shift_id: string | null;
  shift_at: string;
  product: POProduct;
  liters: number;
  stock_used: number;
  amount: number;
  price_per_liter: number;
  created_at: string;
  created_by: string | null;
};

export type UsageSum = { liters: number; amount: number };

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
const num = (v: unknown) => Number(v) || 0;

/**
 * Litres of one fuel a shift sold — pumps, whole P-P sold and J-C — and the
 * money they brought in at that shift's own prices. Litres match the P-P
 * Ledger's count (shiftVolume) so both deduct the same amount.
 */
export function shiftSales(s: Shift, product: POProduct): UsageSum {
  let liters = 0, amount = 0;
  const pump = (l: number | null, total: number | null, price: number | null) => {
    const lit = l && l > 0 ? l : total && price && price > 0 ? total / price : 0;
    liters += lit;
    amount += total && total > 0 ? total : lit * (price ?? 0);
  };
  if (product === "92") pump(s.fuel_92_liters, s.fuel_92_total, s.fuel_92_price);
  if (product === "95") pump(s.fuel_95_liters, s.fuel_95_total, s.fuel_95_price);
  if (product === "PD") pump(s.premium_diesel_liters, s.premium_diesel_total, s.premium_diesel_price);
  if (product === "D" && s.diesel_cash && s.diesel_price && s.diesel_price > 0) {
    liters += s.diesel_cash / s.diesel_price;
    amount += s.diesel_cash;
  }
  for (const p of s.pipa_items ?? []) {
    if (p.product !== product) continue;
    liters += num(p.containers) * LITERS_PER_PP;
    amount += num(p.total) || num(p.containers) * num(p.price);
  }
  for (const j of s.jelly_can_items ?? []) {
    if (j.product !== product) continue;
    liters += num(j.total_liters);
    amount += num(j.total) || num(j.pieces) * num(j.price);
  }
  return { liters: round(liters, 3), amount: round(amount, 2) };
}

/** Rows for record_po_shift_usage: one per shift and fuel sold (a shift with nothing still gets marked). */
export function deductionRows(shifts: Shift[]) {
  const rows: { shift_id: string; product: POProduct; liters: number; amount: number }[] = [];
  for (const s of shifts) {
    const before = rows.length;
    for (const product of PO_PRODUCTS) {
      const { liters, amount } = shiftSales(s, product);
      if (liters > 0) rows.push({ shift_id: s.id, product, liters, amount });
    }
    if (rows.length === before) rows.push({ shift_id: s.id, product: "92", liters: 0, amount: 0 });
  }
  return rows;
}

/** Litres and money recorded per PO (for the profit on cards and rows). */
export async function loadUsageSums(poIds: string[]): Promise<{ sums: Record<string, UsageSum>; missing: boolean }> {
  if (poIds.length === 0) return { sums: {}, missing: false };
  const { data, error } = await supabase.from(PO_USAGE_TABLE).select("po_id, liters, amount").in("po_id", poIds);
  if (error) return { sums: {}, missing: error.code === "PGRST205" || error.code === "42P01" };
  const sums: Record<string, UsageSum> = {};
  for (const r of data ?? []) {
    const s = (sums[r.po_id as string] ??= { liters: 0, amount: 0 });
    s.liters += num(r.liters);
    s.amount += num(r.amount);
  }
  return { sums, missing: false };
}

export async function loadPOUsage(poId: string): Promise<{ rows: POUsage[]; error: string | null }> {
  const { data, error } = await supabase.from(PO_USAGE_TABLE).select("*").eq("po_id", poId).order("shift_at", { ascending: false }).order("created_at", { ascending: false });
  if (error) return { rows: [], error: error.message };
  return {
    rows: (data ?? []).map(r => ({ ...r, liters: num(r.liters), stock_used: num(r.stock_used), amount: num(r.amount), price_per_liter: num(r.price_per_liter) })) as POUsage[],
    error: null,
  };
}

/** The deduction that can be undone for a fuel: the newest one. */
export async function latestBatchFor(product: string): Promise<string | null> {
  const { data } = await supabase.from(PO_USAGE_TABLE).select("batch_id").eq("product", product).order("created_at", { ascending: false }).limit(1);
  return (data?.[0]?.batch_id as string | undefined) ?? null;
}

export type Profit = { revenue: number; wholesale: number; fees: number; shortageCost: number; profit: number; soldNoPrice: number };

/**
 * Profit of a PO once its costs are verified:
 *   money from the litres sold, at each day's price (from the history)
 *   − wholesale × litres sold − fees × (sold + shortage) − wholesale × shortage.
 * Litres sold before the history existed (old FIFO engine) use the old fixed
 * retail price if one was set, else count as unknown (soldNoPrice).
 */
export function poProfit(po: FuelPurchaseOrder, sum?: UsageSum): Profit | null {
  if (!po.is_verified || po.wholesale_price == null || po.transportation_fees == null || po.confidential_fees == null) return null;
  const sold = num(po.total_volume_sold);
  const shortage = num(po.shortage_liters);
  const recorded = Math.min(sold, sum?.liters ?? 0);
  const older = Math.max(0, sold - recorded);
  const revenue = (sum?.amount ?? 0) + (po.retail_price_set ? older * po.retail_price_set : 0);
  const wholesale = sold * po.wholesale_price;
  const fees = (num(po.transportation_fees) + num(po.confidential_fees)) * (sold + shortage);
  const shortageCost = shortage * po.wholesale_price;
  return {
    revenue, wholesale, fees, shortageCost,
    profit: revenue - wholesale - fees - shortageCost,
    soldNoPrice: po.retail_price_set ? 0 : round(older, 3),
  };
}
