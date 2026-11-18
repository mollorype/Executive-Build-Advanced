import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { supabase } from "@/lib/supabase";
import {
  PIPA_MOVEMENTS_TABLE, PIPA_PRODUCTS, PRODUCT_LABELS, fmtLiters, fmtPipas, normalizeMovement, stockByProduct,
  type PipaProduct, type ProductStock,
} from "@/lib/pipa-ledger";
import { ChevronRight, Cylinder } from "lucide-react";

/** Read-only pipa stock for the PO Registry, calculated from the Pipa Ledger. */
export default function PipaStockSummary() {
  const [, setLocation] = useLocation();
  const [stock, setStock] = useState<Record<PipaProduct, ProductStock> | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    supabase.from(PIPA_MOVEMENTS_TABLE).select("kind, product, pipas, liters_per_pipa").then(({ data, error }) => {
      if (error) { setMissing(true); return; }
      setStock(stockByProduct((data ?? []).map(r => normalizeMovement(r as Record<string, unknown>))));
    });
  }, []);

  return (
    <div className="bg-white border border-slate-100 rounded-xl overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
        <Cylinder className="w-4 h-4 text-pale-blue-foreground" />
        <h2 className="text-slate-900 font-semibold text-sm">Pipa stock</h2>
        <button onClick={() => setLocation("/pipa-ledger")}
          className="ml-auto flex items-center gap-0.5 text-xs font-semibold text-pale-blue-foreground">
          Open Pipa Ledger <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
      {missing ? (
        <p className="px-5 py-4 text-sm text-slate-500">The Pipa Ledger isn't set up yet.</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-slate-100">
          {PIPA_PRODUCTS.map(p => (
            <div key={p} className="px-5 py-3">
              <p className="text-xs text-slate-500">{PRODUCT_LABELS[p]}</p>
              <p className={`text-lg font-bold tabular-nums ${stock && stock[p].pipas < 0 ? "text-pale-red-foreground" : "text-slate-900"}`}>
                {stock ? fmtPipas(stock[p].pipas) : "…"} <span className="text-xs font-semibold text-slate-400">pipa</span>
              </p>
              {stock && <p className="text-[11px] text-slate-400 tabular-nums">{fmtLiters(stock[p].liters)}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
