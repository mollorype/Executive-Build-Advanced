// Fuel pools (one per fuel): a Big PO starts one, later stock joins it, sales
// come off the oldest fuel first. Read through pp_pools(); the cost per litre
// comes back for owners only.

import { supabase } from "@/lib/supabase";
import { setPPLiters } from "@/lib/units";
import type { PipaProduct } from "@/lib/pipa-ledger";

export type PoolLot = {
  source: string; on: string; liters: number; remaining: number; written: number;
  station: string | null;
  /** Has a purchase price (a Big PO may wait for the owner's price). */
  priced: boolean;
  // Owners only (null for everyone else):
  movement: string | null;   // the P-P line, to enter a Big PO price
  price: number | null;      // MMK / L paid
  fees: number | null;       // MMK / L transport + other
  cost: number | null;       // MMK / L price + fees
  sold: number | null;       // litres sold from it
  revenue: number | null;    // money those sales brought in
  cogs: number | null;       // what they cost (null while unpriced)
};
export type Pool = {
  id: string; product: PipaProduct; started_on: string; created_at: string;
  closed_at: string | null; closed_by: string | null; close_reason: "shortage" | "spill" | "other" | null; close_note: string | null;
  lots: PoolLot[];
};
export type PoolSummary = Pool & { cap: number; left: number; written: number; out: number; short: number; newest: boolean };
export type PoolsData = { ppLiters: number; pools: PoolSummary[] };

export const OPEN = 0.0005;

/** A Big PO is known by its date: "Nov 22". */
export const poDate = (on: string) =>
  new Date(`${on.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const num = (v: unknown) => Number(v) || 0;

/** Pools from the database, with their totals; a fuel's shortage is shown on its newest pool. */
export function summarize(raw: unknown): PoolsData {
  const d = (raw ?? {}) as { pp_liters?: unknown; short?: Record<string, unknown>; pools?: Record<string, unknown>[] };
  const seen = new Set<string>();
  const pools = (d.pools ?? []).map(p => {
    const lots = ((p.lots ?? []) as Record<string, unknown>[]).map(l => ({
      source: String(l.source), on: String(l.on), liters: num(l.liters), remaining: num(l.remaining), written: num(l.written),
      station: (l.station as string | null) ?? null, priced: l.priced !== false,
      movement: (l.movement as string | null) ?? null,
      price: l.price == null ? null : num(l.price), fees: l.fees == null ? null : num(l.fees),
      cost: l.cost == null ? null : num(l.cost), sold: l.sold == null ? null : num(l.sold),
      revenue: l.revenue == null ? null : num(l.revenue), cogs: l.cogs == null ? null : num(l.cogs),
    }));
    const cap = lots.reduce((s, l) => s + l.liters, 0);
    const left = lots.reduce((s, l) => s + l.remaining, 0);
    const written = lots.reduce((s, l) => s + l.written, 0);
    const product = String(p.product) as PipaProduct;
    const newest = !seen.has(product);          // listed newest first per fuel
    seen.add(product);
    return {
      id: String(p.id), product, started_on: String(p.started_on), created_at: String(p.created_at),
      closed_at: (p.closed_at as string | null) ?? null, closed_by: (p.closed_by as string | null) ?? null,
      close_reason: (p.close_reason as Pool["close_reason"]) ?? null, close_note: (p.close_note as string | null) ?? null,
      lots, cap, left, written, out: Math.max(0, cap - left - written),
      short: newest ? num(d.short?.[product]) : 0, newest,
    };
  });
  return { ppLiters: num(d.pp_liters) || 215, pools };
}

/** Load the pools (owners, accountants, managers). */
export async function loadPools(): Promise<{ data: PoolsData | null; error: string | null; code?: string }> {
  const { data, error } = await supabase.rpc("pp_pools", { p_days: 60 });
  if (error) return { data: null, error: error.message, code: error.code };
  const out = summarize(data);
  setPPLiters(out.ppLiters);
  return { data: out, error: null };
}
