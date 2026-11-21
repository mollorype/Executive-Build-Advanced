import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Archive, Calculator, Loader2, PackagePlus, TrendingUp } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { makeT } from "@/lib/app-i18n";
import { usePPSettings } from "@/lib/pp-settings";
import { mmk, readUnit, saveUnit, vol, type VolUnit } from "@/lib/units";
import { PIPA_PRODUCTS, yangonToday, type MovementKind, type PipaProduct } from "@/lib/pipa-ledger";
import { usePipaT, pipaKind } from "@/lib/pipa-i18n";

const useT = makeT({
  title: { en: "Profit", my: "အမြတ်" },
  subtitle: { en: "Owners only · worked out from P-P purchases and each day's sales", my: "ပိုင်ရှင်သာ · P-P အဝယ် နှင့် နေ့စဉ် ရောင်းအားမှ တွက်သည်" },
  p_92: { en: "Fuel 92", my: "ဓာတ်ဆီ 92" },
  p_95: { en: "Fuel 95", my: "ဓာတ်ဆီ 95" },
  p_PD: { en: "Premium Diesel", my: "ပရီမီယံ ဒီဇယ်" },
  p_D: { en: "Diesel", my: "ဒီဇယ်" },
  today: { en: "Today", my: "ယနေ့" },
  week: { en: "This week", my: "ဤအပတ်" },
  month: { en: "This month", my: "ဤလ" },
  lastMonth: { en: "Last month", my: "ပြီးခဲ့သည့်လ" },
  custom: { en: "Dates", my: "ရက်ရွေး" },
  from: { en: "From", my: "မှ" },
  to: { en: "To", my: "အထိ" },
  calc: { en: "Calculate profit", my: "အမြတ် တွက်ရန်" },
  calcHelp: { en: "Profit is only worked out when you ask. Choose a period and tap Calculate.", my: "တောင်းမှသာ အမြတ် တွက်ပါသည်။ ကာလ ရွေးပြီး တွက်ရန် ကို နှိပ်ပါ။" },
  profit: { en: "Profit", my: "အမြတ်" },
  sales: { en: "Sales", my: "ရောင်းရငွေ" },
  fuelCost: { en: "Fuel cost", my: "ဆီ ကုန်ကျ" },
  losses: { en: "Count shortages", my: "စစ်ဆေးချက် လို" },
  used: { en: "Used (not sold)", my: "သုံးစွဲ (မရောင်း)" },
  settle: { en: "Borrow settlements", my: "ချေးယူမှု ရှင်းခြင်း" },
  sold: { en: "Sold", my: "ရောင်း" },
  margin: { en: "{p}/L profit · sold at {s}/L · cost {c}/L", my: "လီတာ အမြတ် {p} · ရောင်း {s}/L · ကုန်ကျ {c}/L" },
  unpriced: { en: "{v} were sold with no purchase price on record (no P-P bought for them), so their cost isn't counted. Record the purchase or opening stock.", my: "{v} ကို ဝယ်စျေး မှတ်တမ်း မရှိဘဲ ရောင်းခဲ့သဖြင့် ကုန်ကျ မပါပါ။ အဝယ် သို့မဟုတ် စတင်လက်ကျန် ထည့်ပါ။" },
  byFuel: { en: "By fuel", my: "ဆီအလိုက်" },
  byDay: { en: "By day", my: "နေ့အလိုက်" },
  nothing: { en: "No sales or stock changes in this period.", my: "ဤကာလတွင် အရောင်း သို့မဟုတ် လက်ကျန် ပြောင်းလဲမှု မရှိပါ။" },
  purchases: { en: "Purchases and stock in", my: "အဝယ် နှင့် ဝင်လာသော လက်ကျန်" },
  purchasesEmpty: { en: "Nothing recorded yet. Purchases come from the P-P Ledger.", my: "မှတ်တမ်း မရှိသေးပါ။ အဝယ်များကို P-P စာရင်းမှ မှတ်ပါ။" },
  left: { en: "{v} left", my: "ကျန် {v}" },
  costL: { en: "{c}/L", my: "{c}/L" },
  noCost: { en: "no price", my: "စျေး မရှိ" },
  s_shop: { en: "Shop purchase", my: "ဆိုင်မှ ဝယ်" },
  s_official: { en: "Official purchase", my: "တရားဝင် အဝယ်" },
  s_borrow: { en: "Borrowed", my: "ချေးယူ" },
  s_lend_return: { en: "Returned to us", my: "ပြန်ရ" },
  s_count_gain: { en: "Count: extra", my: "စစ်ဆေးချက်: ပို" },
  s_opening: { en: "Opening stock", my: "စတင်လက်ကျန်" },
  archive: { en: "Deleted (archive)", my: "ဖျက်ထားသည်များ (မှတ်တမ်းဟောင်း)" },
  archiveHelp: { en: "Every deleted P-P line and undone shift deduction, with the reason. Only owners see this.", my: "ဖျက်ထားသော P-P စာကြောင်း နှင့် ပြန်ဖျက်ထားသော ဆိုင်း နုတ်ချက်အားလုံး၊ အကြောင်းပြချက်နှင့်တကွ။ ပိုင်ရှင်သာ မြင်ရသည်။" },
  archiveEmpty: { en: "Nothing has been deleted.", my: "ဖျက်ထားသည် မရှိပါ။" },
  reason: { en: "Reason: {r}", my: "အကြောင်းပြချက်: {r}" },
  byWhen: { en: "{who} · {when}", my: "{who} · {when}" },
  needsUpdate: { en: "This needs the latest database update. Run the pp_profit_engine SQL in the Supabase SQL Editor.", my: "နောက်ဆုံး database update လိုပါသည်။ Supabase SQL Editor တွင် pp_profit_engine SQL ကို run ပါ။" },
  shiftUndo: { en: "Shift deduction undone", my: "ဆိုင်း နုတ်ချက် ပြန်ဖျက်" },
});

type Totals = { liters: number; revenue: number; cost: number; settle: number; loss: number; used: number; unpriced: number; profit: number };
type ProductRow = { product: PipaProduct; liters: number; revenue: number; cost: number; profit: number; loss: number; unpriced: number };
type DayRow = { day: string; liters: number; revenue: number; cost: number; profit: number };
type Result = { from: string; to: string; totals: Totals; products: ProductRow[]; days: DayRow[] };
type Lot = { id: string; product: PipaProduct; source: string; station_id: string | null; occurred_on: string; liters: number; remaining: number; price_per_liter: number | null; fees_per_liter: number; cost_per_liter: number | null };
type ArchiveRow = { id: string; kind: "movement" | "shift"; summary: string; snapshot: Record<string, unknown>; reason: string; archived_by: string | null; archived_at: string };
type Period = "today" | "week" | "month" | "lastMonth" | "custom";

const n = (v: unknown) => Number(v) || 0;
const pad = (x: number) => String(x).padStart(2, "0");
const isoOf = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** The dates of a preset period, in Yangon days. */
export function periodRange(p: Exclude<Period, "custom">, today = yangonToday()): { from: string; to: string } {
  const d = new Date(`${today}T00:00:00Z`);
  if (p === "today") return { from: today, to: today };
  if (p === "week") {
    const back = (d.getUTCDay() + 6) % 7;   // Monday first
    const from = new Date(d); from.setUTCDate(d.getUTCDate() - back);
    return { from: isoOf(from), to: today };
  }
  if (p === "month") return { from: `${today.slice(0, 8)}01`, to: today };
  const from = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  const to = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0));
  return { from: isoOf(from), to: isoOf(to) };
}

const signed = (v: number) => `${v >= 0 ? "+" : "−"}${mmk(Math.abs(v))}`;

export default function ProfitPage() {
  const t = useT();
  const tp = usePipaT();
  const { settings, state: settingsState } = usePPSettings();
  const [unit, setUnit] = useState<VolUnit>(readUnit);
  const [period, setPeriod] = useState<Period>("month");
  const [from, setFrom] = useState(periodRange("month").from);
  const [to, setTo] = useState(periodRange("month").to);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lots, setLots] = useState<Lot[] | null>(null);
  const [stations, setStations] = useState<Record<string, string>>({});
  const [archive, setArchive] = useState<ArchiveRow[] | null>(null);
  const [autoDone, setAutoDone] = useState(false);

  const product = (p: string) => ((PIPA_PRODUCTS as string[]).includes(p) ? t(`p_${p as PipaProduct}`) : p);
  const pick = (p: Period) => {
    setPeriod(p); setResult(null);
    if (p !== "custom") { const r = periodRange(p); setFrom(r.from); setTo(r.to); }
  };

  const calculate = useCallback(async (f = from, tt = to) => {
    setBusy(true); setError("");
    const { data, error: err } = await supabase.rpc("pp_profit", { p_from: f, p_to: tt });
    setBusy(false);
    if (err) { setError(err.code === "PGRST202" || err.code === "42883" ? t("needsUpdate") : err.message); return; }
    const r = data as Result;
    setResult({ ...r, totals: Object.fromEntries(Object.entries(r.totals ?? {}).map(([k, v]) => [k, n(v)])) as Totals });
  }, [from, to, t]);

  // "Calculate automatically" in Settings: open with this week / month done.
  useEffect(() => {
    if (autoDone || settingsState === "loading") return;
    setAutoDone(true);
    if (settings.profit_auto === "week" || settings.profit_auto === "month") {
      const r = periodRange(settings.profit_auto);
      setPeriod(settings.profit_auto); setFrom(r.from); setTo(r.to);
      calculate(r.from, r.to);
    }
  }, [settings.profit_auto, settingsState, autoDone, calculate]);

  useEffect(() => {
    (async () => {
      const [l, s, a] = await Promise.all([
        supabase.from("pp_lots").select("*").order("occurred_on", { ascending: false }).order("created_at", { ascending: false }).limit(60),
        supabase.from("pipa_stations").select("id, name"),
        supabase.from("pp_archive").select("id, kind, summary, snapshot, reason, archived_by, archived_at").order("archived_at", { ascending: false }).limit(60),
      ]);
      setLots(l.error ? [] : ((l.data ?? []) as Lot[]).map(x => ({ ...x, liters: n(x.liters), remaining: n(x.remaining), fees_per_liter: n(x.fees_per_liter),
        price_per_liter: x.price_per_liter == null ? null : n(x.price_per_liter), cost_per_liter: x.cost_per_liter == null ? null : n(x.cost_per_liter) })));
      setStations(Object.fromEntries(((s.data ?? []) as { id: string; name: string }[]).map(x => [x.id, x.name])));
      setArchive(a.error ? [] : (a.data ?? []) as ArchiveRow[]);
    })();
  }, []);

  const tot = result?.totals;
  const empty = !!result && result.days.length === 0;
  const switchUnit = (u: VolUnit) => { setUnit(u); saveUnit(u); };
  const fmtDay = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
  const fmtWhen = (s: string) => new Date(s).toLocaleString("en-GB", { timeZone: "Asia/Yangon", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  const archiveText = (a: ArchiveRow) => {
    if (a.kind === "shift") return `${t("shiftUndo")} · ${a.summary.replace(/^Shift sales deduction · /, "")}`;
    const s = a.snapshot;
    const kind = String(s.kind) as MovementKind;
    return `${pipaKind(tp, kind) || kind} · ${n(s.pipas)} P-P · ${product(String(s.product))}${s.station_name ? ` · ${String(s.station_name)}` : ""} · ${String(s.occurred_on)}`;
  };

  const chip = (on: boolean) => `px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${on ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-200"}`;
  const card = "bg-white border border-slate-100 rounded-xl p-4";

  return (
    <div className="flex-1 overflow-auto bg-slate-50">
      <div className="px-4 md:px-6 py-5 border-b border-slate-100 bg-white flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t("title")}</h1>
          <p className="text-slate-400 text-sm mt-0.5">{t("subtitle")}</p>
        </div>
        <span className="inline-flex rounded-lg bg-slate-100 p-0.5 text-xs font-semibold" role="group">
          {(["pp", "l"] as const).map(u => (
            <button key={u} type="button" onClick={() => switchUnit(u)} aria-pressed={unit === u}
              className={`px-3 py-1 rounded-md ${unit === u ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>{u === "pp" ? "P-P" : "L"}</button>
          ))}
        </span>
      </div>

      <div className="p-4 md:p-6 space-y-5 max-w-4xl">
        {/* Period + calculate */}
        <section className={`${card} space-y-3`}>
          <div className="flex flex-wrap gap-2">
            {(["today", "week", "month", "lastMonth", "custom"] as const).map(p => (
              <button key={p} type="button" onClick={() => pick(p)} className={chip(period === p)} aria-pressed={period === p}>{t(p)}</button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-semibold text-slate-500">{t("from")}
              <input type="date" value={from} max={to} onChange={e => { setFrom(e.target.value); setPeriod("custom"); setResult(null); }}
                className="mt-1 w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900" data-testid="profit-from" />
            </label>
            <label className="text-xs font-semibold text-slate-500">{t("to")}
              <input type="date" value={to} min={from} onChange={e => { setTo(e.target.value); setPeriod("custom"); setResult(null); }}
                className="mt-1 w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900" data-testid="profit-to" />
            </label>
          </div>
          <button type="button" onClick={() => calculate()} disabled={busy || !from || !to || to < from} data-testid="profit-calc"
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold rounded-xl px-4 py-2.5 text-sm">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4" />} {t("calc")}
          </button>
          {!result && !busy && !error && <p className="text-xs text-slate-500">{t("calcHelp")}</p>}
          {error && <p role="alert" className="text-sm text-pale-red-foreground">{error}</p>}
        </section>

        {/* Result */}
        {result && tot && (
          <section className="space-y-3" data-testid="profit-result">
            <div className={`${card} flex items-center gap-4`}>
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${tot.profit >= 0 ? "bg-pale-green" : "bg-pale-red"}`}>
                <TrendingUp className={`w-5 h-5 ${tot.profit >= 0 ? "text-pale-green-foreground" : "text-pale-red-foreground"}`} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("profit")} · {fmtDay(result.from)} – {fmtDay(result.to)}</p>
                <p className={`text-2xl font-bold tabular-nums ${tot.profit >= 0 ? "text-pale-green-foreground" : "text-pale-red-foreground"}`} data-testid="profit-total">{signed(tot.profit)}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className={card}><p className="text-xs text-slate-500">{t("sales")}</p><p className="text-lg font-bold text-slate-900 tabular-nums" data-testid="profit-sales">{mmk(tot.revenue)}</p>
                <p className="text-xs text-slate-500 tabular-nums">{t("sold")} {vol(tot.liters, unit)}</p></div>
              <div className={card}><p className="text-xs text-slate-500">{t("fuelCost")}</p><p className="text-lg font-bold text-slate-900 tabular-nums" data-testid="profit-cost">− {mmk(tot.cost)}</p></div>
              {Math.abs(tot.loss) >= 0.5 && <div className={card}><p className="text-xs text-slate-500">{t("losses")}</p><p className="text-lg font-bold text-pale-red-foreground tabular-nums">− {mmk(tot.loss)}</p></div>}
              {Math.abs(tot.used) >= 0.5 && <div className={card}><p className="text-xs text-slate-500">{t("used")}</p><p className="text-lg font-bold text-slate-900 tabular-nums">− {mmk(tot.used)}</p></div>}
              {Math.abs(tot.settle) >= 0.5 && <div className={card}><p className="text-xs text-slate-500">{t("settle")}</p><p className="text-lg font-bold text-slate-900 tabular-nums">{signed(-tot.settle)}</p></div>}
            </div>
            {tot.unpriced > 0 && (
              <p className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2" data-testid="profit-unpriced">
                <AlertTriangle className="w-4 h-4 shrink-0" /> {t("unpriced", { v: vol(tot.unpriced, unit) })}
              </p>
            )}
            {empty ? <p className={`${card} text-sm text-slate-500 text-center`}>{t("nothing")}</p> : (
              <>
                <div className={card}>
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">{t("byFuel")}</p>
                  <ul className="divide-y divide-slate-100" data-testid="profit-fuels">
                    {result.products.filter(r => n(r.liters) > 0 || Math.abs(n(r.profit)) >= 0.5).map(r => {
                      const l = n(r.liters);
                      return (
                        <li key={r.product} className="py-2 text-sm">
                          <div className="flex justify-between gap-2"><span className="font-semibold text-slate-900">{product(r.product)}</span>
                            <span className={`font-bold tabular-nums ${n(r.profit) >= 0 ? "text-pale-green-foreground" : "text-pale-red-foreground"}`}>{signed(n(r.profit))}</span></div>
                          {l > 0 && <p className="text-xs text-slate-500 tabular-nums">{vol(l, unit)} · {t("margin", { p: mmk(n(r.profit) / l), s: mmk(n(r.revenue) / l), c: mmk(n(r.cost) / l) })}</p>}
                        </li>
                      );
                    })}
                  </ul>
                </div>
                {result.days.length > 1 && (
                  <div className={card}>
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">{t("byDay")}</p>
                    <ul className="divide-y divide-slate-100" data-testid="profit-days">
                      {result.days.map(d => (
                        <li key={d.day} className="py-2 flex items-baseline justify-between gap-2 text-sm">
                          <span className="text-slate-700">{fmtDay(d.day)} <span className="text-xs text-slate-400 tabular-nums">· {vol(n(d.liters), unit)} · {mmk(n(d.revenue))}</span></span>
                          <span className={`font-semibold tabular-nums ${n(d.profit) >= 0 ? "text-pale-green-foreground" : "text-pale-red-foreground"}`}>{signed(n(d.profit))}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {/* Purchases / stock in */}
        <section className={card}>
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900 mb-2"><PackagePlus className="w-4 h-4 text-pale-blue-foreground" /> {t("purchases")}</h2>
          {lots === null ? <Loader2 className="w-5 h-5 text-slate-300 animate-spin" /> : lots.length === 0 ? (
            <p className="text-sm text-slate-500">{t("purchasesEmpty")}</p>
          ) : (
            <ul className="divide-y divide-slate-100" data-testid="profit-lots">
              {lots.map(l => (
                <li key={l.id} className="py-2 text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="min-w-0 truncate"><span className="font-semibold text-slate-900">{t(`s_${l.source}` as "s_shop")}</span> · {product(l.product)}{l.station_id && stations[l.station_id] ? ` · ${stations[l.station_id]}` : ""}</span>
                    <span className="shrink-0 font-semibold tabular-nums text-slate-900">{l.cost_per_liter == null ? t("noCost") : t("costL", { c: mmk(l.cost_per_liter) })}</span>
                  </div>
                  <p className="text-xs text-slate-500 tabular-nums">{l.occurred_on} · {vol(l.liters, unit)} · {t("left", { v: vol(l.remaining, unit) })}
                    {l.fees_per_liter > 0 && l.price_per_liter != null ? ` · ${mmk(l.price_per_liter)} + ${mmk(l.fees_per_liter)}` : ""}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Archive */}
        <section className={card}>
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900 mb-1"><Archive className="w-4 h-4 text-pale-blue-foreground" /> {t("archive")}</h2>
          <p className="text-xs text-slate-500 mb-2">{t("archiveHelp")}</p>
          {archive === null ? <Loader2 className="w-5 h-5 text-slate-300 animate-spin" /> : archive.length === 0 ? (
            <p className="text-sm text-slate-500">{t("archiveEmpty")}</p>
          ) : (
            <ul className="divide-y divide-slate-100" data-testid="profit-archive">
              {archive.map(a => (
                <li key={a.id} className="py-2 text-sm">
                  <p className="text-slate-900 break-words">{archiveText(a)}</p>
                  <p className="text-xs text-slate-600 break-words">{t("reason", { r: a.reason })}</p>
                  <p className="text-[11px] text-slate-400">{t("byWhen", { who: a.archived_by ?? "—", when: fmtWhen(a.archived_at) })}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
