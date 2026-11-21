import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { ChevronDown, ChevronRight, Cylinder, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { makeT } from "@/lib/app-i18n";
import { PIPA_PRODUCTS, fmtLiters, fmtPipas, normalizeMovement, stockByProduct, type PipaProduct, type ProductStock } from "@/lib/pipa-ledger";
import { mmk, vol, type VolUnit } from "@/lib/units";

const useT = makeT({
  p_92: { en: "Fuel 92", my: "ဓာတ်ဆီ 92" },
  p_95: { en: "Fuel 95", my: "ဓာတ်ဆီ 95" },
  p_PD: { en: "Premium Diesel", my: "ပရီမီယံ ဒီဇယ်" },
  p_D: { en: "Diesel", my: "ဒီဇယ်" },
  ppStock: { en: "P-P stock", my: "P-P လက်ကျန်" },
  openLedger: { en: "Open P-P Ledger", my: "P-P စာရင်း ဖွင့်ရန်" },
  byPurchase: { en: "Stock by purchase", my: "အဝယ်အလိုက် လက်ကျန်" },
  byPurchaseHelp: { en: "Sales come off the oldest purchase first. Each purchase shows what's left, what sold, and the profit on what sold.", my: "အရောင်းကို အဟောင်းဆုံး အဝယ်မှ စ၍ နုတ်ပါသည်။ အဝယ်တစ်ခုစီ၏ ကျန်ငွေ၊ ရောင်းပြီး နှင့် ရောင်းပြီးသမျှ အမြတ်ကို ပြပါသည်။" },
  left: { en: "{v} left", my: "ကျန် {v}" },
  remaining: { en: "Left", my: "ကျန်" },
  ofTotal: { en: "of {v}", my: "{v} အနက်" },
  sold: { en: "Sold", my: "ရောင်းပြီး" },
  otherOut: { en: "Lent / short / used", my: "ချေးပေး / လို / သုံးစွဲ" },
  costL: { en: "Cost per litre", my: "လီတာ ကုန်ကျ" },
  costParts: { en: "{p} + fees {f}", my: "{p} + အခ {f}" },
  noCost: { en: "No price", my: "စျေး မရှိ" },
  lotProfit: { en: "Profit on what sold", my: "ရောင်းပြီးသမျှ အမြတ်" },
  inUse: { en: "In use", my: "အသုံးပြုဆဲ" },
  queued: { en: "Waiting", my: "စောင့်ဆိုင်း" },
  finished: { en: "Used up", my: "ကုန်ပြီး" },
  finishedN: { en: "Used-up purchases ({n})", my: "ကုန်ပြီး အဝယ်များ ({n})" },
  none: { en: "No purchases recorded yet. Record them in the P-P Ledger.", my: "အဝယ် မှတ်တမ်း မရှိသေးပါ။ P-P စာရင်းတွင် မှတ်ပါ။" },
  s_shop: { en: "Shop purchase", my: "ဆိုင်မှ ဝယ်" },
  s_official: { en: "Official purchase", my: "တရားဝင် အဝယ်" },
  s_borrow: { en: "Borrowed", my: "ချေးယူ" },
  s_lend_return: { en: "Returned to us", my: "ပြန်ရ" },
  s_count_gain: { en: "Count: extra", my: "စစ်ဆေးချက်: ပို" },
  s_opening: { en: "Opening stock", my: "စတင်လက်ကျန်" },
});

type Lot = {
  id: string; product: PipaProduct; source: string; station_id: string | null; occurred_on: string;
  liters: number; remaining: number; price_per_liter: number | null; fees_per_liter: number; cost_per_liter: number | null;
};
type Stats = { sold: number; other: number; revenue: number; cost: number };

const n = (v: unknown) => Number(v) || 0;
const OPEN = 0.0005;

/** Owner's stock window: P-P on hand, and every purchase with what's left of it. */
export default function StockView({ unit }: { unit: VolUnit }) {
  const t = useT();
  const [, setLocation] = useLocation();
  const [stock, setStock] = useState<Record<PipaProduct, ProductStock> | null>(null);
  const [open, setOpen] = useState<Lot[] | null>(null);
  const [done, setDone] = useState<Lot[]>([]);
  const [stats, setStats] = useState<Record<string, Stats>>({});
  const [stations, setStations] = useState<Record<string, string>>({});
  const [showDone, setShowDone] = useState(false);
  const other: VolUnit = unit === "pp" ? "l" : "pp";
  const product = (p: PipaProduct) => t(`p_${p}`);

  useEffect(() => {
    (async () => {
      const lotNum = (x: Lot): Lot => ({ ...x, liters: n(x.liters), remaining: n(x.remaining), fees_per_liter: n(x.fees_per_liter),
        price_per_liter: x.price_per_liter == null ? null : n(x.price_per_liter), cost_per_liter: x.cost_per_liter == null ? null : n(x.cost_per_liter) });
      const [mv, o, d, st] = await Promise.all([
        supabase.rpc("pp_movements"),
        supabase.from("pp_lots").select("*").gt("remaining", OPEN).order("occurred_on").order("created_at"),
        supabase.from("pp_lots").select("*").lte("remaining", OPEN).order("occurred_on", { ascending: false }).order("created_at", { ascending: false }).limit(30),
        supabase.from("pipa_stations").select("id, name"),
      ]);
      setStock(stockByProduct(((mv.data ?? []) as Record<string, unknown>[]).map(r => normalizeMovement(r))));
      const openLots = ((o.data ?? []) as Lot[]).map(lotNum);
      const doneLots = ((d.data ?? []) as Lot[]).map(lotNum);
      setOpen(openLots); setDone(doneLots);
      setStations(Object.fromEntries(((st.data ?? []) as { id: string; name: string }[]).map(x => [x.id, x.name])));
      const ids = [...openLots, ...doneLots].map(l => l.id);
      if (ids.length) {
        const { data } = await supabase.from("pp_lot_stats").select("*").in("lot_id", ids);
        setStats(Object.fromEntries(((data ?? []) as Record<string, unknown>[]).map(r => [String(r.lot_id),
          { sold: n(r.sold_liters), other: n(r.other_liters), revenue: n(r.revenue), cost: n(r.cost) }])));
      }
    })();
  }, []);

  const byFuel = useMemo(() => PIPA_PRODUCTS.map(p => ({ p, lots: (open ?? []).filter(l => l.product === p) })).filter(g => g.lots.length), [open]);
  const both = (l: number) => `${vol(l, unit)} (${vol(l, other)})`;

  return (
    <div className="space-y-4">
      {/* P-P on hand, as on the old PO page */}
      <section className="bg-white border border-slate-100 rounded-xl overflow-hidden" data-testid="profit-pp-card">
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
          <Cylinder className="w-4 h-4 text-pale-blue-foreground" />
          <h2 className="text-slate-900 font-semibold text-sm">{t("ppStock")}</h2>
          <button onClick={() => setLocation("/pipa-ledger")} className="ml-auto flex items-center gap-0.5 text-xs font-semibold text-pale-blue-foreground">
            {t("openLedger")} <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-slate-100">
          {PIPA_PRODUCTS.map(p => (
            <div key={p} className="px-5 py-3">
              <p className="text-xs text-slate-500">{product(p)}</p>
              <p className={`text-lg font-bold tabular-nums ${stock && stock[p].pipas < 0 ? "text-pale-red-foreground" : "text-slate-900"}`}>
                {stock ? fmtPipas(stock[p].pipas) : "…"} <span className="text-xs font-semibold text-slate-400">P-P</span>
              </p>
              {stock && <p className="text-[11px] text-slate-400 tabular-nums">{fmtLiters(stock[p].liters)}</p>}
            </div>
          ))}
        </div>
      </section>

      {/* Every purchase still holding fuel, oldest (in use) first */}
      <section className="space-y-3">
        <div>
          <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest">{t("byPurchase")}</h2>
          <p className="text-[11px] text-slate-500 mt-0.5">{t("byPurchaseHelp")}</p>
        </div>
        {open === null ? <Loader2 className="w-5 h-5 text-slate-300 animate-spin" /> : byFuel.length === 0 && done.length === 0 ? (
          <p className="bg-white border border-slate-100 rounded-xl p-5 text-sm text-slate-500 text-center">{t("none")}</p>
        ) : byFuel.map(({ p, lots }) => {
          const left = lots.reduce((s, l) => s + l.remaining, 0);
          return (
            <div key={p} className="space-y-2" data-testid={`profit-fuel-${p}`}>
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-bold text-slate-900">{product(p)}</p>
                <p className="text-xs text-slate-500 tabular-nums">{t("left", { v: both(left) })}</p>
              </div>
              {/* the fuel's stock split by purchase */}
              <div className="flex h-2.5 rounded-full overflow-hidden bg-slate-100" aria-hidden="true">
                {lots.map((l, i) => (
                  <div key={l.id} className={i === 0 ? "bg-emerald-500" : i % 2 ? "bg-amber-400" : "bg-amber-300"} style={{ width: `${(l.remaining / left) * 100}%` }} />
                ))}
              </div>
              {lots.map((l, i) => <LotCard key={l.id} lot={l} stats={stats[l.id]} state={i === 0 ? "inUse" : "queued"} station={stations[l.station_id ?? ""]} unit={unit} />)}
            </div>
          );
        })}
        {done.length > 0 && (
          <div className="space-y-2">
            <button onClick={() => setShowDone(v => !v)} className="flex items-center gap-1 text-xs font-semibold text-slate-600" aria-expanded={showDone}>
              <ChevronDown className={`w-4 h-4 transition-transform ${showDone ? "" : "-rotate-90"}`} /> {t("finishedN", { n: done.length })}
            </button>
            {showDone && done.map(l => <LotCard key={l.id} lot={l} stats={stats[l.id]} state="finished" station={stations[l.station_id ?? ""]} unit={unit} />)}
          </div>
        )}
      </section>
    </div>
  );
}

/** One purchase, like the old PO card: what's left (bar), what sold, cost, profit on what sold. */
function LotCard({ lot, stats, state, station, unit }: { lot: Lot; stats?: Stats; state: "inUse" | "queued" | "finished"; station?: string; unit: VolUnit }) {
  const t = useT();
  const pct = lot.liters > 0 ? (lot.remaining / lot.liters) * 100 : 0;
  const other: VolUnit = unit === "pp" ? "l" : "pp";
  const profit = (stats?.revenue ?? 0) - (stats?.cost ?? 0);
  const tone = state === "inUse"
    ? { card: "bg-pale-green border-emerald-100", badge: "bg-white/70 text-pale-green-foreground border-emerald-200", dot: "bg-emerald-400", bar: "bg-emerald-500" }
    : state === "queued"
      ? { card: "bg-white border-slate-100", badge: "bg-pale-gold text-pale-gold-foreground border-amber-100", dot: "bg-amber-400", bar: "bg-amber-400" }
      : { card: "bg-white border-slate-100 opacity-80", badge: "bg-slate-100 text-slate-500 border-slate-200", dot: "bg-slate-400", bar: "bg-slate-300" };
  return (
    <div className={`border rounded-xl p-4 space-y-2.5 ${tone.card}`} data-testid="profit-lot">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-900 truncate">{t(`s_${lot.source}` as "s_shop")}{station ? ` · ${station}` : ""}</p>
          <p className="text-xs text-slate-500">{t(`p_${lot.product}`)} · {lot.occurred_on}</p>
        </div>
        <span className={`shrink-0 inline-flex items-center gap-1.5 text-[11px] font-semibold border rounded-full px-2 py-0.5 ${tone.badge}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${tone.dot} ${state === "inUse" ? "animate-pulse" : ""}`} />
          {t(state)}
        </span>
      </div>
      <div>
        <div className="flex justify-between text-xs mb-1">
          <span className="text-slate-500">{t("remaining")}</span>
          <span className="font-bold text-slate-900 tabular-nums">{pct.toFixed(1)}%</span>
        </div>
        <div className="h-2 rounded-full bg-slate-200/70 overflow-hidden">
          <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
        </div>
        <div className="flex justify-between text-xs mt-1 tabular-nums">
          <span className="text-slate-700"><span className="font-semibold">{vol(lot.remaining, unit)}</span> <span className="text-slate-400">({vol(lot.remaining, other)})</span></span>
          <span className="text-slate-500">{t("ofTotal", { v: vol(lot.liters, unit) })}</span>
        </div>
      </div>
      <dl className="text-xs space-y-1">
        <div className="flex justify-between gap-2"><dt className="text-slate-500">{t("sold")}</dt><dd className="tabular-nums text-slate-900">{vol(stats?.sold ?? 0, unit)}</dd></div>
        {(stats?.other ?? 0) > 0.0005 && <div className="flex justify-between gap-2"><dt className="text-slate-500">{t("otherOut")}</dt><dd className="tabular-nums text-slate-900">{vol(stats!.other, unit)}</dd></div>}
        <div className="flex justify-between gap-2">
          <dt className="text-slate-500">{t("costL")}</dt>
          <dd className="tabular-nums text-slate-900 text-right">
            {lot.cost_per_liter == null ? t("noCost") : mmk(lot.cost_per_liter)}
            {lot.fees_per_liter > 0 && lot.price_per_liter != null && <span className="block text-[11px] text-slate-400">{t("costParts", { p: mmk(lot.price_per_liter), f: mmk(lot.fees_per_liter) })}</span>}
          </dd>
        </div>
      </dl>
      <div className={`flex items-center justify-between rounded-xl px-3 py-2 border ${profit >= 0 ? "bg-emerald-50 border-emerald-100" : "bg-red-50 border-red-100"}`}>
        <span className="text-xs font-semibold text-slate-600">{t("lotProfit")}</span>
        <span className={`text-base font-bold tabular-nums ${profit >= 0 ? "text-pale-green-foreground" : "text-pale-red-foreground"}`} data-testid="profit-lot-profit">
          {profit >= 0 ? "+" : "−"}{mmk(Math.abs(profit))}
        </span>
      </div>
    </div>
  );
}

