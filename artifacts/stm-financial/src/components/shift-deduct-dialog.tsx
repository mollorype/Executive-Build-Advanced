import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase, mapRowToShift, type FuelPurchaseOrder, type Shift } from "@/lib/supabase";
import { PO_PRODUCTS, deductionRows, shiftSales, type POProduct } from "@/lib/po-usage";
import { mmk, vol, type VolUnit } from "@/lib/po-units";
import { makeT } from "@/lib/app-i18n";
import { messageDialog } from "@/components/confirm-dialog";
import PipaModal, { ErrorNote, primaryBtn } from "@/components/pipa/modal";

const RECENT_SHIFTS = 100;

const useT = makeT({
  p_92: { en: "92 RON", my: "92 RON" },
  p_95: { en: "95 RON", my: "95 RON" },
  p_PD: { en: "PD (Premium Diesel)", my: "PD (ပရီမီယံ ဒီဇယ်)" },
  p_D: { en: "Diesel", my: "ဒီဇယ်" },
  title: { en: "Deduct shift sales", my: "ဆိုင်း ရောင်းအား နုတ်ရန်" },
  sub: { en: "Litres sold in these shifts come off P-P stock and the POs together — the oldest PO first, with that day's selling price. Each shift is deducted once.", my: "ဤဆိုင်းများတွင် ရောင်းသော လီတာကို P-P လက်ကျန် နှင့် PO များမှ တပြိုင်နက် နုတ်ပါမည် — PO အဟောင်းဆုံးမှ စ၍၊ ထိုနေ့ ရောင်းစျေးဖြင့်။ ဆိုင်းတစ်ခုကို တစ်ကြိမ်သာ နုတ်နိုင်သည်။" },
  notInstalled: { en: "This needs the latest database update. Run the manager_shared_pp_po SQL in the Supabase SQL Editor.", my: "နောက်ဆုံး database update လိုပါသည်။ Supabase SQL Editor တွင် manager_shared_pp_po SQL ကို run ပါ။" },
  allDeducted: { en: "Every recent shift has already been deducted.", my: "မကြာသေးမီ ဆိုင်းအားလုံး နုတ်ပြီးပါပြီ။" },
  willDeduct: { en: "Will be deducted", my: "နုတ်မည့် ပမာဏ" },
  avgPrice: { en: "avg {p}/L", my: "ပျမ်းမျှ {p}/L" },
  inPOs: { en: "left in POs: {v}", my: "PO တွင် ကျန်: {v}" },
  overPOs: { en: "More than the POs hold — the extra {v} comes off P-P stock only.", my: "PO တွင် ကျန်သည်ထက် များနေသည် — အပို {v} ကို P-P လက်ကျန်မှသာ နုတ်ပါမည်။" },
  noOpenPO: { en: "No open PO — the litres will come off P-P stock only.", my: "ဖွင့်ထားသော PO မရှိပါ — လီတာများကို P-P လက်ကျန်မှသာ နုတ်ပါမည်။" },
  beforePOs: { en: "Shifts from before your oldest open PO ({date}) are not ticked.", my: "PO အဟောင်းဆုံး ({date}) မတိုင်မီ ဆိုင်းများကို မရွေးထားပါ။" },
  beforePOsStaff: { en: "Shifts from before the oldest open PO are not ticked — their sales weren't from those POs.", my: "ဖွင့်ထားသော PO အဟောင်းဆုံး မတိုင်မီ ဆိုင်းများကို မရွေးထားပါ — ထို PO များမှ ရောင်းခဲ့ခြင်း မဟုတ်ပါ။" },
  includeShift: { en: "Include shift {when}", my: "{when} ဆိုင်း ထည့်ရန်" },
  noFuel: { en: "No fuel litres", my: "ဆီ လီတာ မရှိ" },
  deductN: { en: "Deduct {n} shift(s)", my: "ဆိုင်း {n} ခု နုတ်ရန်" },
  alreadyDeducted: { en: "One of these shifts was already deducted (perhaps from another device). Close this and try again.", my: "ဤဆိုင်းများထဲမှ တစ်ခုကို နုတ်ပြီးသား ဖြစ်နေသည် (အခြားစက်မှ ဖြစ်နိုင်)။ ပိတ်ပြီး ထပ်ကြိုးစားပါ။" },
  deducted: { en: "Shift sales deducted from P-P stock and the POs.", my: "ဆိုင်း ရောင်းအားကို P-P လက်ကျန် နှင့် PO များမှ နုတ်ပြီး။" },
  unallocated: { en: "Deducted, but {list} had no PO left (it came off P-P stock only). Add a PO, then undo this deduction and deduct again.", my: "နုတ်ပြီး၊ သို့သော် {list} အတွက် PO မကျန်တော့ပါ (P-P လက်ကျန်မှသာ နုတ်ခဲ့သည်)။ PO ထည့်ပြီး ဤနုတ်ချက်ကို ပြန်ဖျက်ကာ ထပ်နုတ်ပါ။" },
  unallocatedStaff: { en: "Deducted from P-P stock, but {list} had no PO left to take it. Let the owner know.", my: "P-P လက်ကျန်မှ နုတ်ပြီး၊ သို့သော် {list} အတွက် PO မကျန်တော့ပါ။ ပိုင်ရှင်ကို အသိပေးပါ။" },
});

type Sales = Record<POProduct, { liters: number; amount: number }>;
type Row = { shift: Shift; sales: Sales; beforeOpenPOs: boolean };

/**
 * Never automatic: lists recent shifts not yet deducted and, when someone
 * presses the button, the database takes their litres off P-P stock and off
 * the POs of each fuel (oldest first, recording each day's selling price) in
 * one step. Used by the P-P Ledger (owners, accountants, managers) and the PO
 * Registry (owners). Only owners see what is left in the POs.
 */
export default function ShiftDeductDialog({ unit, owner, onClose, onSaved }: {
  unit: VolUnit;
  owner: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const t = useT();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [open, setOpen] = useState<FuelPurchaseOrder[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);
  const product = (p: string) => (PO_PRODUCTS as readonly string[]).includes(p) ? t(`p_${p as POProduct}`) : p;
  const other: VolUnit = unit === "pp" ? "l" : "pp";
  const both = (liters: number) => `${vol(liters, unit)} · ${vol(liters, other)}`;

  useEffect(() => {
    (async () => {
      const [list, pos] = await Promise.all([
        supabase.rpc("shifts_for_deduction", { p_limit: RECENT_SHIFTS }),
        owner
          ? supabase.from("fuel_purchase_orders").select("*").neq("status", "DONE").is("shortage_liters", null)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (list.error) {
        if (list.error.code === "PGRST202" || list.error.code === "42883") setMissing(true);
        else setError(list.error.message);
        setRows([]);
        return;
      }
      if (pos.error) { setError(pos.error.message); setRows([]); return; }
      const pending = ((list.data ?? []) as { id: string; shift_at: string; employee_name: string | null; fuel_data: unknown; deducted: boolean; before_open_pos: boolean }[])
        .filter(r => !r.deducted)
        .map(r => {
          const shift = mapRowToShift({ id: r.id, timestamp: r.shift_at, employee_name: r.employee_name, fuel_data: r.fuel_data });
          return {
            shift,
            beforeOpenPOs: !!r.before_open_pos,
            sales: Object.fromEntries(PO_PRODUCTS.map(p => [p, shiftSales(shift, p)])) as Sales,
          };
        });
      setOpen((pos.data ?? []) as FuelPurchaseOrder[]);
      setRows(pending);
      // Older sales weren't from the open POs, so those shifts start unticked.
      setSelected(new Set(pending.filter(r => !r.beforeOpenPOs).map(r => r.shift.id)));
    })();
  }, [owner]);

  const since = useMemo(() => open.reduce<string | null>((m, p) => (!m || p.created_at < m ? p.created_at : m), null), [open]);
  const totals = useMemo(() => {
    const out = Object.fromEntries(PO_PRODUCTS.map(p => [p, { liters: 0, amount: 0 }])) as Sales;
    for (const r of rows ?? []) if (selected.has(r.shift.id)) for (const p of PO_PRODUCTS) {
      out[p].liters += r.sales[p].liters; out[p].amount += r.sales[p].amount;
    }
    return out;
  }, [rows, selected]);
  // What the open POs can still take, in litres sold (remaining ÷ calibration). Owners only.
  const capacity = useMemo(() => {
    const out = Object.fromEntries(PO_PRODUCTS.map(p => [p, 0])) as Record<POProduct, number>;
    for (const po of open) if (po.product_type in out) out[po.product_type as POProduct] += Number(po.remaining_volume) / (Number(po.calibration_factor) || 1);
    return out;
  }, [open]);

  const fmtWhen = (ts: string) => ts
    ? new Date(ts).toLocaleString("en-GB", { timeZone: "Asia/Yangon", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })
    : "—";
  const fmtDate = (ts: string) => new Date(ts).toLocaleDateString("en-GB", { timeZone: "Asia/Yangon", day: "numeric", month: "short", year: "numeric" });

  function toggle(id: string) {
    setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  async function deduct() {
    const chosen = (rows ?? []).filter(r => selected.has(r.shift.id)).map(r => r.shift);
    if (chosen.length === 0) return;
    setBusy(true); setError("");
    const { data, error: err } = await supabase.rpc("record_shift_usage", { p_rows: deductionRows(chosen) });
    setBusy(false);
    if (err) {
      if (err.code === "PGRST202" || err.code === "42883") setMissing(true);
      else setError(err.code === "23505" ? t("alreadyDeducted") : err.message);
      return;
    }
    const left = Object.entries(((data as { unallocated?: Record<string, number> } | null)?.unallocated) ?? {}).filter(([, v]) => Number(v) > 0);
    if (left.length) {
      const list = left.map(([p, v]) => `${product(p)} ${vol(Number(v), unit)}`).join(", ");
      await messageDialog(t(owner ? "unallocated" : "unallocatedStaff", { list }));
    }
    onSaved(t("deducted"));
  }

  const used = PO_PRODUCTS.filter(p => totals[p].liters > 0);
  const anyBefore = (rows ?? []).some(r => r.beforeOpenPOs);
  return (
    <PipaModal
      title={t("title")}
      subtitle={t("sub")}
      onClose={onClose}
      footer={rows && rows.length > 0 && !missing ? (
        <button type="button" onClick={deduct} disabled={busy || selected.size === 0} className={primaryBtn} data-testid="deduct-go">
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          {t("deductN", { n: selected.size })}
        </button>
      ) : undefined}
    >
      {missing ? (
        <ErrorNote>{t("notInstalled")}</ErrorNote>
      ) : rows === null ? (
        <div className="py-8 text-center"><Loader2 className="w-6 h-6 text-blue-500/50 animate-spin mx-auto" /></div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-500 text-center py-6">{error ? "" : t("allDeducted")}</p>
      ) : (
        <>
          <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 space-y-2" data-testid="deduct-totals">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("willDeduct")}</p>
            {used.length === 0 ? <p className="text-sm text-slate-500">{t("noFuel")}</p> : used.map(p => {
              const over = totals[p].liters - capacity[p];
              return (
                <div key={p} className="text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold text-slate-900">{product(p)}</span>
                    <span className="font-bold text-slate-900 tabular-nums">{both(totals[p].liters)}</span>
                  </div>
                  <p className="text-xs text-slate-500 tabular-nums">
                    {mmk(totals[p].amount)} · {t("avgPrice", { p: mmk(totals[p].amount / totals[p].liters) })}
                    {owner && <> · {t("inPOs", { v: vol(capacity[p], unit) })}</>}
                  </p>
                  {owner && open.length > 0 && over > 0.001 && <p className="text-xs font-semibold text-amber-700">{t("overPOs", { v: vol(over, unit) })}</p>}
                </div>
              );
            })}
          </div>
          {owner && open.length === 0 && <p className="text-xs font-semibold text-amber-700">{t("noOpenPO")}</p>}
          {anyBefore && (
            <p className="text-[11px] text-slate-500">{owner && since ? t("beforePOs", { date: fmtDate(since) }) : t("beforePOsStaff")}</p>
          )}
          <div className="divide-y divide-slate-100 border border-slate-100 rounded-xl">
            {rows.map(({ shift, sales }) => {
              const parts = PO_PRODUCTS.filter(p => sales[p].liters > 0);
              return (
                <label key={shift.id} className="flex items-start gap-3 px-3 py-2.5 cursor-pointer">
                  <input type="checkbox" checked={selected.has(shift.id)} onChange={() => toggle(shift.id)}
                    className="mt-1 w-4 h-4 accent-blue-600" aria-label={t("includeShift", { when: fmtWhen(shift.created_at) })} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900">{fmtWhen(shift.created_at)} · <span className="capitalize">{shift.employee_username || "—"}</span></p>
                    {parts.length === 0
                      ? <p className="text-xs text-slate-500">{t("noFuel")}</p>
                      : parts.map(p => (
                        <p key={p} className="text-xs text-slate-500 tabular-nums">
                          {product(p)}: {vol(sales[p].liters, unit)} @ {mmk(sales[p].amount / sales[p].liters)}/L
                        </p>
                      ))}
                  </div>
                </label>
              );
            })}
          </div>
        </>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
    </PipaModal>
  );
}
