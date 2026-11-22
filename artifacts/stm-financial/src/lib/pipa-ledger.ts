// Pipa Ledger — pure logic, no I/O. The station stores fuel in pipas (drums,
// 215 L by default) instead of an underground tank. Stock on hand and every
// station balance are always *calculated* from the movement log.

export const PIPA_STATIONS_TABLE = "pipa_stations";
export const PIPA_MOVEMENTS_TABLE = "pipa_movements";
export const PIPA_DEDUCTIONS_TABLE = "pipa_shift_deductions";

export const DEFAULT_LITERS_PER_PIPA = 215;

export type PipaProduct = "92" | "95" | "PD" | "D";
export const PIPA_PRODUCTS: PipaProduct[] = ["92", "95", "PD", "D"];
export const PRODUCT_LABELS: Record<PipaProduct, string> = {
  "92": "Fuel 92", "95": "Fuel 95", PD: "Premium Diesel", D: "Diesel",
};

export type MovementKind =
  | "buy" | "borrow" | "borrow_returned" | "borrow_paid"
  | "lend" | "lend_returned" | "lend_paid" | "used" | "adjust"
  | "sell"          // sold to another station (money counts as sales)
  | "write_off";    // what was left when a pool was closed (made by the database only)

export type PriceMode = "per_pipa" | "per_liter";

type KindInfo = {
  label: string;          // button / form label
  verb: string;           // history line, e.g. "Borrowed"
  stock: 1 | -1 | 0;      // effect on stock on hand (adjust uses the signed pipa count)
  weOwe: 1 | -1 | 0;      // effect on pipas we owe the station
  theyOwe: 1 | -1 | 0;    // effect on pipas the station owes us
  station: boolean;       // needs a station
  price: boolean;         // needs a price
};

export const KIND_INFO: Record<MovementKind, KindInfo> = {
  buy:             { label: "Buy",                  verb: "Bought",                 stock: 1,  weOwe: 0,  theyOwe: 0,  station: true,  price: true },
  borrow:          { label: "Borrow",               verb: "Borrowed",               stock: 1,  weOwe: 1,  theyOwe: 0,  station: true,  price: false },
  borrow_returned: { label: "Return borrowed",      verb: "Returned (borrowed)",    stock: -1, weOwe: -1, theyOwe: 0,  station: true,  price: false },
  borrow_paid:     { label: "Pay cash for borrowed", verb: "Paid cash instead of returning", stock: 0, weOwe: -1, theyOwe: 0, station: true, price: true },
  lend:            { label: "Lend",                 verb: "Lent",                   stock: -1, weOwe: 0,  theyOwe: 1,  station: true,  price: false },
  lend_returned:   { label: "They returned",        verb: "Got back (lent)",        stock: 1,  weOwe: 0,  theyOwe: -1, station: true,  price: false },
  lend_paid:       { label: "They paid cash",       verb: "They paid cash instead of returning", stock: 0, weOwe: 0, theyOwe: -1, station: true, price: true },
  used:            { label: "Used (not sold)",      verb: "Used (not sold)",            stock: -1, weOwe: 0,  theyOwe: 0,  station: false, price: false },
  adjust:          { label: "Stock count",          verb: "Stock count correction", stock: 1,  weOwe: 0,  theyOwe: 0,  station: false, price: false },
  sell:            { label: "Sell to a station",    verb: "Sold",                   stock: -1, weOwe: 0,  theyOwe: 0,  station: true,  price: true },
  write_off:       { label: "Pool closed",          verb: "Written off",            stock: -1, weOwe: 0,  theyOwe: 0,  station: false, price: false },
};

/** The kinds offered in the "+ Movement" form, in display order. */
export const FORM_KINDS: MovementKind[] = [
  "buy", "sell", "borrow", "lend", "borrow_returned", "lend_returned", "borrow_paid", "lend_paid", "used",
];

export type PipaStation = { id: string; name: string; phone: string | null; note: string | null; created_at: string };

export type PipaMovement = {
  id: string;
  created_at: string;
  occurred_on: string;              // YYYY-MM-DD
  kind: MovementKind;
  station_id: string | null;
  product: PipaProduct;
  pipas: number;                    // > 0, except 'adjust' (signed)
  liters_per_pipa: number;
  price_mode: PriceMode | null;
  unit_price: number | null;
  total_amount: number | null;
  note: string | null;
  shift_batch_id: string | null;
  /** The shift a "sold" line came from (shift deductions only). */
  shift_id?: string | null;
  /** Official purchases typed in litres: the exact litres (pipas is rounded). */
  exact_liters?: number | null;
  source?: "shop" | "official" | null;
  transport_fee?: number | null;   // MMK / litre
  other_fee?: number | null;       // MMK / litre
  created_by?: string | null;
  /** "Pool closed" lines: why (shortage / spill / other). */
  write_off_reason?: "shortage" | "spill" | "other" | null;
  /** Big PO number (official purchases). */
  po_number?: string | null;
};

/** PostgREST returns numeric columns as numbers or strings depending on size — normalise. */
export function normalizeMovement(row: Record<string, unknown>): PipaMovement {
  const num = (v: unknown) => (v == null ? null : Number(v));
  return {
    ...(row as unknown as PipaMovement),
    pipas: Number(row.pipas),
    liters_per_pipa: Number(row.liters_per_pipa ?? DEFAULT_LITERS_PER_PIPA),
    unit_price: num(row.unit_price),
    total_amount: num(row.total_amount),
    exact_liters: num(row.exact_liters),
    transport_fee: num(row.transport_fee),
    other_fee: num(row.other_fee),
  };
}

/** Avoids 2.9999999 creeping into totals built from 3-decimal pipa counts. */
export const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Signed effect of one movement on stock on hand, in pipas. */
export function stockDelta(m: Pick<PipaMovement, "kind" | "pipas">): number {
  return m.kind === "adjust" ? m.pipas : KIND_INFO[m.kind].stock * m.pipas;
}

export type ProductStock = { pipas: number; liters: number };

/** Litres one movement moves (official purchases keep their exact litres). */
export const movementLiters = (m: Pick<PipaMovement, "pipas" | "liters_per_pipa" | "exact_liters">) =>
  m.exact_liters ?? Math.abs(m.pipas) * m.liters_per_pipa;

/** Stock on hand per product: pipas, and litres using each movement's own pipa size. */
export function stockByProduct(movements: PipaMovement[]): Record<PipaProduct, ProductStock> {
  const out = Object.fromEntries(PIPA_PRODUCTS.map(p => [p, { pipas: 0, liters: 0 }])) as Record<PipaProduct, ProductStock>;
  for (const m of movements) {
    const d = stockDelta(m);
    out[m.product].pipas += d;
    out[m.product].liters += Math.sign(d) * movementLiters(m);
  }
  for (const p of PIPA_PRODUCTS) {
    out[p].pipas = round3(out[p].pipas);
    out[p].liters = Math.round(out[p].liters * 100) / 100;
  }
  return out;
}

export type Owing = { weOwe: number; theyOwe: number };
export type StationBalances = Record<string, Partial<Record<PipaProduct, Owing>>>;

/** Pipas we owe each station, and each station owes us, per product. */
export function stationBalances(movements: PipaMovement[]): StationBalances {
  const out: StationBalances = {};
  for (const m of movements) {
    if (!m.station_id) continue;
    const info = KIND_INFO[m.kind];
    if (!info.weOwe && !info.theyOwe) continue;
    const s = (out[m.station_id] ??= {});
    const o = (s[m.product] ??= { weOwe: 0, theyOwe: 0 });
    o.weOwe = round3(o.weOwe + info.weOwe * m.pipas);
    o.theyOwe = round3(o.theyOwe + info.theyOwe * m.pipas);
  }
  return out;
}

/** How many pipas a return/settlement of `kind` may cover right now. Null = no limit applies. */
export function outstandingFor(
  balances: StationBalances, kind: MovementKind, stationId: string | null, product: PipaProduct,
): number | null {
  if (!stationId) return null;
  const o = balances[stationId]?.[product] ?? { weOwe: 0, theyOwe: 0 };
  if (kind === "borrow_returned" || kind === "borrow_paid") return Math.max(0, o.weOwe);
  if (kind === "lend_returned" || kind === "lend_paid") return Math.max(0, o.theyOwe);
  return null;
}

export type PriceBreakdown = { perLiter: number; perPipa: number; total: number; liters: number };

/** Normalises a price entered per pipa or per litre into both, plus the total. */
export function priceBreakdown(mode: PriceMode, unitPrice: number, pipas: number, litersPerPipa: number): PriceBreakdown {
  const perPipa = mode === "per_pipa" ? unitPrice : unitPrice * litersPerPipa;
  const perLiter = mode === "per_liter" ? unitPrice : (litersPerPipa > 0 ? unitPrice / litersPerPipa : 0);
  return {
    perLiter: Math.round(perLiter * 100) / 100,
    perPipa: Math.round(perPipa * 100) / 100,
    total: Math.round(perPipa * pipas * 100) / 100,
    liters: Math.round(pipas * litersPerPipa * 100) / 100,
  };
}

export type StationPrice = {
  stationId: string;
  lastPerLiter: number;
  lastOn: string;
  avgPerLiter: number;  // litre-weighted over every purchase from that station
  liters: number;
};

/** Per product: each station's last and average purchase price per litre, cheapest last price first. */
export function purchasePrices(movements: PipaMovement[]): Partial<Record<PipaProduct, StationPrice[]>> {
  const acc: Record<string, { product: PipaProduct; stationId: string; liters: number; cost: number; lastOn: string; lastAt: string; lastPerLiter: number }> = {};
  for (const m of movements) {
    if (m.kind !== "buy" || !m.station_id || m.unit_price == null || !m.price_mode) continue;
    const b = priceBreakdown(m.price_mode, m.unit_price, m.pipas, m.liters_per_pipa);
    const key = `${m.product}|${m.station_id}`;
    const a = (acc[key] ??= { product: m.product, stationId: m.station_id, liters: 0, cost: 0, lastOn: "", lastAt: "", lastPerLiter: 0 });
    a.liters += b.liters;
    a.cost += b.total;
    const at = `${m.occurred_on}|${m.created_at}`;
    if (at > a.lastAt) { a.lastAt = at; a.lastOn = m.occurred_on; a.lastPerLiter = b.perLiter; }
  }
  const out: Partial<Record<PipaProduct, StationPrice[]>> = {};
  for (const a of Object.values(acc)) {
    (out[a.product] ??= []).push({
      stationId: a.stationId,
      lastPerLiter: a.lastPerLiter,
      lastOn: a.lastOn,
      avgPerLiter: a.liters > 0 ? Math.round((a.cost / a.liters) * 100) / 100 : 0,
      liters: Math.round(a.liters * 100) / 100,
    });
  }
  for (const list of Object.values(out)) list!.sort((x, y) => x.lastPerLiter - y.lastPerLiter);
  return out;
}

/** Today's date in Yangon as YYYY-MM-DD (the station's calendar day). */
export function yangonToday(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Yangon" });
}

export const fmtPipas = (n: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(n);
export const fmtMMK = (n: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(n)) + " MMK";
export const fmtLiters = (n: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n) + " L";
