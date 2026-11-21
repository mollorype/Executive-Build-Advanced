import { useEffect, useMemo, useState } from "react";
import { supabase, TABLES, COLS, mapRowToShift, type Shift } from "@/lib/supabase";
import { shiftVolume } from "@/lib/fifo-engine";
import {
  DEFAULT_LITERS_PER_PIPA, PIPA_DEDUCTIONS_TABLE, PIPA_PRODUCTS,
  fmtLiters, fmtPipas, round3, type PipaProduct,
} from "@/lib/pipa-ledger";
import PipaModal, { ErrorNote, primaryBtn } from "./modal";
import { Loader2 } from "lucide-react";
import { usePipaT, pipaProduct } from "@/lib/pipa-i18n";

const RECENT_SHIFTS = 100;

type Row = { shift: Shift; liters: Record<PipaProduct, number> };

/**
 * Never automatic: lists shifts not yet deducted and, only when the CEO
 * presses the button, records their litres as "Sold / used". Uses the FIFO
 * engine's own per-shift litre count (pumps + whole pipas sold + jelly cans).
 */
export default function DeductShiftsDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const tr = usePipaT();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const [{ data: done, error: dErr }, { data: shifts, error: sErr }] = await Promise.all([
        supabase.from(PIPA_DEDUCTIONS_TABLE).select("shift_id"),
        supabase.from(TABLES.SHIFTS).select("*").order(COLS.TIMESTAMP, { ascending: false }).limit(RECENT_SHIFTS),
      ]);
      if (dErr || sErr) { setError((dErr ?? sErr)!.message); setRows([]); return; }
      const deducted = new Set((done ?? []).map(d => d.shift_id as string));
      const pending = (shifts ?? [])
        .map(r => mapRowToShift(r as Record<string, unknown>))
        .filter(s => !deducted.has(s.id))
        .map(shift => ({
          shift,
          liters: Object.fromEntries(PIPA_PRODUCTS.map(p => [p, round3(shiftVolume(shift, p))])) as Record<PipaProduct, number>,
        }));
      setRows(pending);
      setSelected(new Set(pending.map(r => r.shift.id)));
    })();
  }, []);

  const totals = useMemo(() => {
    const t = Object.fromEntries(PIPA_PRODUCTS.map(p => [p, 0])) as Record<PipaProduct, number>;
    for (const r of rows ?? []) if (selected.has(r.shift.id)) for (const p of PIPA_PRODUCTS) t[p] = round3(t[p] + r.liters[p]);
    return t;
  }, [rows, selected]);
  const anyLiters = PIPA_PRODUCTS.some(p => totals[p] > 0);

  function toggle(id: string) {
    setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  async function deduct() {
    if (selected.size === 0) return;
    setBusy(true); setError("");
    const { error: err } = await supabase.rpc("record_pipa_shift_usage", {
      p_shift_ids: [...selected],
      p_liters: totals,
      p_liters_per_pipa: DEFAULT_LITERS_PER_PIPA,
    });
    setBusy(false);
    if (err) {
      setError(err.code === "23505"
        ? tr("alreadyDeducted")
        : err.message);
      return;
    }
    onSaved();
  }

  const fmtWhen = (ts: string) => ts
    ? new Date(ts).toLocaleString("en-GB", { timeZone: "Asia/Yangon", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })
    : "—";

  return (
    <PipaModal
      title={tr("deductTitle")}
      subtitle={tr("deductSub")}
      onClose={onClose}
      footer={rows && rows.length > 0 ? (
        <button type="button" onClick={deduct} disabled={busy || selected.size === 0 || !anyLiters} className={primaryBtn}>
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          {tr("deductN", { n: selected.size })}
        </button>
      ) : undefined}
    >
      {rows === null ? (
        <div className="py-8 text-center"><Loader2 className="w-6 h-6 text-blue-500/50 animate-spin mx-auto" /></div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-500 text-center py-6">{error ? "" : tr("allDeducted")}</p>
      ) : (
        <>
          <div className="bg-slate-50 border border-slate-100 rounded-xl p-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">{tr("willDeduct")}</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {PIPA_PRODUCTS.map(p => (
                <div key={p} className="text-sm">
                  <span className="text-slate-600">{pipaProduct(tr, p)}: </span>
                  <span className="font-semibold text-slate-900">{fmtPipas(round3(totals[p] / DEFAULT_LITERS_PER_PIPA))} P-P</span>
                  <span className="text-slate-400 text-xs"> ({fmtLiters(totals[p])})</span>
                </div>
              ))}
            </div>
          </div>
          <div className="divide-y divide-slate-100 border border-slate-100 rounded-xl">
            {rows.map(({ shift, liters }) => (
              <label key={shift.id} className="flex items-start gap-3 px-3 py-2.5 cursor-pointer">
                <input type="checkbox" checked={selected.has(shift.id)} onChange={() => toggle(shift.id)}
                  className="mt-1 w-4 h-4 accent-blue-600" aria-label={tr("includeShift", { when: fmtWhen(shift.created_at) })} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900">{fmtWhen(shift.created_at)} · <span className="capitalize">{shift.employee_username || "—"}</span></p>
                  <p className="text-xs text-slate-500">
                    {PIPA_PRODUCTS.filter(p => liters[p] > 0).map(p => `${pipaProduct(tr, p)} ${fmtLiters(liters[p])}`).join(" · ") || tr("noFuel")}
                  </p>
                </div>
              </label>
            ))}
          </div>
        </>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
    </PipaModal>
  );
}
