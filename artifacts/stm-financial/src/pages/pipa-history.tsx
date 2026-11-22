import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { supabase } from "@/lib/supabase";
import {
  PIPA_PRODUCTS, PIPA_STATIONS_TABLE,
  fmtLiters, fmtMMK, fmtPipas, movementLiters, normalizeMovement, priceBreakdown, round3, stockDelta,
  type PipaMovement, type PipaProduct, type PipaStation,
} from "@/lib/pipa-ledger";
import { useAuth } from "@/lib/auth-context";
import { usePipaT, pipaProduct, type PipaT } from "@/lib/pipa-i18n";
import { reasonDialog } from "@/components/confirm-dialog";
import { AlertTriangle, ArrowLeft, ChevronDown, Loader2, Trash2, Undo2, X } from "lucide-react";

/** A history row: one P-P line, or one shift's "sold" lines together. */
type Item =
  | { type: "line"; m: PipaMovement }
  | { type: "shift"; key: string; shiftId: string | null; name: string; on: string; lines: PipaMovement[]; by: string | null };

/** What the lines inside a fuel's card can be narrowed to. */
type Cat = "all" | "buy" | "shift" | "other";
const CATS: Cat[] = ["all", "buy", "shift", "other"];
const catOf = (item: Item): Exclude<Cat, "all"> => (item.type === "shift" ? "shift" : item.m.kind === "buy" ? "buy" : "other");

/** One colour per fuel, so a card and its lines are easy to tell apart. */
const FUEL_DOT: Record<PipaProduct, string> = { "92": "bg-blue-500", "95": "bg-violet-500", PD: "bg-amber-500", D: "bg-teal-500" };
const PAGE = 15;

/** History title for one movement (used in the delete dialog). */
function describe(m: PipaMovement, station: string, t: PipaT): { title: string; detail: string } {
  const qty = `${fmtPipas(Math.abs(m.pipas))} P-P · ${pipaProduct(t, m.product)}`;
  const price = m.price_mode && m.unit_price != null
    ? (() => {
        const b = priceBreakdown(m.price_mode, m.unit_price, m.pipas, m.liters_per_pipa);
        return t("h_price", { perPipa: fmtMMK(b.perPipa), perLiter: fmtMMK(b.perLiter), total: fmtMMK(m.total_amount ?? b.total) });
      })()
    : "";
  const withPrice = (d: string) => (price ? `${d} · ${price}` : d);
  switch (m.kind) {
    case "buy": {
      if (m.source === "official") {
        const fees = (m.transport_fee ?? 0) + (m.other_fee ?? 0);
        const extra = m.unit_price != null ? ` · ${t("h_fees", { fees: fmtMMK(fees), cost: fmtMMK(m.unit_price + fees) })}` : "";
        return { title: t("h_official", { qty: m.exact_liters ? `${fmtLiters(m.exact_liters)} · ${pipaProduct(t, m.product)}` : qty }), detail: withPrice(t("h_buy_d", { station })) + extra };
      }
      return { title: t("h_buy", { qty }), detail: withPrice(t("h_buy_d", { station })) };
    }
    case "borrow":          return { title: t("h_borrow", { qty }), detail: t("h_borrow_d", { station }) };
    case "borrow_returned": return { title: t("h_borrow_returned", { qty }), detail: t("h_borrow_returned_d", { station }) };
    case "borrow_paid":     return { title: t("h_borrow_paid", { qty }), detail: withPrice(t("h_borrow_paid_d", { station })) };
    case "lend":            return { title: t("h_lend", { qty }), detail: t("h_lend_d", { station }) };
    case "lend_returned":   return { title: t("h_lend_returned", { qty }), detail: t("h_lend_returned_d", { station }) };
    case "lend_paid":       return { title: t("h_lend_paid", { station, qty }), detail: withPrice(t("h_lend_paid_d")) };
    case "used":            return { title: t("h_used", { qty }), detail: "" };
    case "sell":            return { title: t("h_sell", { qty }), detail: withPrice(t("h_sell_d", { station })) };
    case "write_off":       return { title: t("h_write_off", { qty }), detail: m.write_off_reason ? t(`r_${m.write_off_reason}`) : "" };
    case "adjust":
      return m.pipas > 0 && m.unit_price != null
        ? { title: t("h_opening", { qty: `+${qty}` }), detail: price }
        : { title: t("h_adjust", { qty: `${m.pipas > 0 ? "+" : "−"}${qty}` }), detail: "" };
  }
}

/** Money of a purchase: what was paid including fees, and that per litre. Null when prices are hidden. */
function purchaseCost(m: PipaMovement): { spent: number; liters: number; perL: number; price: number; fees: number; perPipa: number } | null {
  if (m.kind !== "buy" || m.unit_price == null || !m.price_mode) return null;
  const b = priceBreakdown(m.price_mode, m.unit_price, m.pipas, m.liters_per_pipa);
  const liters = movementLiters(m);
  const fees = m.source === "official" ? (m.transport_fee ?? 0) + (m.other_fee ?? 0) : 0;
  const spent = (m.total_amount ?? b.total) + fees * liters;
  return { spent, liters, perL: liters > 0 ? spent / liters : 0, price: b.perLiter, fees, perPipa: b.perPipa };
}

/** Short coloured label for a line; shortages are red because they need a look. */
function badge(m: PipaMovement, t: PipaT): { label: string; cls: string } {
  switch (m.kind) {
    case "buy": return m.source === "official"
      ? { label: t("b_official"), cls: "bg-emerald-100 text-emerald-800" }
      : { label: t("b_shop"), cls: "bg-yellow-100 text-yellow-800" };
    case "borrow": case "borrow_returned": case "borrow_paid":
      return { label: t(`b_${m.kind}`), cls: "bg-orange-100 text-orange-800" };
    case "lend": case "lend_returned": case "lend_paid":
      return { label: t(`b_${m.kind}`), cls: "bg-sky-100 text-sky-800" };
    case "used": return { label: t("b_used"), cls: "bg-slate-100 text-slate-700" };
    case "sell": return { label: t("b_sell"), cls: "bg-indigo-100 text-indigo-800" };
    case "write_off": return { label: `${t("b_write_off")}${m.write_off_reason ? ` · ${t(`r_${m.write_off_reason}`)}` : ""}`, cls: "bg-red-600 text-white" };
    case "adjust":
      if (m.pipas > 0 && m.unit_price != null) return { label: t("b_opening"), cls: "bg-green-100 text-green-800" };
      return m.pipas > 0 ? { label: t("b_gain"), cls: "bg-green-100 text-green-800" } : { label: t("b_loss"), cls: "bg-red-600 text-white" };
  }
}

/** Shift "sold" lines carry the employee's name in their note: "Shift sales: 300 L · Ma Hla". */
const shiftName = (m: PipaMovement) => /·\s*(.+)$/.exec(m.note ?? "")?.[1]?.trim() || "—";
const perL = (n: number) => `${fmtMMK(n)}/L`;
/** "+12", "−3.5", or just "0" when nothing moved. */
const signed = (n: number, sign: "+" | "−") => (n > 0.0005 ? `${sign}${fmtPipas(round3(n))}` : "0");

/** In / out box on a fuel card; grey when nothing moved that way. */
function Stat({ label, pp, liters, sign }: { label: string; pp: number; liters: number; sign: "+" | "−" }) {
  const tone = pp <= 0.0005 ? "bg-slate-50 text-slate-400" : sign === "+" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-pale-red-foreground";
  return (
    <div className={`rounded-lg px-3 py-2 ${tone}`}>
      <p className="text-[11px] font-semibold">{label}</p>
      <p className="text-lg font-bold tabular-nums leading-tight">{signed(pp, sign)} <span className="text-xs">P-P</span></p>
      <p className="text-[11px] opacity-70 tabular-nums">{fmtLiters(liters)}</p>
    </div>
  );
}

type Group = {
  product: PipaProduct;
  items: Item[];
  counts: Record<Cat, number>;
  inPP: number; outPP: number; inL: number; outL: number;
  spent: number;
  /** Big PO and shop purchases are never mixed into one price. */
  src: Record<"official" | "shop", { buys: number; spent: number; last: { perL: number; on: string; at: string } | null }>;
};

/**
 * Every P-P line, newest first, with delete / undo (a reason is always asked).
 * Grouped by fuel: a total card per fuel, tap it to see that fuel's lines.
 * Used on its own page (accountants, managers) and inside the owner's Profit page.
 */
export function PipaHistoryList({ embedded = false }: { embedded?: boolean }) {
  const t = usePipaT();
  const { profile } = useAuth();
  const owner = profile?.role === "ceo";
  const [, setLocation] = useLocation();
  const search = useSearch();
  // On its own page the station filter lives in the address (?station=); inside Profit, just here.
  const [localStation, setLocalStation] = useState("");
  const stationFilter = embedded ? localStation : new URLSearchParams(search).get("station") ?? "";
  const filterBy = (id: string) => (embedded ? setLocalStation(id) : setLocation(id ? `/pipa-ledger/history?station=${id}` : "/pipa-ledger/history"));
  const [stations, setStations] = useState<PipaStation[]>([]);
  const [movements, setMovements] = useState<PipaMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [open, setOpen] = useState<Partial<Record<PipaProduct, boolean>>>({});
  const [cat, setCat] = useState<Partial<Record<PipaProduct, Cat>>>({});
  const [shown, setShown] = useState<Partial<Record<PipaProduct, number>>>({});
  const [notice, setNoticeText] = useState("");
  const noticeTimer = useRef<number | undefined>(undefined);
  // A success message fades after 3 s; an error stays. A newer one replaces an older one.
  const setNotice = useCallback((message: string, fade = false) => {
    window.clearTimeout(noticeTimer.current);
    setNoticeText(message);
    if (fade && message) noticeTimer.current = window.setTimeout(() => setNoticeText(""), 3000);
  }, []);
  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  const load = useCallback(async () => {
    const [st, mv] = await Promise.all([
      supabase.from(PIPA_STATIONS_TABLE).select("*").order("name"),
      supabase.rpc("pp_movements"),   // prices left out if the owner hid them
    ]);
    const err = st.error ?? mv.error;
    if (err) {
      setLoadError(err.code === "PGRST205" || err.code === "42P01" ? t("notInstalled")
        : err.code === "PGRST202" || err.code === "42883" ? t("needsUpdate") : err.message);
      return;
    }
    setLoadError("");
    setStations((st.data ?? []) as PipaStation[]);
    setMovements(((mv.data ?? []) as Record<string, unknown>[]).map(r => normalizeMovement(r)));
  }, [t]);
  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);

  const stationName = useMemo(() => Object.fromEntries(stations.map(s => [s.id, s.name])), [stations]);

  // One row per P-P line; a shift's "sold" lines (one per fuel) share a row.
  const history = useMemo(() => {
    const list = stationFilter ? movements.filter(m => m.station_id === stationFilter) : movements;
    const items: Item[] = [];
    const shifts = new Map<string, Extract<Item, { type: "shift" }>>();
    for (const m of list) {
      if (!m.shift_batch_id) { items.push({ type: "line", m }); continue; }
      let row = shifts.get(m.shift_batch_id);
      if (!row) {
        row = { type: "shift", key: m.shift_batch_id, shiftId: m.shift_id ?? null, name: shiftName(m), on: m.occurred_on, lines: [], by: m.created_by ?? null };
        shifts.set(m.shift_batch_id, row);
        items.push(row);
      }
      row.lines.push(m);
    }
    return items;
  }, [movements, stationFilter]);

  // Per fuel: its rows (a shift shows in each fuel it sold) and the totals for its card.
  const groups = useMemo(() => {
    const by = new Map<PipaProduct, Group>();
    const group = (p: PipaProduct) => {
      let g = by.get(p);
      if (!g) {
        g = { product: p, items: [], counts: { all: 0, buy: 0, shift: 0, other: 0 }, inPP: 0, outPP: 0, inL: 0, outL: 0, spent: 0,
              src: { official: { buys: 0, spent: 0, last: null }, shop: { buys: 0, spent: 0, last: null } } };
        by.set(p, g);
      }
      return g;
    };
    const add = (g: Group, item: Item, m: PipaMovement) => {
      g.items.push(item);
      g.counts.all++; g.counts[catOf(item)]++;
      const d = stockDelta(m), l = movementLiters(m);
      if (d > 0) { g.inPP += d; g.inL += l; } else if (d < 0) { g.outPP -= d; g.outL += l; }
      const c = purchaseCost(m);
      if (c) {
        const s = g.src[m.source === "official" ? "official" : "shop"];
        g.spent += c.spent; s.buys++; s.spent += c.spent;
        const at = `${m.occurred_on}|${m.created_at}`;
        if (!s.last || at > s.last.at) s.last = { perL: c.perL, on: m.occurred_on, at };
      }
    };
    for (const item of history) {
      if (item.type === "line") add(group(item.m.product), item, item.m);
      else for (const m of item.lines) add(group(m.product), { ...item, lines: [m] }, m);
    }
    return PIPA_PRODUCTS.filter(p => by.has(p)).map(p => by.get(p)!);
  }, [history]);

  const total = useMemo(() => groups.reduce((s, g) => ({
    inPP: s.inPP + g.inPP, outPP: s.outPP + g.outPP, spent: s.spent + g.spent, buys: s.buys + g.src.official.buys + g.src.shop.buys,
  }), { inPP: 0, outPP: 0, spent: 0, buys: 0 }), [groups]);

  async function remove(item: Item) {
    const isShift = item.type === "shift";
    const title = isShift
      ? `${t("h_shift", { name: item.name })} · ${item.on}`
      : describe(item.m, stationName[item.m.station_id ?? ""] ?? "", t).title;
    const reason = await reasonDialog(
      (isShift ? t("reasonUndoShift", { title }) : t("reasonDelete", { title })) + (owner ? "" : t("ownerTold")),
      { danger: true, confirmLabel: isShift ? t("undoShift") : undefined, placeholder: t("reasonPh") },
    );
    if (!reason) return;
    const id = isShift ? item.key : item.m.id;
    setDeletingId(id);
    const { error } = isShift
      ? await supabase.rpc("undo_shift_deduction", { p_shift_id: item.shiftId, p_reason: reason })
      : await supabase.rpc("archive_pp_movement", { p_id: item.m.id, p_reason: reason });
    setDeletingId(null);
    if (error) { setNotice(t("deleteFailed", { msg: error.message })); load(); return; }
    setNotice(isShift ? t("shiftUndone") : t("archived"), true);
    load();
  }

  const by = (who: string | null | undefined) => (owner && who && who !== "auto" ? t("by", { who }) : "");

  const shiftRow = (item: Extract<Item, { type: "shift" }>, product: PipaProduct) => {
    const m = item.lines[0];
    return (
      <li key={`${item.key}-${product}`} className="flex items-start gap-3 px-4 py-2.5" data-testid="pp-shift-row">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-bold rounded px-1.5 py-0.5 bg-slate-100 text-slate-600">{t("b_shift")}</span>
            <span className="text-sm font-semibold text-slate-700">{item.name}</span>
          </div>
          <p className="text-xs text-slate-500 tabular-nums mt-0.5">{fmtPipas(m.pipas)} P-P · {fmtLiters(movementLiters(m))}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">{item.on}{by(item.by)}</p>
        </div>
        <span className="shrink-0 text-sm font-bold tabular-nums text-pale-red-foreground" title={t("stockEffect")}>−{fmtPipas(Math.abs(stockDelta(m)))}</span>
        <button onClick={() => remove(item)} disabled={deletingId === item.key || !item.shiftId} aria-label={t("undoShift")}
          className="shrink-0 p-2 -m-1 text-slate-400 hover:text-pale-red-foreground hover:bg-pale-red rounded-lg transition-colors">
          {deletingId === item.key ? <Loader2 className="w-4 h-4 animate-spin" /> : <Undo2 className="w-4 h-4" />}
        </button>
      </li>
    );
  };

  const lineRow = (m: PipaMovement) => {
    const b = badge(m, t);
    const delta = stockDelta(m);
    const station = m.station_id ? stationName[m.station_id] ?? "—" : "";
    const toward = m.kind === "borrow_returned" || m.kind === "lend" ? "toSt" as const : "fromSt" as const;
    const cost = purchaseCost(m);
    const pb = m.price_mode && m.unit_price != null ? priceBreakdown(m.price_mode, m.unit_price, m.pipas, m.liters_per_pipa) : null;
    const money = cost ? cost.spent : pb ? (m.total_amount ?? pb.total) : null;
    const pill = cost ? t("costL", { v: fmtMMK(cost.perL) }) : pb && m.kind === "adjust" ? perL(pb.perLiter) : "";
    const sub = cost
      ? (cost.fees > 0 ? t("priceFees", { perPipa: fmtMMK(cost.perPipa), price: fmtMMK(cost.price), fees: fmtMMK(cost.fees) })
                       : t("pricePP", { perPipa: fmtMMK(cost.perPipa), perLiter: fmtMMK(cost.price) }))
      : pb && m.kind !== "adjust" ? t("pricePP", { perPipa: fmtMMK(pb.perPipa), perLiter: fmtMMK(pb.perLiter) }) : "";
    const short = m.kind === "adjust" && m.pipas < 0;
    // "Pool closed — spill · drum leaked": the badge already says why, keep just the note.
    const note = m.kind === "write_off" ? (m.note ?? "").replace(/^Pool closed — \w+(?: · )?/, "") : m.note;
    return (
      <li key={m.id} className={`flex items-start gap-3 px-4 py-3 ${short ? "bg-red-50" : m.kind === "buy" ? "bg-emerald-50/40" : ""}`}
        data-testid={m.kind === "buy" ? "pp-buy-row" : "pp-line-row"}>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <span className={`text-[10px] font-bold rounded px-1.5 py-0.5 ${b.cls}`}>{b.label}</span>
            <span className="text-sm font-bold text-slate-900 tabular-nums">
              {m.kind === "adjust" ? (m.pipas > 0 ? "+" : "−") : ""}{fmtPipas(Math.abs(m.pipas))} P-P
              <span className="font-medium text-slate-500"> · {fmtLiters(movementLiters(m))}</span>
            </span>
            {station && <span className="text-xs text-slate-500">{t(toward, { station })}</span>}
          </div>
          {money != null && (
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-[15px] font-bold text-slate-900 tabular-nums" data-testid="pp-row-money">{fmtMMK(money)}</span>
              {pill && <span className="text-xs font-semibold text-blue-700 bg-blue-50 rounded-md px-1.5 py-0.5 tabular-nums">{pill}</span>}
            </div>
          )}
          {sub && <p className="text-xs text-slate-500 mt-0.5 break-words tabular-nums">{sub}</p>}
          <p className="text-[11px] text-slate-400 mt-0.5 break-words">
            {m.occurred_on}{note && (m.kind !== "adjust" || short) ? ` · ${note}` : ""}{by(m.created_by)}
          </p>
        </div>
        <span className={`shrink-0 text-base font-bold tabular-nums ${delta > 0 ? "text-pale-green-foreground" : delta < 0 ? "text-pale-red-foreground" : "text-slate-400"}`}
          title={t("stockEffect")}>
          {delta > 0 ? "+" : delta < 0 ? "−" : "±"}{fmtPipas(Math.abs(delta))}
        </span>
        <button onClick={() => remove({ type: "line", m })} disabled={deletingId === m.id} aria-label={t("deleteRecord")}
          className="shrink-0 p-2 -m-1 text-slate-400 hover:text-pale-red-foreground hover:bg-pale-red rounded-lg transition-colors">
          {deletingId === m.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
        </button>
      </li>
    );
  };

  const fuelCard = (g: Group) => {
    const isOpen = !!open[g.product];
    const c = cat[g.product] ?? "all";
    const rows = c === "all" ? g.items : g.items.filter(i => catOf(i) === c);
    const limit = shown[g.product] ?? PAGE;
    const priced = g.spent > 0;
    return (
      <section key={g.product} className={`bg-white border rounded-xl overflow-hidden ${isOpen ? "border-blue-200 shadow-sm" : "border-slate-100"}`} data-testid={`pp-fuel-${g.product}`}>
        <button type="button" onClick={() => setOpen(o => ({ ...o, [g.product]: !isOpen }))} aria-expanded={isOpen}
          className="w-full text-left p-4 space-y-3 active:bg-slate-50" data-testid={`pp-fuel-btn-${g.product}`}>
          <div className="flex items-center gap-2">
            <i className={`w-2.5 h-2.5 rounded-full shrink-0 ${FUEL_DOT[g.product]}`} />
            <span className="text-base font-bold text-slate-900">{pipaProduct(t, g.product)}</span>
            <span className="text-xs text-slate-400">{t("nLines", { n: g.counts.all })}</span>
            <ChevronDown className={`ml-auto w-5 h-5 text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Stat label={t("inLbl")} pp={g.inPP} liters={g.inL} sign="+" />
            <Stat label={t("outLbl")} pp={g.outPP} liters={g.outL} sign="−" />
          </div>
          {priced && (
            <div className="border-t border-slate-100 pt-3">
              <p className="text-[11px] text-slate-500">{t("spent")}</p>
              <p className="text-lg font-bold text-slate-900 tabular-nums leading-tight" data-testid="pp-fuel-spent">{fmtMMK(g.spent)}</p>
              {/* Big PO and shop purchases each on their own line — never averaged together */}
              <div className="mt-2 space-y-1.5">
                {(["official", "shop"] as const).filter(k => g.src[k].buys > 0).map(k => (
                  <div key={k} className="flex items-start justify-between gap-2 text-xs" data-testid={`pp-fuel-src-${k}`}>
                    <span className="min-w-0">
                      <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${k === "official" ? "bg-emerald-500" : "bg-yellow-400"}`} />
                      <span className="font-semibold text-slate-700">{t("srcSpent", { label: t(k === "official" ? "b_official" : "b_shop"), n: g.src[k].buys })}</span>
                      <span className="block text-[11px] text-slate-400 pl-3.5">{g.src[k].last && t("lastCost", { v: fmtMMK(g.src[k].last!.perL), d: g.src[k].last!.on })}</span>
                    </span>
                    <span className="shrink-0 font-bold text-slate-900 tabular-nums">{fmtMMK(g.src[k].spent)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </button>

        {isOpen && (
          <div className="border-t border-slate-100">
            <div className="flex gap-1.5 overflow-x-auto px-4 py-2 bg-slate-50" role="group">
              {CATS.filter(k => k === "all" || g.counts[k] > 0).map(k => (
                <button key={k} type="button" onClick={() => { setCat(s => ({ ...s, [g.product]: k })); setShown(s => ({ ...s, [g.product]: PAGE })); }}
                  className={`shrink-0 text-xs font-semibold rounded-full px-3 py-1 border ${c === k ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200"}`}>
                  {t(`c_${k}`)} <span className={c === k ? "text-slate-300" : "text-slate-400"}>{g.counts[k]}</span>
                </button>
              ))}
            </div>
            <ul className="divide-y divide-slate-100" data-testid={`pp-history-${g.product}`}>
              {rows.slice(0, limit).map(item => (item.type === "shift" ? shiftRow(item, g.product) : lineRow(item.m)))}
            </ul>
            {rows.length > limit && (
              <button type="button" onClick={() => setShown(s => ({ ...s, [g.product]: limit + PAGE * 2 }))}
                className="w-full py-3 text-sm font-semibold text-pale-blue-foreground border-t border-slate-100 hover:bg-slate-50">
                {t("showMore", { n: Math.min(PAGE * 2, rows.length - limit) })}
              </button>
            )}
          </div>
        )}
      </section>
    );
  };

  return (
      <div className="space-y-4">
        {loadError && (
          <div role="alert" className="flex items-start gap-2 bg-pale-red border border-red-200 rounded-xl px-4 py-3 text-sm text-pale-red-foreground">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {loadError}
          </div>
        )}
        {notice && <p className="text-sm font-medium text-pale-green-foreground" role="status">{notice}</p>}

        {stations.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" role="group" aria-label={t("stations")}>
            <button onClick={() => filterBy("")}
              className={`shrink-0 text-xs font-semibold rounded-lg px-2.5 py-1.5 border ${!stationFilter ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-200"}`}>
              {t("allLines")}
            </button>
            {stations.map(s => (
              <button key={s.id} onClick={() => filterBy(stationFilter === s.id ? "" : s.id)}
                className={`shrink-0 inline-flex items-center gap-1 text-xs font-semibold rounded-lg px-2.5 py-1.5 border ${stationFilter === s.id ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-200"}`}>
                {s.name}{stationFilter === s.id && <X className="w-3 h-3" />}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="py-8 text-center"><Loader2 className="w-6 h-6 text-blue-500/50 animate-spin mx-auto" /></div>
        ) : history.length === 0 ? (
          <p className="bg-white border border-slate-100 rounded-xl p-6 text-center text-sm text-slate-500">{t("noMovements")}</p>
        ) : (
          <div className="space-y-3" data-testid="pp-history">
            <div className="rounded-xl bg-gradient-to-br from-blue-600 to-blue-700 text-white p-4" data-testid="pp-history-total">
              <p className="text-xs font-semibold text-blue-100">
                {stationFilter ? t("totalAt", { station: stationName[stationFilter] ?? "—" }) : t("totalAll")}
              </p>
              {total.spent > 0 && (
                <>
                  <p className="text-2xl font-bold tabular-nums mt-1">{fmtMMK(total.spent)}</p>
                  <p className="text-xs text-blue-100">{t("spent")} · {t("nBuys", { n: total.buys })}</p>
                </>
              )}
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm font-semibold tabular-nums">
                <span>{t("inLbl")} <span className="text-emerald-200">{signed(total.inPP, "+")} P-P</span></span>
                <span>{t("outLbl")} <span className={total.outPP > 0.0005 ? "text-red-200" : "text-blue-200"}>{signed(total.outPP, "−")} P-P</span></span>
              </div>
            </div>
            <p className="text-xs text-slate-400 px-1">{t("tapFuel")}</p>
            {groups.map(fuelCard)}
          </div>
        )}
        <p className="text-[11px] text-slate-400">{t("cashNote")}</p>
      </div>
  );
}

/** The history page (accountants and managers; owners also have it inside Profit). */
export default function PipaHistory() {
  const t = usePipaT();
  const [, setLocation] = useLocation();
  return (
    <div className="flex-1 overflow-auto bg-slate-50">
      <div className="px-4 md:px-6 py-5 border-b border-slate-100 bg-white">
        <button onClick={() => setLocation("/pipa-ledger")} className="flex items-center gap-1 text-xs font-semibold text-pale-blue-foreground mb-2">
          <ArrowLeft className="w-3.5 h-3.5" /> {t("title")}
        </button>
        <h1 className="text-2xl font-bold text-slate-900">{t("historyTitle")}</h1>
        <p className="text-slate-400 text-sm mt-0.5">{t("historySub")}</p>
      </div>
      <div className="p-4 md:p-6">
        <PipaHistoryList />
      </div>
    </div>
  );
}
