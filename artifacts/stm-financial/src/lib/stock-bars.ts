// The owner's stock bars (Profit → P-P stock): one bar per fuel.
//
// The bar is this week's capacity: the latest big official purchase (PO), plus
// every shop purchase / borrowed P-P / other stock that came in after it, plus
// anything from before it that wasn't used up yet ("carried over"). Sales come
// off the oldest stock first, so the used part is on the left and what's left
// is on the right. No official purchase yet → the bar is just the stock still
// on hand, by purchase.

export type BarKind = "carry" | "official" | "shop" | "borrow" | "other";

export type BarLot = {
  id: string;
  product: string;
  source: string;            // pp_lots.source
  occurred_on: string;
  created_at: string;
  liters: number;
  remaining: number;
};

export type BarLine = { lot_id: string; liters: number; occurred_on: string };

export type Segment = { lotId: string; kind: BarKind; capacity: number; remaining: number };

export type FuelBar = {
  product: string;
  since: string | null;      // date of the official purchase the bar starts from
  capacity: number;          // litres
  remaining: number;
  out: number;
  parts: Record<BarKind, number>;   // capacity by kind
  segments: Segment[];
};

const OPEN = 0.0005;
const order = (a: BarLot, b: BarLot) =>
  a.occurred_on.localeCompare(b.occurred_on) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
const kindOf = (source: string): BarKind =>
  source === "official" ? "official" : source === "shop" ? "shop" : source === "borrow" ? "borrow" : "other";

/** Per fuel: the official purchase the bar starts from (null if none yet). */
export function fuelStarts(lots: BarLot[]): Record<string, BarLot | null> {
  const out: Record<string, BarLot | null> = {};
  for (const l of [...lots].sort(order)) {
    if (!(l.product in out)) out[l.product] = null;
    if (l.source === "official") out[l.product] = l;
  }
  return out;
}

/** Lots from before their fuel's start that still hold fuel (need "used since start" litres). */
export function carriedLots(lots: BarLot[]): BarLot[] {
  const starts = fuelStarts(lots);
  return lots.filter(l => {
    const s = starts[l.product];
    return s && l.id !== s.id && order(l, s) < 0 && l.remaining > OPEN;
  });
}

/**
 * The bars. `linesSince` are cost lines of carried-over lots; only litres
 * taken on/after the start date count towards that lot's part of the bar.
 */
export function buildFuelBars(lots: BarLot[], linesSince: BarLine[], products: string[]): FuelBar[] {
  const starts = fuelStarts(lots);
  const bars: FuelBar[] = [];
  for (const product of products) {
    const mine = lots.filter(l => l.product === product).sort(order);
    if (!mine.length) continue;
    const start = starts[product] ?? null;
    const segments: Segment[] = [];
    if (start) {
      for (const l of mine) {
        if (order(l, start) < 0) {
          if (l.remaining <= OPEN) continue;
          const usedSince = linesSince
            .filter(c => c.lot_id === l.id && c.occurred_on >= start.occurred_on)
            .reduce((s, c) => s + c.liters, 0);
          segments.push({ lotId: l.id, kind: "carry", capacity: l.remaining + usedSince, remaining: l.remaining });
        } else {
          segments.push({ lotId: l.id, kind: kindOf(l.source), capacity: l.liters, remaining: l.remaining });
        }
      }
    } else {
      for (const l of mine) if (l.remaining > OPEN) segments.push({ lotId: l.id, kind: kindOf(l.source), capacity: l.liters, remaining: l.remaining });
    }
    if (!segments.length) continue;
    const parts: Record<BarKind, number> = { carry: 0, official: 0, shop: 0, borrow: 0, other: 0 };
    for (const s of segments) parts[s.kind] += s.capacity;
    const capacity = segments.reduce((s, x) => s + x.capacity, 0);
    const remaining = segments.reduce((s, x) => s + x.remaining, 0);
    bars.push({ product, since: start?.occurred_on ?? null, capacity, remaining, out: Math.max(0, capacity - remaining), parts, segments });
  }
  return bars;
}
