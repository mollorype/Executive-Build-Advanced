import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { CheckCircle2, ChevronRight, HandCoins, Phone } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { makeT } from "@/lib/app-i18n";
import {
  PIPA_PRODUCTS, fmtPipas, movementLiters, normalizeMovement, round3, stockByProduct,
  type PipaMovement, type PipaProduct, type PipaStation,
} from "@/lib/pipa-ledger";
import { vol, type VolUnit } from "@/lib/units";
import StockCards, { useCountUp } from "@/components/pipa/stock-cards";
import { buildFuelBars, carriedLots, fuelStarts, type BarKind, type BarLine, type BarLot, type FuelBar } from "@/lib/stock-bars";

const useT = makeT({
  p_92: { en: "Fuel 92", my: "ဓာတ်ဆီ 92" },
  p_95: { en: "Fuel 95", my: "ဓာတ်ဆီ 95" },
  p_PD: { en: "Premium Diesel", my: "ပရီမီယံ ဒီဇယ်" },
  p_D: { en: "Diesel", my: "ဒီဇယ်" },
  openLedger: { en: "Open P-P Ledger", my: "P-P စာရင်း ဖွင့်ရန်" },
  borrowed: { en: "Borrowed P-P", my: "ချေးယူထားသော P-P" },
  borrowedHelp: { en: "P-P you still have to give back (or pay for), by station.", my: "ဆိုင်များကို ပြန်ပေးရန် (သို့မဟုတ် ငွေပေးရန်) ကျန်သော P-P — ဆိုင်အလိုက်။" },
  totalOwed: { en: "Still to give back", my: "ပြန်ပေးရန် စုစုပေါင်း" },
  owe: { en: "To give back {v}", my: "ပြန်ပေးရန် {v}" },
  took: { en: "Borrowed {n}", my: "ချေးယူ {n}" },
  gaveBack: { en: "Returned {n}", my: "ပြန်ပေး {n}" },
  paidCash: { en: "Paid cash {n}", my: "ငွေဖြင့် ရှင်း {n}" },
  left: { en: "Left {n}", my: "ကျန် {n}" },
  lastOn: { en: "Last borrowed {d}", my: "နောက်ဆုံး ချေးယူ {d}" },
  settledPct: { en: "{p}% settled", my: "{p}% ရှင်းပြီး" },
  noneOwed: { en: "Nothing borrowed is outstanding — all settled.", my: "ပြန်ပေးရန် ကျန်သော ချေးယူမှု မရှိပါ — အားလုံး ရှင်းပြီး။" },
  barsTitle: { en: "Stock since the big PO", my: "PO ကြီး နောက်ပိုင်း လက်ကျန်" },
  barsHelp: { en: "Each bar is the weekly big PO plus everything that came in after it. Sales come off the left (faded); the solid part is what's left.", my: "ဘားတစ်ခုစီသည် တစ်ပတ်တစ်ခါ ဝင်သော PO ကြီး နှင့် ၎င်းနောက် ဝင်လာသမျှ ပေါင်းထားခြင်း ဖြစ်သည်။ အရောင်းကို ဘယ်ဘက်မှ နုတ်သည် (မှိန်)။ အရောင်ရင့်သည့် အပိုင်းသည် ကျန်ငွေ ဖြစ်သည်။" },
  k_official: { en: "Big PO", my: "PO ကြီး" },
  k_shop: { en: "Shop purchase", my: "ဆိုင်မှ ဝယ်" },
  k_borrow: { en: "Borrowed", my: "ချေးယူ" },
  k_carry: { en: "Left from before", my: "ယခင်ကျန်" },
  k_count: { en: "Stock count", my: "လက်ကျန်စစ်" },
  k_other: { en: "Other", my: "အခြား" },
  faded: { en: "faded = sold / gone", my: "မှိန် = ရောင်း/ထွက်ပြီး" },
  leftPct: { en: "Left {v} · {p}%", my: "ကျန် {v} · {p}%" },
  total: { en: "Total {v}", my: "စုစုပေါင်း {v}" },
  out: { en: "Sold / gone {v}", my: "ရောင်း/ထွက်ပြီး {v}" },
  since: { en: "From the PO of {d}", my: "{d} PO ကြီးမှ စ" },
  noPO: { en: "No big PO yet — stock on hand", my: "PO ကြီး မရှိသေး — လက်ကျန်သာ" },
});

const KINDS: BarKind[] = ["carry", "official", "count", "shop", "borrow", "other"];
const COLOR: Record<BarKind, { solid: string; faded: string; dot: string }> = {
  carry:    { solid: "bg-slate-400",   faded: "bg-slate-400/25",   dot: "bg-slate-400" },
  official: { solid: "bg-emerald-500", faded: "bg-emerald-500/25", dot: "bg-emerald-500" },
  count:    { solid: "bg-green-300",   faded: "bg-green-300/35",   dot: "bg-green-300" },
  shop:     { solid: "bg-yellow-400",  faded: "bg-yellow-400/30",  dot: "bg-yellow-400" },
  borrow:   { solid: "bg-orange-500",  faded: "bg-orange-500/25",  dot: "bg-orange-500" },
  other:    { solid: "bg-sky-400",     faded: "bg-sky-400/25",     dot: "bg-sky-400" },
};
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toLocaleDateString("en-CA", { timeZone: "Asia/Yangon" }); };

type Owed = { stationId: string; product: PipaProduct; took: number; back: number; paid: number; owe: number; oweL: number; lastOn: string };

/** For each station and fuel: P-P borrowed, returned, paid for in cash, and still owed. */
function borrowedByStation(movements: PipaMovement[]): Owed[] {
  const acc = new Map<string, Owed>();
  for (const m of movements) {
    if (!m.station_id || !["borrow", "borrow_returned", "borrow_paid"].includes(m.kind)) continue;
    const key = `${m.station_id}|${m.product}`;
    const o = acc.get(key) ?? { stationId: m.station_id, product: m.product, took: 0, back: 0, paid: 0, owe: 0, oweL: 0, lastOn: "" };
    const l = movementLiters(m);
    if (m.kind === "borrow") { o.took += m.pipas; o.oweL += l; if (m.occurred_on > o.lastOn) o.lastOn = m.occurred_on; }
    if (m.kind === "borrow_returned") { o.back += m.pipas; o.oweL -= l; }
    if (m.kind === "borrow_paid") { o.paid += m.pipas; o.oweL -= l; }
    acc.set(key, o);
  }
  return [...acc.values()]
    .map(o => ({ ...o, took: round3(o.took), back: round3(o.back), paid: round3(o.paid), owe: round3(o.took - o.back - o.paid), oweL: Math.max(0, Math.round(o.oweL * 100) / 100) }))
    .filter(o => o.owe > 0.0005);
}

/** Owner's stock window: stock cards (animated), then borrowed P-P still owed. */
export default function StockView({ unit }: { unit: VolUnit }) {
  const t = useT();
  const [, setLocation] = useLocation();
  const [movements, setMovements] = useState<PipaMovement[] | null>(null);
  const [stations, setStations] = useState<PipaStation[]>([]);
  const [bars, setBars] = useState<FuelBar[] | null>(null);

  useEffect(() => {
    (async () => {
      const [mv, st] = await Promise.all([supabase.rpc("pp_movements"), supabase.from("pipa_stations").select("*").order("name")]);
      setMovements(((mv.data ?? []) as Record<string, unknown>[]).map(r => normalizeMovement(r)));
      setStations((st.data ?? []) as PipaStation[]);

      // Bars: every purchase still holding fuel, plus recent ones (this week's PO and what came after it).
      const [open, recent] = await Promise.all([
        supabase.from("pp_lots").select("id, product, source, occurred_on, created_at, liters, remaining").gt("remaining", 0.0005),
        supabase.from("pp_lots").select("id, product, source, occurred_on, created_at, liters, remaining").gte("occurred_on", daysAgo(120)),
      ]);
      const byId = new Map<string, BarLot>();
      for (const r of [...(open.data ?? []), ...(recent.data ?? [])] as Record<string, unknown>[]) {
        byId.set(String(r.id), { id: String(r.id), product: String(r.product), source: String(r.source), occurred_on: String(r.occurred_on),
          created_at: String(r.created_at), liters: Number(r.liters) || 0, remaining: Number(r.remaining) || 0 });
      }
      const lots = [...byId.values()];
      const carried = carriedLots(lots);
      let lines: BarLine[] = [];
      if (carried.length) {
        const starts = fuelStarts(lots);
        const from = carried.map(l => starts[l.product]?.occurred_on ?? "").sort()[0];
        const { data } = await supabase.from("pp_cost_lines").select("lot_id, liters, occurred_on").in("lot_id", carried.map(l => l.id)).gte("occurred_on", from);
        lines = ((data ?? []) as Record<string, unknown>[]).map(r => ({ lot_id: String(r.lot_id), liters: Number(r.liters) || 0, occurred_on: String(r.occurred_on) }));
      }
      setBars(buildFuelBars(lots, lines, PIPA_PRODUCTS));
    })();
  }, []);

  const stock = useMemo(() => stockByProduct(movements ?? []), [movements]);
  const owed = useMemo(() => borrowedByStation(movements ?? []), [movements]);
  const byStation = useMemo(() => {
    const out: { station: PipaStation | undefined; id: string; rows: Owed[] }[] = [];
    for (const o of owed) {
      let g = out.find(x => x.id === o.stationId);
      if (!g) { g = { station: stations.find(s => s.id === o.stationId), id: o.stationId, rows: [] }; out.push(g); }
      g.rows.push(o);
    }
    return out;
  }, [owed, stations]);
  const borrowBase = 620 + (bars?.length ?? 0) * 110;
  const totals = PIPA_PRODUCTS.map(p => ({ p, owe: round3(owed.filter(o => o.product === p).reduce((s, o) => s + o.owe, 0)) })).filter(x => x.owe > 0);

  return (
    <div className="space-y-5">
      <div className="flex justify-end -mb-2">
        <button onClick={() => setLocation("/pipa-ledger")} className="flex items-center gap-0.5 text-xs font-semibold text-pale-blue-foreground">
          {t("openLedger")} <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
      <StockCards stock={stock} loading={movements === null} animate />

      {/* This week's capacity per fuel: big PO + what came in after it, used part faded */}
      {bars && bars.length > 0 && (
        <section className="space-y-3" data-testid="profit-bars">
          <div>
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest">{t("barsTitle")}</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">{t("barsHelp")}</p>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[11px] text-slate-600">
              {KINDS.filter(k => bars.some(b => b.parts[k] > 0)).map(k => (
                <span key={k} className="flex items-center gap-1"><i className={`w-2.5 h-2.5 rounded-sm ${COLOR[k].dot}`} />{t(`k_${k}`)}</span>
              ))}
              <span className="text-slate-400">· {t("faded")}</span>
            </div>
          </div>
          {bars.map((b, i) => <StockBar key={b.product} bar={b} unit={unit} label={t(`p_${b.product as PipaProduct}`)} delay={620 + i * 110} />)}
        </section>
      )}

      {/* Borrowed P-P still owed — the only part drawn as a picture */}
      <section className="space-y-3" data-testid="profit-borrowed">
        <div>
          <h2 className="flex items-center gap-1.5 text-xs font-bold text-slate-500 uppercase tracking-widest"><HandCoins className="w-4 h-4" /> {t("borrowed")}</h2>
          <p className="text-[11px] text-slate-500 mt-0.5">{t("borrowedHelp")}</p>
        </div>
        {movements !== null && owed.length === 0 ? (
          <p className="pp-rise flex items-center gap-2 bg-white border border-slate-100 rounded-xl p-4 text-sm text-slate-600">
            <CheckCircle2 className="w-4 h-4 text-pale-green-foreground shrink-0" /> {t("noneOwed")}
          </p>
        ) : (
          <>
            {totals.length > 0 && (
              <div className="pp-rise bg-white border border-red-100 rounded-xl p-4" style={{ animationDelay: `${borrowBase}ms` }} data-testid="profit-borrowed-total">
                <p className="text-xs text-slate-500 mb-1.5">{t("totalOwed")}</p>
                <div className="flex flex-wrap gap-x-5 gap-y-1">
                  {totals.map(x => <TotalChip key={x.p} label={t(`p_${x.p}`)} value={x.owe} />)}
                </div>
              </div>
            )}
            {byStation.map((g, gi) => (
              <div key={g.id} className="pp-rise bg-white border border-slate-100 rounded-xl p-4 space-y-3" style={{ animationDelay: `${borrowBase + 80 + gi * 90}ms` }} data-testid="profit-borrow-station">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-bold text-slate-900 truncate">{g.station?.name ?? "—"}</p>
                  {g.station?.phone && (
                    <a href={`tel:${g.station.phone}`} className="shrink-0 flex items-center gap-1 text-xs text-slate-500"><Phone className="w-3 h-3" /> {g.station.phone}</a>
                  )}
                </div>
                {g.rows.map(o => <OwedRow key={o.product} o={o} unit={unit} label={t(`p_${o.product}`)} delay={borrowBase + 200 + gi * 90} />)}
              </div>
            ))}
          </>
        )}
      </section>
    </div>
  );
}

function TotalChip({ label, value }: { label: string; value: number }) {
  const shown = useCountUp(value, true, 1100);
  return (
    <span className="text-sm">
      <span className="text-slate-600">{label} </span>
      <span className="font-bold text-pale-red-foreground tabular-nums">{fmtPipas(shown)} P-P</span>
    </span>
  );
}

/** One fuel owed to one station: a bar of borrowed = returned + paid in cash + still owed. */
function OwedRow({ o, unit, label, delay }: { o: Owed; unit: VolUnit; label: string; delay: number }) {
  const t = useT();
  const pct = (n: number) => (o.took > 0 ? (n / o.took) * 100 : 0);
  const settled = Math.round(pct(o.back + o.paid));
  return (
    <div className="space-y-1.5" data-testid="profit-owed-row">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-slate-900">{label}</span>
        <span className="text-sm font-bold text-pale-red-foreground tabular-nums">{t("owe", { v: `${fmtPipas(o.owe)} P-P` })}</span>
      </div>
      <div className="h-3 rounded-full bg-slate-100 overflow-hidden" role="img"
        aria-label={`${t("took", { n: fmtPipas(o.took) })} · ${t("gaveBack", { n: fmtPipas(o.back) })} · ${t("paidCash", { n: fmtPipas(o.paid) })} · ${t("left", { n: fmtPipas(o.owe) })}`}>
        <div className="pp-fill flex h-full" style={{ animationDelay: `${delay}ms` }}>
          {o.back > 0 && <div className="bg-emerald-500" style={{ width: `${pct(o.back)}%` }} />}
          {o.paid > 0 && <div className="bg-sky-500" style={{ width: `${pct(o.paid)}%` }} />}
          <div className="bg-red-400 pp-glow" style={{ width: `${pct(o.owe)}%` }} />
        </div>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500 tabular-nums">
        <span>{t("took", { n: `${fmtPipas(o.took)} P-P` })}</span>
        {o.back > 0 && <span className="flex items-center gap-1"><i className="w-2 h-2 rounded-full bg-emerald-500" />{t("gaveBack", { n: fmtPipas(o.back) })}</span>}
        {o.paid > 0 && <span className="flex items-center gap-1"><i className="w-2 h-2 rounded-full bg-sky-500" />{t("paidCash", { n: fmtPipas(o.paid) })}</span>}
        <span className="flex items-center gap-1"><i className="w-2 h-2 rounded-full bg-red-400" />{t("left", { n: unit === "pp" ? `${fmtPipas(o.owe)} P-P (${vol(o.oweL, "l")})` : `${vol(o.oweL, "l")} (${fmtPipas(o.owe)} P-P)` })}</span>
      </div>
      <div className="flex justify-between text-[11px] text-slate-400">
        <span>{t("lastOn", { d: o.lastOn })}</span>
        <span>{t("settledPct", { p: settled })}</span>
      </div>
    </div>
  );
}

/** One fuel's bar: segments in the order the stock is used, each faded for what's gone. */
function StockBar({ bar, unit, label, delay }: { bar: FuelBar; unit: VolUnit; label: string; delay: number }) {
  const t = useT();
  const pct = bar.capacity > 0 ? Math.round((bar.remaining / bar.capacity) * 100) : 0;
  const shownPct = useCountUp(pct, true, 1000);
  const parts = KINDS.filter(k => bar.parts[k] > 0.0005);
  return (
    <div className="pp-rise bg-white border border-slate-100 rounded-xl p-4 space-y-2" style={{ animationDelay: `${delay}ms` }} data-testid={`profit-bar-${bar.product}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-bold text-slate-900">{label}</span>
        <span className="text-xs font-semibold text-slate-700 tabular-nums">{t("leftPct", { v: vol(bar.remaining, unit), p: shownPct })}</span>
      </div>
      <div className="h-4 rounded-full bg-slate-100 overflow-hidden">
        <div className="pp-fill flex h-full" style={{ animationDelay: `${delay + 150}ms` }}>
          {bar.segments.map((s, i) => (
            <div key={s.lotId} className={`flex h-full ${i ? "border-l-2 border-white" : ""}`} style={{ width: `${(s.capacity / bar.capacity) * 100}%` }} data-kind={s.kind}>
              <div className={COLOR[s.kind].faded} style={{ width: `${s.capacity > 0 ? ((s.capacity - s.remaining) / s.capacity) * 100 : 0}%` }} />
              <div className={`flex-1 ${COLOR[s.kind].solid}`} />
            </div>
          ))}
        </div>
      </div>
      <p className="text-[11px] text-slate-600 tabular-nums">
        {t("total", { v: vol(bar.capacity, unit) })}
        {parts.length > 1 && <> = {parts.map((k, i) => <span key={k}>{i ? " + " : ""}<i className={`inline-block w-2 h-2 rounded-sm mr-0.5 ${COLOR[k].dot}`} />{t(`k_${k}`)} {vol(bar.parts[k], unit)}</span>)}</>}
      </p>
      <div className="flex justify-between gap-2 text-[11px] text-slate-400 tabular-nums">
        <span>{t("out", { v: vol(bar.out, unit) })}</span>
        <span>{bar.since ? t("since", { d: bar.since }) : t("noPO")}</span>
      </div>
    </div>
  );
}
