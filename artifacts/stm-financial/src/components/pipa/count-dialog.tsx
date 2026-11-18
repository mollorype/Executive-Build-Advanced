import { useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  DEFAULT_LITERS_PER_PIPA, PIPA_MOVEMENTS_TABLE, PIPA_PRODUCTS, PRODUCT_LABELS,
  fmtLiters, fmtPipas, round3, yangonToday, type PipaProduct, type ProductStock,
} from "@/lib/pipa-ledger";
import PipaModal, { ErrorNote, fieldCls, primaryBtn } from "./modal";
import { Loader2 } from "lucide-react";

/** Physical count: any gap from the calculated stock is saved as a correction. */
export default function CountDialog({ stock, onClose, onSaved }: {
  stock: Record<PipaProduct, ProductStock>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [counted, setCounted] = useState<Partial<Record<PipaProduct, string>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const diffs = PIPA_PRODUCTS.flatMap(p => {
    const raw = counted[p];
    if (raw == null || raw.trim() === "") return [];
    const c = parseFloat(raw);
    if (isNaN(c) || c < 0) return [];
    const diff = round3(c - stock[p].pipas);
    return diff === 0 ? [] : [{ product: p, counted: c, expected: stock[p].pipas, diff }];
  });

  async function save() {
    if (diffs.length === 0) { onClose(); return; }
    setBusy(true); setError("");
    const today = yangonToday();
    const { error: err } = await supabase.from(PIPA_MOVEMENTS_TABLE).insert(diffs.map(d => ({
      occurred_on: today,
      kind: "adjust",
      product: d.product,
      pipas: d.diff,
      liters_per_pipa: DEFAULT_LITERS_PER_PIPA,
      note: `Stock count: counted ${fmtPipas(d.counted)}, expected ${fmtPipas(d.expected)} — ${d.diff < 0 ? "shortage" : "extra"} ${fmtPipas(Math.abs(d.diff))}`,
    })));
    setBusy(false);
    if (err) { setError(err.message); return; }
    onSaved();
  }

  return (
    <PipaModal
      title="Count stock"
      subtitle="Enter the pipas actually there. Leave a fuel blank to skip it."
      onClose={onClose}
      footer={
        <button type="button" onClick={save} disabled={busy} className={primaryBtn}>
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          {diffs.length ? `Save ${diffs.length} correction${diffs.length > 1 ? "s" : ""}` : "Done"}
        </button>
      }
    >
      <div className="space-y-3">
        {PIPA_PRODUCTS.map(p => {
          const d = diffs.find(x => x.product === p);
          return (
            <div key={p} className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-900">{PRODUCT_LABELS[p]}</p>
                <p className="text-xs text-slate-500">Calculated: {fmtPipas(stock[p].pipas)} pipas</p>
                {d && (
                  <p className={`text-xs font-semibold ${d.diff < 0 ? "text-pale-red-foreground" : "text-pale-green-foreground"}`}>
                    {d.diff < 0 ? "Shortage" : "Extra"} {fmtPipas(Math.abs(d.diff))} pipa ({fmtLiters(Math.abs(d.diff) * DEFAULT_LITERS_PER_PIPA)})
                  </p>
                )}
              </div>
              <input type="number" inputMode="decimal" min="0" step="any" aria-label={`Counted pipas of ${PRODUCT_LABELS[p]}`}
                value={counted[p] ?? ""} onChange={e => setCounted(c => ({ ...c, [p]: e.target.value }))}
                className={`${fieldCls} !w-28 text-right`} placeholder="Counted" />
            </div>
          );
        })}
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
    </PipaModal>
  );
}
