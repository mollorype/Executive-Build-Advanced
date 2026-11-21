import { useCallback, useEffect, useState } from "react";
import { Loader2, Undo2 } from "lucide-react";
import { supabase, type FuelPurchaseOrder } from "@/lib/supabase";
import { latestBatchFor, loadPOUsage, poProfit, type POUsage } from "@/lib/po-usage";
import { mmk, vol, type VolUnit } from "@/lib/po-units";
import { usePOT, poProduct } from "@/lib/po-i18n";
import { confirmDialog } from "@/components/confirm-dialog";
import PipaModal, { ErrorNote } from "@/components/pipa/modal";

/**
 * Which day, how much and at what price each piece of a PO was sold — from the
 * deductions the database recorded — and the profit worked out from them.
 * The newest deduction for the fuel can be undone here.
 */
export default function POHistoryDialog({ po, unit, onClose, onChanged }: {
  po: FuelPurchaseOrder;
  unit: VolUnit;
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  const t = usePOT();
  const [rows, setRows] = useState<POUsage[] | null>(null);
  const [latest, setLatest] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [{ rows: r, error: e }, l] = await Promise.all([loadPOUsage(po.id), latestBatchFor(po.product_type)]);
    setRows(r); setLatest(l);
    if (e) setError(e);
  }, [po.id, po.product_type]);
  useEffect(() => { load(); }, [load]);

  async function undo(batch: string) {
    if (!(await confirmDialog(t("undoConfirm"), { danger: true, confirmLabel: t("undo") }))) return;
    setBusy(true); setError("");
    const { error: e } = await supabase.rpc("undo_po_shift_usage", { p_batch: batch });
    setBusy(false);
    if (e) {
      setError(/newer deduction/.test(e.message) ? t("undoNewer") : /force-closed/.test(e.message) ? t("undoClosed") : e.message);
      return;
    }
    onChanged(t("undone"));
  }

  const day = (ts: string) => new Date(ts).toLocaleDateString("en-GB", { timeZone: "Asia/Yangon", day: "numeric", month: "short", year: "numeric" });
  const sum = (rows ?? []).reduce((s, r) => ({ liters: s.liters + r.liters, amount: s.amount + r.amount }), { liters: 0, amount: 0 });
  const profit = poProfit(po, sum);

  return (
    <PipaModal title={`${t("historyTitle")} · ${po.name ?? po.id.slice(0, 8)}`} subtitle={`${poProduct(t, po.product_type)} · PO #${po.id.slice(0, 8).toUpperCase()}`} onClose={onClose}>
      {rows === null ? (
        <div className="py-8 text-center"><Loader2 className="w-6 h-6 text-blue-500/50 animate-spin mx-auto" /></div>
      ) : (
        <>
          <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 text-sm space-y-1" data-testid="po-history-summary">
            <Line label={t("totalSold")} value={vol(sum.liters, unit)} />
            <Line label={t("revenue")} value={mmk(sum.amount)} />
            {sum.liters > 0 && <Line label={t("avgSold")} value={`${mmk(sum.amount / sum.liters)}/L`} />}
            {profit ? (
              <>
                <Line label={t("wholesaleCost")} value={`− ${mmk(profit.wholesale)}`} />
                <Line label={t("feesCost")} value={`− ${mmk(profit.fees)}`} />
                {profit.shortageCost > 0 && <Line label={t("shortageCost")} value={`− ${mmk(profit.shortageCost)}`} />}
                <div className="flex justify-between gap-2 pt-1 border-t border-slate-200 font-bold">
                  <span>{t("profit")}</span>
                  <span className={`tabular-nums ${profit.profit >= 0 ? "text-pale-green-foreground" : "text-pale-red-foreground"}`} data-testid="po-history-profit">
                    {profit.profit >= 0 ? "+" : ""}{mmk(profit.profit)}
                  </span>
                </div>
                {profit.soldNoPrice > 0 && <p className="text-[11px] text-amber-700">{t("soldNoPrice", { v: vol(profit.soldNoPrice, unit) })}</p>}
              </>
            ) : <p className="text-xs text-slate-500">{t("costsPending")}</p>}
          </div>

          {rows.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-4">{t("historyEmpty")}</p>
          ) : (
            <div className="border border-slate-100 rounded-xl overflow-hidden">
              <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 px-3 py-2 bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                <span>{t("colDay")}</span><span className="text-right">{t("colQty")}</span><span className="text-right">{t("colAmount")}</span>
              </div>
              <ul className="divide-y divide-slate-100" data-testid="po-history-rows">
                {rows.map((r, i) => {
                  const firstOfBatch = i === 0 || rows[i - 1].batch_id !== r.batch_id;
                  const canUndo = r.batch_id === latest;
                  return (
                    <li key={r.id} className="px-3 py-2.5">
                      <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 items-baseline text-sm">
                        <span className="text-slate-900 font-medium">{day(r.shift_at)}</span>
                        <span className="text-right tabular-nums text-slate-700">{vol(r.liters, unit)}</span>
                        <span className="text-right tabular-nums font-semibold text-slate-900">{mmk(r.amount)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-0.5">
                        <span className="text-xs text-slate-500 tabular-nums">{t("colPrice")} {mmk(r.price_per_liter)}</span>
                        {canUndo && firstOfBatch && (
                          <button type="button" onClick={() => undo(r.batch_id)} disabled={busy}
                            className="flex items-center gap-1 text-xs font-semibold text-pale-red-foreground hover:bg-pale-red rounded-lg px-2 py-1 disabled:opacity-50">
                            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Undo2 className="w-3.5 h-3.5" />} {t("undo")}
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
    </PipaModal>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-900 font-medium tabular-nums">{value}</span>
    </div>
  );
}
