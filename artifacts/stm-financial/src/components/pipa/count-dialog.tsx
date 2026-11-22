import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { PIPA_PRODUCTS, fmtLiters, fmtPipas, round3, yangonToday, type PipaProduct, type ProductStock } from "@/lib/pipa-ledger";
import { ppLiters } from "@/lib/units";
import PipaModal, { ErrorNote, fieldCls, primaryBtn } from "./modal";
import { Loader2 } from "lucide-react";
import { usePipaT, pipaProduct } from "@/lib/pipa-i18n";

/**
 * Physical count: any gap from the calculated stock is saved as a correction.
 * A shortage is a loss at cost; extra P-P cost nothing — unless it's the
 * opening stock, which comes in at the price paid.
 */
export default function CountDialog({ stock, canPrice = false, onClose, onSaved }: {
  stock: Record<PipaProduct, ProductStock>;
  /** Owners can bring extra P-P in as opening stock with its price; for others it waits for the owner's price. */
  canPrice?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = usePipaT();
  const [counted, setCounted] = useState<Partial<Record<PipaProduct, string>>>({});
  const [opening, setOpening] = useState(false);
  const [prices, setPrices] = useState<Partial<Record<PipaProduct, string>>>({});
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
    if (canPrice && opening && diffs.some(d => d.diff > 0 && (prices[d.product] ?? "").trim() !== "" && !(parseFloat(prices[d.product] ?? "") >= 0))) { setError(t("priceErr")); return; }
    setBusy(true); setError("");
    const today = yangonToday();
    for (const d of diffs) {
      const typed = (prices[d.product] ?? "").trim();
      const price = canPrice && opening && d.diff > 0 && typed !== "" ? parseFloat(typed) : null;   // never required
      const { error: err } = await supabase.rpc("record_pp_movement", {
        p: {
          kind: "adjust", product: d.product, pipas: d.diff, occurred_on: today, liters_per_pipa: ppLiters(),
          ...(price != null ? { price_mode: "per_liter", unit_price: price } : {}),
          note: `Stock count: counted ${fmtPipas(d.counted)}, expected ${fmtPipas(d.expected)} — ${d.diff < 0 ? "shortage" : "extra"} ${fmtPipas(Math.abs(d.diff))}`,
        },
      });
      if (err) {
        setBusy(false);
        setError(err.code === "PGRST202" || err.code === "42883" ? t("needsUpdate") : err.message);
        return;
      }
    }
    setBusy(false);
    onSaved();
  }

  return (
    <PipaModal
      title={t("countTitle")}
      subtitle={t("countSub")}
      onClose={onClose}
      footer={
        <button type="button" onClick={save} disabled={busy} className={primaryBtn}>
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          {diffs.length ? t("saveCorrections", { n: diffs.length }) : t("done")}
        </button>
      }
    >
      <div className="space-y-3">
        {PIPA_PRODUCTS.map(p => {
          const d = diffs.find(x => x.product === p);
          return (
            <div key={p} className="space-y-2">
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-900">{pipaProduct(t, p)}</p>
                  <p className="text-xs text-slate-500">{t("calculated", { n: fmtPipas(stock[p].pipas) })}</p>
                  {d && (
                    <p className={`text-xs font-semibold ${d.diff < 0 ? "text-pale-red-foreground" : "text-pale-green-foreground"}`}>
                      {d.diff < 0 ? t("shortage") : t("extra")} {fmtPipas(Math.abs(d.diff))} P-P ({fmtLiters(Math.abs(d.diff) * ppLiters())})
                    </p>
                  )}
                </div>
                <input type="number" inputMode="decimal" min="0" step="any" aria-label={t("countedOf", { product: pipaProduct(t, p) })}
                  value={counted[p] ?? ""} onChange={e => setCounted(c => ({ ...c, [p]: e.target.value }))}
                  className={`${fieldCls} !w-28 text-right`} placeholder={t("counted")} />
              </div>
              {opening && d && d.diff > 0 && (
                <div className="flex items-center gap-3 pl-3 border-l-2 border-blue-200">
                  <span className="flex-1 text-xs text-slate-600">{t("mmkPerL")}</span>
                  <input type="number" inputMode="decimal" min="0" step="any" aria-label={t("pricePerLOf", { product: pipaProduct(t, p) })}
                    value={prices[p] ?? ""} onChange={e => setPrices(c => ({ ...c, [p]: e.target.value }))}
                    className={`${fieldCls} !w-28 text-right`} placeholder="0" />
                </div>
              )}
            </div>
          );
        })}
        {canPrice && <label className="flex items-start gap-2.5 text-sm text-slate-700 pt-2 border-t border-slate-100">
          <input type="checkbox" checked={opening} onChange={e => setOpening(e.target.checked)} className="mt-0.5 w-4 h-4 accent-blue-600" data-testid="count-opening" />
          <span>
            <span className="font-semibold">{t("opening")}</span>
            <span className="block text-xs text-slate-500 mt-0.5">{t("openingHelp")}</span>
          </span>
        </label>}
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
    </PipaModal>
  );
}
