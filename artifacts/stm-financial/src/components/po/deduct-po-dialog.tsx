import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase, TABLES, COLS, mapRowToShift, type FuelPurchaseOrder, type Shift } from "@/lib/supabase";
import { PO_DEDUCTED_TABLE, PO_PRODUCTS, deductionRows, shiftSales, type POProduct } from "@/lib/po-usage";
import { mmk, vol, type VolUnit } from "@/lib/po-units";
import { usePOT, poProduct } from "@/lib/po-i18n";
import { messageDialog } from "@/components/confirm-dialog";
import PipaModal, { ErrorNote, primaryBtn } from "@/components/pipa/modal";

const RECENT_SHIFTS = 100;
type Row = { shift: Shift; sales: Record<POProduct, { liters: number; amount: number }> };

/**
 * Never automatic: lists shifts not yet deducted from the POs and, when the
 * owner presses the button, the database takes their litres off the POs of
 * each fuel, oldest first, recording each day's selling price.
 */
export default function DeductPODialog({ unit, onClose, onSaved }: { unit: VolUnit; onClose: () => void; onSaved: (message: string) => void }) {
  const t = usePOT();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [open, setOpen] = useState<FuelPurchaseOrder[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    (async () => {
      const [done, shifts, pos] = await Promise.all([
        supabase.from(PO_DEDUCTED_TABLE).select("shift_id"),
        supabase.from(TABLES.SHIFTS).select("*").order(COLS.TIMESTAMP, { ascending: false }).limit(RECENT_SHIFTS),
        supabase.from("fuel_purchase_orders").select("*").neq("status", "DONE").is("shortage_liters", null),
      ]);
      if (done.error) {
        if (done.error.code === "PGRST205" || done.error.code === "42P01") setMissing(true);
        else setError(done.error.message);
        setRows([]);
        return;
      }
      if (shifts.error || pos.error) { setError((shifts.error ?? pos.error)!.message); setRows([]); return; }
      const deducted = new Set((done.data ?? []).map(d => d.shift_id as string));
      const openPOs = (pos.data ?? []) as FuelPurchaseOrder[];
      const pending = (shifts.data ?? [])
        .map(r => mapRowToShift(r as Record<string, unknown>))
        .filter(s => !deducted.has(s.id))
        .map(shift => ({ shift, sales: Object.fromEntries(PO_PRODUCTS.map(p => [p, shiftSales(shift, p)])) as Row["sales"] }));
      // Tick only shifts from the oldest open PO on: older sales weren't from these POs.
      const since = openPOs.reduce<string | null>((m, p) => (!m || p.created_at < m ? p.created_at : m), null);
      setOpen(openPOs);
      setRows(pending);
      setSelected(new Set(pending.filter(r => since && r.shift.created_at >= since).map(r => r.shift.id)));
    })();
  }, []);

  const since = useMemo(() => open.reduce<string | null>((m, p) => (!m || p.created_at < m ? p.created_at : m), null), [open]);
  const totals = useMemo(() => {
    const out = Object.fromEntries(PO_PRODUCTS.map(p => [p, { liters: 0, amount: 0 }])) as Row["sales"];
    for (const r of rows ?? []) if (selected.has(r.shift.id)) for (const p of PO_PRODUCTS) {
      out[p].liters += r.sales[p].liters; out[p].amount += r.sales[p].amount;
    }
    return out;
  }, [rows, selected]);
  // What the open POs can still take, in litres sold (remaining ÷ calibration).
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
    const { data, error: err } = await supabase.rpc("record_po_shift_usage", { p_rows: deductionRows(chosen) });
    setBusy(false);
    if (err) { setError(err.code === "23505" ? t("alreadyDeducted") : err.message); return; }
    const left = Object.entries(((data as { unallocated?: Record<string, number> } | null)?.unallocated) ?? {}).filter(([, v]) => Number(v) > 0);
    if (left.length) await messageDialog(t("unallocated", { list: left.map(([p, v]) => `${poProduct(t, p)} ${vol(Number(v), unit)}`).join(", ") }));
    onSaved(t("deducted"));
  }

  const used = PO_PRODUCTS.filter(p => totals[p].liters > 0);
  return (
    <PipaModal
      title={t("deductTitle")}
      subtitle={t("deductSub")}
      onClose={onClose}
      footer={rows && rows.length > 0 && !missing ? (
        <button type="button" onClick={deduct} disabled={busy || selected.size === 0} className={primaryBtn} data-testid="po-deduct-go">
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
          <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 space-y-2" data-testid="po-deduct-totals">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("willDeduct")}</p>
            {used.length === 0 ? <p className="text-sm text-slate-500">{t("noFuel")}</p> : used.map(p => {
              const over = totals[p].liters - capacity[p];
              return (
                <div key={p} className="text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold text-slate-900">{poProduct(t, p)}</span>
                    <span className="font-bold text-slate-900 tabular-nums">{vol(totals[p].liters, unit)}</span>
                  </div>
                  <p className="text-xs text-slate-500 tabular-nums">
                    {mmk(totals[p].amount)} · {t("avgPrice", { p: mmk(totals[p].amount / totals[p].liters) })} · {t("inPOs", { v: vol(capacity[p], unit) })}
                  </p>
                  {over > 0.001 && <p className="text-xs font-semibold text-amber-700">{t("overPOs", { v: vol(over, unit) })}</p>}
                </div>
              );
            })}
          </div>
          {open.length === 0
            ? <p className="text-xs font-semibold text-amber-700">{t("noOpenPO")}</p>
            : since && rows.some(r => r.shift.created_at < since) && <p className="text-[11px] text-slate-500">{t("beforePOs", { date: fmtDate(since) })}</p>}
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
                          {poProduct(t, p)}: {vol(sales[p].liters, unit)} @ {mmk(sales[p].amount / sales[p].liters)}/L
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
