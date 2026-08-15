import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import {
  PIPA_STOCK_TABLE, PIPA_PRODUCT_TYPES, PIPA_PRODUCT_LABELS,
  PIPA_STOCK_SETUP_SQL, pipaTotalLiters,
  type PipaStockRow, type PipaProductType,
} from "@/lib/pipa-stock";
import { Container, Copy, AlertCircle, Building2, Check, X, Pencil, Loader2 } from "lucide-react";

function emptyRow(product: PipaProductType): PipaStockRow {
  return { id: product, product_type: product, remaining_containers: 0, wholesale_assignment: null, updated_at: "" };
}

export default function PipaRemainingCard() {
  const [rows, setRows] = useState<Record<PipaProductType, PipaStockRow>>(() => {
    const init = {} as Record<PipaProductType, PipaStockRow>;
    for (const p of PIPA_PRODUCT_TYPES) init[p] = emptyRow(p);
    return init;
  });
  const [selected, setSelected] = useState<Partial<Record<PipaProductType, boolean>>>({});
  const [editingQty, setEditingQty] = useState<PipaProductType | null>(null);
  const [qtyDraft, setQtyDraft] = useState("");
  const [editingAssign, setEditingAssign] = useState<PipaProductType | null>(null);
  const [assignDraft, setAssignDraft] = useState("");
  const [tableError, setTableError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState<PipaProductType | null>(null);

  const fetchStock = useCallback(async () => {
    const { data, error } = await supabase.from(PIPA_STOCK_TABLE).select("*");
    if (error) {
      if (error.code === "42P01" || error.code === "PGRST116" || error.message.includes("does not exist")) {
        setTableError(true);
      }
    } else {
      setTableError(false);
      setRows(prev => {
        const next = { ...prev };
        for (const r of (data ?? []) as PipaStockRow[]) next[r.product_type] = r;
        return next;
      });
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchStock(); }, [fetchStock]);

  async function persist(product: PipaProductType, patch: Partial<Pick<PipaStockRow, "remaining_containers" | "wholesale_assignment">>) {
    setSaving(product);
    const existing = rows[product];
    const { data, error } = await supabase
      .from(PIPA_STOCK_TABLE)
      .upsert({
        product_type: product,
        remaining_containers: patch.remaining_containers ?? existing.remaining_containers,
        wholesale_assignment: "wholesale_assignment" in patch ? patch.wholesale_assignment : existing.wholesale_assignment,
      }, { onConflict: "product_type" })
      .select()
      .single();
    setSaving(null);
    if (!error && data) {
      setRows(prev => ({ ...prev, [product]: data as PipaStockRow }));
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(PIPA_STOCK_SETUP_SQL);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (tableError) {
    return (
      <div className="bg-pale-gold border border-amber-100 rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <AlertCircle className="w-5 h-5 text-pale-gold-foreground shrink-0" />
          <p className="text-pale-gold-foreground font-semibold text-sm">One-time setup required</p>
        </div>
        <p className="text-pale-gold-foreground/80 text-xs mb-3">
          Run this SQL once in your Supabase SQL Editor to enable Pipa Remaining tracking:
        </p>
        <pre className="bg-slate-900 rounded-lg p-3 text-xs text-slate-100 font-mono overflow-x-auto whitespace-pre-wrap mb-3">
          {PIPA_STOCK_SETUP_SQL}
        </pre>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-xs bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-lg px-3 py-1.5 transition-colors"
        >
          <Copy className="w-3 h-3" />
          {copied ? "Copied!" : "Copy SQL"}
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-100 shadow-sm rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
        <Container className="w-4 h-4 text-pale-blue-foreground" />
        <h2 className="text-slate-900 font-semibold text-sm">Pipa Remaining</h2>
        <span className="ml-auto text-slate-400 text-xs">Container stock by product</span>
      </div>

      {loading ? (
        <div className="py-10 text-center"><Loader2 className="w-5 h-5 text-blue-300 animate-spin mx-auto" /></div>
      ) : (
        <div className="divide-y divide-slate-100">
          {PIPA_PRODUCT_TYPES.map(product => {
            const row = rows[product];
            const isSelected = !!selected[product];
            const isEditingQty = editingQty === product;
            const isEditingAssign = editingAssign === product;
            const isAssigned = !!row.wholesale_assignment;
            const totalLiters = pipaTotalLiters(row.remaining_containers);

            return (
              <div key={product} className="px-5 py-4">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setSelected(s => ({ ...s, [product]: !s[product] }))}
                    title={isSelected ? "Selected" : "Select"}
                    aria-pressed={isSelected}
                    className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-all ${
                      isSelected ? "bg-slate-100 text-slate-300" : "bg-pale-blue text-pale-blue-foreground"
                    }`}
                  >
                    <Container className="w-4 h-4" />
                  </button>

                  <div className="min-w-0 flex-1">
                    <p className="text-slate-900 font-semibold text-sm">{PIPA_PRODUCT_LABELS[product]}</p>
                    <p className="text-slate-400 text-xs mt-0.5 tabular-nums">
                      {totalLiters.toLocaleString("en-US", { maximumFractionDigits: 1 })} L total
                    </p>
                  </div>

                  <span className={`text-[10px] font-bold px-2 py-1 rounded-full shrink-0 ${
                    isAssigned ? "bg-pale-gold text-pale-gold-foreground" : "bg-pale-green text-pale-green-foreground"
                  }`}>
                    {isAssigned ? "Assigned" : "Available"}
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
                  {/* Remaining quantity */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500 font-medium">Remaining:</span>
                    {isEditingQty ? (
                      <>
                        <input
                          autoFocus
                          type="text"
                          inputMode="numeric"
                          value={qtyDraft}
                          onChange={e => setQtyDraft(e.target.value.replace(/\D/g, ""))}
                          onKeyDown={e => {
                            if (e.key === "Enter") { persist(product, { remaining_containers: parseInt(qtyDraft || "0", 10) }); setEditingQty(null); }
                            if (e.key === "Escape") setEditingQty(null);
                          }}
                          className="w-16 bg-slate-50 border border-slate-200 text-slate-900 text-sm font-bold rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-300/50"
                        />
                        <button
                          onClick={() => { persist(product, { remaining_containers: parseInt(qtyDraft || "0", 10) }); setEditingQty(null); }}
                          className="text-pale-green-foreground hover:opacity-80 p-1" aria-label="Save remaining quantity">
                          <Check className="w-4 h-4" />
                        </button>
                        <button onClick={() => setEditingQty(null)} className="text-slate-400 hover:text-slate-600 p-1" aria-label="Cancel">
                          <X className="w-4 h-4" />
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => { setEditingQty(product); setQtyDraft(String(row.remaining_containers)); }}
                        className="flex items-center gap-1.5 text-slate-900 font-bold text-base tabular-nums hover:opacity-70 transition-opacity"
                      >
                        {saving === product ? <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" /> : row.remaining_containers}
                        <Pencil className="w-3 h-3 text-slate-300" />
                      </button>
                    )}
                  </div>

                  {/* Wholesale assignment */}
                  <div className="flex items-center gap-2 ml-auto">
                    {isEditingAssign ? (
                      <>
                        <input
                          autoFocus
                          type="text"
                          value={assignDraft}
                          onChange={e => setAssignDraft(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === "Enter") { persist(product, { wholesale_assignment: assignDraft.trim() || null }); setEditingAssign(null); }
                            if (e.key === "Escape") setEditingAssign(null);
                          }}
                          placeholder="Customer / order name"
                          className="w-40 bg-slate-50 border border-slate-200 text-slate-900 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300/50"
                        />
                        <button
                          onClick={() => { persist(product, { wholesale_assignment: assignDraft.trim() || null }); setEditingAssign(null); }}
                          className="text-pale-green-foreground hover:opacity-80 p-1" aria-label="Save wholesale assignment">
                          <Check className="w-4 h-4" />
                        </button>
                        <button onClick={() => setEditingAssign(null)} className="text-slate-400 hover:text-slate-600 p-1" aria-label="Cancel">
                          <X className="w-4 h-4" />
                        </button>
                      </>
                    ) : isAssigned ? (
                      <button
                        onClick={() => { setEditingAssign(product); setAssignDraft(row.wholesale_assignment ?? ""); }}
                        className="flex items-center gap-1.5 text-xs text-pale-gold-foreground hover:opacity-80 font-medium"
                      >
                        <Building2 className="w-3.5 h-3.5" />
                        {row.wholesale_assignment}
                      </button>
                    ) : (
                      <button
                        onClick={() => { setEditingAssign(product); setAssignDraft(""); }}
                        className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-pale-blue-foreground font-medium transition-colors"
                      >
                        <Building2 className="w-3.5 h-3.5" />
                        Assign to Wholesale
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
