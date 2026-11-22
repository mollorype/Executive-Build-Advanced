import { useCallback, useEffect, useMemo, useState } from "react";
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
import FuelStockSheet from "@/components/pipa/fuel-stock-sheet";

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
});

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
  const [notice, setNotice] = useState("");
  const [sheet, setSheet] = useState<PipaProduct | null>(null);

  const reload = useCallback(async () => {
    const [mv, st] = await Promise.all([supabase.rpc("pp_movements"), supabase.from("pipa_stations").select("*").order("name")]);
    setMovements(((mv.data ?? []) as Record<string, unknown>[]).map(r => normalizeMovement(r)));
    setStations((st.data ?? []) as PipaStation[]);
  }, []);
  useEffect(() => { reload(); }, [reload]);

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
  const borrowBase = 620;
  const totals = PIPA_PRODUCTS.map(p => ({ p, owe: round3(owed.filter(o => o.product === p).reduce((s, o) => s + o.owe, 0)) })).filter(x => x.owe > 0);

  return (
    <div className="space-y-5">
      <div className="flex justify-end -mb-2">
        <button onClick={() => setLocation("/pipa-ledger")} className="flex items-center gap-0.5 text-xs font-semibold text-pale-blue-foreground">
          {t("openLedger")} <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
      <StockCards stock={stock} loading={movements === null} animate onOpen={setSheet} />

      {notice && <p className="text-sm font-medium text-pale-green-foreground" role="status">{notice}</p>}
      {sheet && (
        <FuelStockSheet product={sheet} stock={stock[sheet]} owner canClose onClose={() => setSheet(null)}
          onChanged={m => { setSheet(null); setNotice(m); reload(); setTimeout(() => setNotice(""), 3000); }} />
      )}

      {/* Borrowed P-P still owed (numbers only) */}
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

