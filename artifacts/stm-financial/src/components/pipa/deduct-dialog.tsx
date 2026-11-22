import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { PIPA_PRODUCTS, type PipaProduct } from "@/lib/pipa-ledger";
import { mmk, vol, type VolUnit } from "@/lib/units";
import { makeT } from "@/lib/app-i18n";
import PipaModal, { ErrorNote, primaryBtn } from "./modal";

const RECENT_SHIFTS = 100;

const useT = makeT({
  p_92: { en: "Fuel 92", my: "ဓာတ်ဆီ 92" },
  p_95: { en: "Fuel 95", my: "ဓာတ်ဆီ 95" },
  p_PD: { en: "Premium Diesel", my: "ပရီမီယံ ဒီဇယ်" },
  p_D: { en: "Diesel", my: "ဒီဇယ်" },
  title: { en: "Deduct shift sales", my: "ဆိုင်း ရောင်းအား နုတ်ရန်" },
  sub: { en: "The litres sold in these shifts come off P-P stock. Each shift is deducted once.", my: "ဤဆိုင်းများတွင် ရောင်းသော လီတာကို P-P လက်ကျန်မှ နုတ်ပါမည်။ ဆိုင်းတစ်ခုကို တစ်ကြိမ်သာ နုတ်နိုင်သည်။" },
  autoOn: { en: "Automatic deduction is on — new shifts come off as soon as they are submitted. Older or skipped shifts are listed here.", my: "အလိုအလျောက် နုတ်ခြင်း ဖွင့်ထားသည် — ဆိုင်း တင်တာနဲ့ နုတ်ပါသည်။ အရင်ဆိုင်း သို့မဟုတ် ကျန်ခဲ့သော ဆိုင်းများကို ဤနေရာတွင် ပြပါသည်။" },
  needsUpdate: { en: "This needs the latest database update. Run the pp_profit_engine SQL in the Supabase SQL Editor.", my: "နောက်ဆုံး database update လိုပါသည်။ Supabase SQL Editor တွင် pp_profit_engine SQL ကို run ပါ။" },
  nothing: { en: "Every recent shift has been deducted.", my: "မကြာသေးမီ ဆိုင်းအားလုံး နုတ်ပြီးပါပြီ။" },
  willDeduct: { en: "Will be deducted", my: "နုတ်မည့် ပမာဏ" },
  noFuel: { en: "No fuel litres", my: "ဆီ လီတာ မရှိ" },
  avg: { en: "{money} · avg {p}/L", my: "{money} · ပျမ်းမျှ {p}/L" },
  includeShift: { en: "Include shift {when}", my: "{when} ဆိုင်း ထည့်ရန်" },
  deductN: { en: "Deduct {n} shift(s)", my: "ဆိုင်း {n} ခု နုတ်ရန်" },
  changedTitle: { en: "Changed after they were deducted", my: "နုတ်ပြီးနောက် ပြင်ထားသော ဆိုင်းများ" },
  changedHelp: { en: "These shifts were edited after their litres came off stock. Deduct them again with the new figures.", my: "ဤဆိုင်းများကို လက်ကျန်မှ နုတ်ပြီးမှ ပြင်ထားသည်။ ပြင်ထားသော အချက်အလက်ဖြင့် ပြန်နုတ်ပါ။" },
  again: { en: "Deduct again", my: "ပြန်နုတ်ရန်" },
  againDone: { en: "Deducted again with the new figures.", my: "ပြင်ထားသော အချက်အလက်ဖြင့် ပြန်နုတ်ပြီး။" },
  already: { en: "One of these shifts was already deducted (perhaps from another device). Close this and try again.", my: "ဤဆိုင်းများထဲမှ တစ်ခုကို နုတ်ပြီးသား ဖြစ်နေသည် (အခြားစက်မှ ဖြစ်နိုင်)။ ပိတ်ပြီး ထပ်ကြိုးစားပါ။" },
  deducted: { en: "Shift sales deducted from P-P stock.", my: "ဆိုင်း ရောင်းအားကို P-P လက်ကျန်မှ နုတ်ပြီး။" },
});

type Figures = Partial<Record<PipaProduct, number>>;
type Row = { id: string; shift_at: string; employee_name: string | null; liters: Figures; amounts: Figures | null; deducted: boolean; changed: boolean };

const fig = (v: unknown): Figures => {
  const out: Figures = {};
  if (v && typeof v === "object") for (const [k, n] of Object.entries(v as Record<string, unknown>)) if ((PIPA_PRODUCTS as string[]).includes(k)) out[k as PipaProduct] = Number(n) || 0;
  return out;
};

/**
 * Shifts not yet taken off P-P stock (and ones edited since). Everyone on the
 * P-P Ledger sees litres; only owners see the money (the database leaves it
 * out for everyone else).
 */
export default function DeductDialog({ owner, autoOn, unit, onClose, onSaved }: {
  owner: boolean;
  autoOn: boolean;
  unit: VolUnit;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const t = useT();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);
  const [note, setNote] = useState("");
  const other: VolUnit = unit === "pp" ? "l" : "pp";
  const both = (l: number) => `${vol(l, unit)} · ${vol(l, other)}`;

  const load = useCallback(async () => {
    const { data, error: err } = await supabase.rpc("shifts_for_deduction", { p_limit: RECENT_SHIFTS });
    if (err) {
      if (err.code === "PGRST202" || err.code === "42883") setMissing(true); else setError(err.message);
      setRows([]); return;
    }
    const list = ((data ?? []) as Record<string, unknown>[]).map(r => ({
      id: String(r.id), shift_at: String(r.shift_at ?? ""), employee_name: (r.employee_name as string | null) ?? null,
      liters: fig(r.liters), amounts: r.amounts == null ? null : fig(r.amounts), deducted: !!r.deducted, changed: !!r.changed,
    }));
    setRows(list);
    setSelected(new Set(list.filter(r => !r.deducted).map(r => r.id)));
  }, []);
  useEffect(() => { load(); }, [load]);

  const pending = (rows ?? []).filter(r => !r.deducted);
  const changed = (rows ?? []).filter(r => r.deducted && r.changed);
  const totals = useMemo(() => {
    const out = Object.fromEntries(PIPA_PRODUCTS.map(p => [p, { liters: 0, amount: 0 }])) as Record<PipaProduct, { liters: number; amount: number }>;
    for (const r of pending) if (selected.has(r.id)) for (const p of PIPA_PRODUCTS) {
      out[p].liters += r.liters[p] ?? 0; out[p].amount += r.amounts?.[p] ?? 0;
    }
    return out;
  }, [pending, selected]);

  const fmtWhen = (ts: string) => ts
    ? new Date(ts).toLocaleString("en-GB", { timeZone: "Asia/Yangon", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })
    : "—";
  const toggle = (id: string) => setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function deduct() {
    const ids = pending.filter(r => selected.has(r.id)).map(r => r.id);
    if (!ids.length) return;
    setBusy("deduct"); setError("");
    const { error: err } = await supabase.rpc("record_shift_usage", { p_shift_ids: ids });
    setBusy(null);
    if (err) { setError(err.code === "23505" ? t("already") : err.message); return; }
    onSaved(t("deducted"));
  }

  async function again(id: string) {
    setBusy(id); setError(""); setNote("");
    const { error: err } = await supabase.rpc("rededuct_shift", { p_shift_id: id });
    setBusy(null);
    if (err) { setError(err.message); return; }
    setNote(t("againDone"));
    load();
  }

  const used = PIPA_PRODUCTS.filter(p => totals[p].liters > 0);
  const product = (p: PipaProduct) => t(`p_${p}`);
  return (
    <PipaModal
      title={t("title")}
      subtitle={t("sub")}
      onClose={onClose}
      footer={pending.length > 0 && !missing ? (
        <button type="button" onClick={deduct} disabled={!!busy || selected.size === 0} className={primaryBtn} data-testid="deduct-go">
          {busy === "deduct" && <Loader2 className="w-4 h-4 animate-spin" />}
          {t("deductN", { n: selected.size })}
        </button>
      ) : undefined}
    >
      {missing ? <ErrorNote>{t("needsUpdate")}</ErrorNote> : rows === null ? (
        <div className="py-8 text-center"><Loader2 className="w-6 h-6 text-blue-500/50 animate-spin mx-auto" /></div>
      ) : (
        <>
          {autoOn && <p className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2" data-testid="deduct-auto">{t("autoOn")}</p>}
          {changed.length > 0 && (
            <div className="border border-amber-200 bg-amber-50 rounded-xl p-3 space-y-2" data-testid="deduct-changed">
              <p className="text-sm font-semibold text-amber-800">{t("changedTitle")}</p>
              <p className="text-xs text-amber-800">{t("changedHelp")}</p>
              {changed.map(r => (
                <div key={r.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 text-sm text-slate-900 truncate">{fmtWhen(r.shift_at)} · <span className="capitalize">{r.employee_name || "—"}</span></span>
                  <button type="button" onClick={() => again(r.id)} disabled={!!busy}
                    className="shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-amber-600 rounded-lg px-2.5 py-1.5">
                    {busy === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} {t("again")}
                  </button>
                </div>
              ))}
            </div>
          )}
          {note && <p className="text-xs font-medium text-pale-green-foreground" role="status">{note}</p>}
          {pending.length === 0 ? (
            changed.length === 0 && !error && <p className="text-sm text-slate-500 text-center py-6">{t("nothing")}</p>
          ) : (
            <>
              <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 space-y-2" data-testid="deduct-totals">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("willDeduct")}</p>
                {used.length === 0 ? <p className="text-sm text-slate-500">{t("noFuel")}</p> : used.map(p => (
                  <div key={p} className="text-sm">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-semibold text-slate-900">{product(p)}</span>
                      <span className="font-bold text-slate-900 tabular-nums">{both(totals[p].liters)}</span>
                    </div>
                    {owner && totals[p].amount > 0 && (
                      <p className="text-xs text-slate-500 tabular-nums">{t("avg", { money: mmk(totals[p].amount), p: mmk(totals[p].amount / totals[p].liters) })}</p>
                    )}
                  </div>
                ))}
              </div>
              <div className="divide-y divide-slate-100 border border-slate-100 rounded-xl">
                {pending.map(r => {
                  const parts = PIPA_PRODUCTS.filter(p => (r.liters[p] ?? 0) > 0);
                  return (
                    <label key={r.id} className="flex items-start gap-3 px-3 py-2.5 cursor-pointer">
                      <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)}
                        className="mt-1 w-4 h-4 accent-blue-600" aria-label={t("includeShift", { when: fmtWhen(r.shift_at) })} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-900">{fmtWhen(r.shift_at)} · <span className="capitalize">{r.employee_name || "—"}</span></p>
                        {parts.length === 0 ? <p className="text-xs text-slate-500">{t("noFuel")}</p> : parts.map(p => (
                          <p key={p} className="text-xs text-slate-500 tabular-nums">
                            {product(p)}: {vol(r.liters[p] ?? 0, unit)}
                            {owner && r.amounts?.[p] ? ` @ ${mmk((r.amounts[p] ?? 0) / (r.liters[p] ?? 1))}/L` : ""}
                          </p>
                        ))}
                      </div>
                    </label>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
    </PipaModal>
  );
}
