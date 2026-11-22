// Fuel stock by purchase: under each fuel, every purchase (Big PO, P-P bought
// from a station, borrowed P-P, stock found in a count) stands on its own and
// is never mixed with another. Sales come off the oldest purchase first.
// Read through pp_pools() (each purchase is its own row there); the price
// comes back for owners only.

import { supabase } from "@/lib/supabase";
import { setPPLiters } from "@/lib/units";
import type { PipaProduct } from "@/lib/pipa-ledger";

export type PoolLot = {
  source: string; on: string; at: string; liters: number; remaining: number; written: number;
  station: string | null;
  /** Has a purchase price (the owner may add it later). */
  priced: boolean;
  // Owners only (null for everyone else):
  movement: string | null;   // the P-P line, to add its price
  price: number | null;      // MMK / L paid
  fees: number | null;       // MMK / L transport + other
  cost: number | null;       // MMK / L price + fees
};
export type Pool = {
  id: string; product: PipaProduct; started_on: string; created_at: string;
  closed_at: string | null; closed_by: string | null; close_reason: "shortage" | "spill" | "other" | null; close_note: string | null;
  lots: PoolLot[];
};
export type PoolSummary = Pool & { cap: number; left: number; written: number };
export type PoolsData = { ppLiters: number; pools: PoolSummary[]; /** Litres sold with no fuel left, per fuel. */ short: Partial<Record<PipaProduct, number>> };

export const OPEN = 0.0005;
const num = (v: unknown) => Number(v) || 0;

/** Purchases from the database, with their totals. */
export function summarize(raw: unknown): PoolsData {
  const d = (raw ?? {}) as { pp_liters?: unknown; short?: Record<string, unknown>; pools?: Record<string, unknown>[] };
  const pools = (d.pools ?? []).map(p => {
    const lots = ((p.lots ?? []) as Record<string, unknown>[]).map(l => ({
      source: String(l.source), on: String(l.on), at: String(l.at ?? ""), liters: num(l.liters), remaining: num(l.remaining), written: num(l.written),
      station: (l.station as string | null) ?? null, priced: l.priced !== false,
      movement: (l.movement as string | null) ?? null,
      price: l.price == null ? null : num(l.price), fees: l.fees == null ? null : num(l.fees),
      cost: l.cost == null ? null : num(l.cost),
    }));
    return {
      id: String(p.id), product: String(p.product) as PipaProduct, started_on: String(p.started_on), created_at: String(p.created_at),
      closed_at: (p.closed_at as string | null) ?? null, closed_by: (p.closed_by as string | null) ?? null,
      close_reason: (p.close_reason as Pool["close_reason"]) ?? null, close_note: (p.close_note as string | null) ?? null,
      lots,
      cap: lots.reduce((s, l) => s + l.liters, 0),
      left: lots.reduce((s, l) => s + l.remaining, 0),
      written: lots.reduce((s, l) => s + l.written, 0),
    };
  });
  const short: PoolsData["short"] = {};
  for (const [k, v] of Object.entries(d.short ?? {})) short[k as PipaProduct] = num(v);
  return { ppLiters: num(d.pp_liters) || 215, pools, short };
}

/** Load the stock by purchase (owners, accountants, managers). */
export async function loadPools(): Promise<{ data: PoolsData | null; error: string | null; code?: string }> {
  const { data, error } = await supabase.rpc("pp_pools", { p_days: 60 });
  if (error) return { data: null, error: error.message, code: error.code };
  const out = summarize(data);
  setPPLiters(out.ppLiters);
  return { data: out, error: null };
}
