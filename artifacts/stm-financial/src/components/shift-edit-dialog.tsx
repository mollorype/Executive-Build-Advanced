import { useState } from "react";
import { X, Save, AlertTriangle, CalendarDays, Plus } from "lucide-react";
import { Shift, ExpenseItem, updateShift, updateDebtTransactionDates } from "@/lib/supabase";

type Props = {
  shift: Shift;
  onClose: () => void;
  onSaved: () => void;
};

function n(v: string): number {
  const x = parseFloat(v.replace(/,/g, ""));
  return isNaN(x) ? 0 : x;
}

function fmtInput(v: number | null | undefined): string {
  if (v == null || v === 0) return "";
  return String(v);
}

function Field({ label, value, onChange, prefix, suffix, hint }: {
  label: string; value: string; onChange: (v: string) => void;
  prefix?: string; suffix?: string; hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">{label}</label>
      <div className="relative">
        {prefix && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm font-semibold select-none">{prefix}</span>
        )}
        <input
          type="number"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="0"
          className={[
            "w-full rounded-lg border bg-slate-900 border-slate-600 text-white text-sm font-semibold",
            "px-3 py-2.5 outline-none tabular-nums",
            "focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 placeholder:text-slate-600",
            prefix ? "pl-8" : "",
            suffix ? "pr-8" : "",
          ].join(" ")}
        />
        {suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs font-semibold select-none">{suffix}</span>
        )}
      </div>
      {hint && <p className="text-[10px] text-slate-600 mt-0.5">{hint}</p>}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mt-5 mb-3 flex items-center gap-2">
      <span className="flex-1 h-px bg-slate-700/60" />
      {children}
      <span className="flex-1 h-px bg-slate-700/60" />
    </p>
  );
}

// Convert ISO timestamp → "YYYY-MM-DD" for a date input
function toDateValue(iso: string): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

// Convert "YYYY-MM-DD" back to an ISO string, preserving the original time
function mergeDateIntoISO(dateValue: string, originalISO: string): string {
  if (!dateValue) return originalISO;
  const orig = new Date(originalISO);
  const [y, m, d] = dateValue.split("-").map(Number);
  orig.setFullYear(y, m - 1, d);
  return orig.toISOString();
}

export default function ShiftEditDialog({ shift, onClose, onSaved }: Props) {
  // Shift date
  const [shiftDate, setShiftDate] = useState(toDateValue(shift.created_at));

  // Fuel 92
  const [f92l, setF92l] = useState(fmtInput(shift.fuel_92_liters));
  const [f92p, setF92p] = useState(fmtInput(shift.fuel_92_price));
  // Fuel 95
  const [f95l, setF95l] = useState(fmtInput(shift.fuel_95_liters));
  const [f95p, setF95p] = useState(fmtInput(shift.fuel_95_price));
  // Premium Diesel
  const [fPDl, setFPDl] = useState(fmtInput(shift.premium_diesel_liters));
  const [fPDp, setFPDp] = useState(fmtInput(shift.premium_diesel_price));
  // Pipa
  const [pipaAmt, setPipaAmt] = useState(fmtInput(shift.pipa_amount));
  const [pipaPrice, setPipaPrice] = useState(fmtInput(shift.pipa_price));
  // Diesel
  const [dieselCash, setDieselCash] = useState(fmtInput(shift.diesel_cash));
  // Expenses
  const [expenses, setExpenses] = useState<ExpenseItem[]>(
    shift.expenses_breakdown?.length ? shift.expenses_breakdown : [{ name: "", amount: 0 }]
  );
  // Cash
  const [actualCash, setActualCash] = useState(fmtInput(shift.actual_cash_collected));

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // Auto-calc totals
  const t92 = n(f92l) * n(f92p);
  const t95 = n(f95l) * n(f95p);
  const tPD = n(fPDl) * n(fPDp);
  const tPipa = n(pipaAmt) * n(pipaPrice);
  const tDiesel = n(dieselCash);
  const grandTotal = t92 + t95 + tPD + tPipa + tDiesel;
  const totalExp = expenses.reduce((s, e) => s + (e.amount || 0), 0);
  const netExpected = grandTotal - totalExp;
  const diff = n(actualCash) - netExpected;

  function fmt(v: number) {
    if (v === 0) return "—";
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(v) + " MMK";
  }

  function updateExpense(i: number, field: keyof ExpenseItem, val: string | number) {
    setExpenses(prev => prev.map((e, idx) => idx === i ? { ...e, [field]: field === "amount" ? n(String(val)) : val } : e));
  }
  function addExpense() { setExpenses(prev => [...prev, { name: "", amount: 0 }]); }
  function removeExpense(i: number) { setExpenses(prev => prev.filter((_, idx) => idx !== i)); }

  async function handleSave() {
    setSaving(true);
    setSaveError("");

    const fuel_data = {
      fuel_92_liters: n(f92l), fuel_92_price: n(f92p), fuel_92_total: t92,
      fuel_95_liters: n(f95l), fuel_95_price: n(f95p), fuel_95_total: t95,
      premium_diesel_liters: n(fPDl), premium_diesel_price: n(fPDp), premium_diesel_total: tPD,
      pipa_amount: n(pipaAmt), pipa_price: n(pipaPrice), pipa_total: tPipa,
      diesel_cash: n(dieselCash), diesel_price: shift.diesel_price ?? 0,
      pipa_items: shift.pipa_items ?? [],
      jelly_can_items: shift.jelly_can_items ?? [],
    };

    const cleanedExpenses = expenses.filter(e => e.name.trim() || e.amount > 0);
    const originalDateStr = toDateValue(shift.created_at); // "YYYY-MM-DD" before edit
    const newTimestamp = shiftDate ? mergeDateIntoISO(shiftDate, shift.created_at) : undefined;

    const { error } = await updateShift(shift.id, {
      fuel_data,
      total_expenses: totalExp,
      expenses_breakdown: cleanedExpenses,
      expected_total: netExpected,
      actual_cash: n(actualCash),
      variance: diff,
      timestamp: newTimestamp,
    });

    if (!error && shiftDate && originalDateStr !== shiftDate && shift.employee_username) {
      // Cascade date change to any debt_transactions created by this shift
      await updateDebtTransactionDates(originalDateStr, shiftDate, shift.employee_username);
    }

    setSaving(false);
    if (error) {
      setSaveError(error);
    } else {
      onSaved();
      onClose();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div className="relative w-full max-w-[520px] bg-[#0f1623] border-l border-slate-700/50 h-full overflow-y-auto shadow flex flex-col">
        {/* Header */}
        <div className="sticky top-0 bg-[#0f1623] border-b border-slate-700/50 px-6 py-4 flex items-center justify-between z-10">
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-widest font-semibold mb-0.5">Edit Shift</p>
            <h2 className="text-white font-bold text-base font-mono">#{String(shift.id).slice(0, 8).toUpperCase()}</h2>
          </div>
          <button onClick={onClose} aria-label="Close panel" className="text-slate-500 hover:text-white p-1.5 rounded-lg hover:bg-slate-700/50 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 px-6 py-5 space-y-1 overflow-y-auto">
          {saveError && (
            <div className="flex items-start gap-2 bg-red-900/30 border border-red-700/40 rounded-xl px-4 py-3 text-xs text-red-300 mb-4">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{saveError}</span>
            </div>
          )}

          {/* Shift Date */}
          <div className="flex flex-col gap-1 mb-2">
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
              <CalendarDays className="w-3.5 h-3.5" />
              Shift Date
            </label>
            <input
              type="date"
              value={shiftDate}
              onChange={e => setShiftDate(e.target.value)}
              className="w-full rounded-lg border bg-slate-900 border-slate-600 text-white text-sm font-semibold px-3 py-2.5 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
            />
          </div>

          <SectionTitle>Fuel 92</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Liters Sold" value={f92l} onChange={setF92l} suffix="L" />
            <Field label="Price / Liter" value={f92p} onChange={setF92p} prefix="K" hint={t92 > 0 ? `Total: ${fmt(t92)}` : undefined} />
          </div>

          <SectionTitle>Fuel 95</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Liters Sold" value={f95l} onChange={setF95l} suffix="L" />
            <Field label="Price / Liter" value={f95p} onChange={setF95p} prefix="K" hint={t95 > 0 ? `Total: ${fmt(t95)}` : undefined} />
          </div>

          <SectionTitle>Premium Diesel</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Liters Sold" value={fPDl} onChange={setFPDl} suffix="L" />
            <Field label="Price / Liter" value={fPDp} onChange={setFPDp} prefix="K" hint={tPD > 0 ? `Total: ${fmt(tPD)}` : undefined} />
          </div>

          <SectionTitle>Pipa</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Containers" value={pipaAmt} onChange={setPipaAmt} suffix="ctn" />
            <Field label="Price / Container" value={pipaPrice} onChange={setPipaPrice} prefix="K" hint={tPipa > 0 ? `Total: ${fmt(tPipa)}` : undefined} />
          </div>

          <SectionTitle>Diesel Cash</SectionTitle>
          <Field label="Cash Amount" value={dieselCash} onChange={setDieselCash} prefix="K" />

          <SectionTitle>Operational Expenses</SectionTitle>
          <div className="space-y-2">
            {expenses.map((e, i) => (
              <div key={i} className="grid grid-cols-[1fr_auto_auto] gap-2 items-center">
                <input
                  type="text"
                  value={e.name}
                  onChange={ev => updateExpense(i, "name", ev.target.value)}
                  placeholder="Description"
                  className="rounded-lg border bg-slate-900 border-slate-600 text-white text-sm px-3 py-2.5 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 placeholder:text-slate-600"
                />
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs select-none">K</span>
                  <input
                    type="number"
                    value={e.amount || ""}
                    onChange={ev => updateExpense(i, "amount", ev.target.value)}
                    placeholder="0"
                    className="w-28 rounded-lg border bg-slate-900 border-slate-600 text-white text-sm pl-7 pr-2 py-2.5 outline-none tabular-nums focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 placeholder:text-slate-600"
                  />
                </div>
                <button type="button" onClick={() => removeExpense(i)} aria-label={`Remove expense ${i + 1}`} className="text-slate-600 hover:text-red-400 transition-colors p-1">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addExpense}
              className="text-xs font-semibold text-blue-400 hover:text-blue-300 border border-slate-700 hover:border-blue-500/40 rounded-lg px-3 py-1.5 transition-all flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" /> Add Expense
            </button>
          </div>

          <SectionTitle>Cash Summary</SectionTitle>
          <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl overflow-hidden divide-y divide-slate-700/30 mb-4">
            <div className="px-4 py-2.5 flex justify-between text-sm">
              <span className="text-slate-400">Grand Total (Sales)</span>
              <span className="text-white font-medium tabular-nums">{fmt(grandTotal)}</span>
            </div>
            <div className="px-4 py-2.5 flex justify-between text-sm">
              <span className="text-slate-400">Total Expenses</span>
              <span className="text-amber-300 font-medium tabular-nums">{fmt(totalExp)}</span>
            </div>
            <div className="px-4 py-2.5 flex justify-between text-sm font-semibold">
              <span className="text-slate-300">Expected Total</span>
              <span className="text-white tabular-nums">{fmt(netExpected)}</span>
            </div>
          </div>

          <Field label="Actual Collected" value={actualCash} onChange={setActualCash} prefix="K" />

          {/* Difference preview */}
          <div className={`mt-3 rounded-xl px-4 py-3 flex justify-between items-center text-sm font-bold border ${
            Math.abs(diff) >= 10_000
              ? "bg-red-900/20 border-red-700/40 text-red-300"
              : diff >= 0
              ? "bg-emerald-900/20 border-emerald-700/30 text-emerald-400"
              : "bg-amber-900/20 border-amber-700/30 text-amber-400"
          }`}>
            <span>Difference</span>
            <span className="tabular-nums">{diff >= 0 ? "+" : ""}{fmt(diff)}</span>
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-[#0f1623] border-t border-slate-700/50 px-6 py-4 flex items-center gap-3">
          <button
            onClick={onClose}
            className="flex-1 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-300 hover:text-white font-semibold rounded-xl py-2.5 text-sm transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold rounded-xl py-2.5 text-sm transition-all"
          >
            <Save className="w-4 h-4" />
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
