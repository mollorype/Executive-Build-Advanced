import { useEffect, useState, useCallback } from "react";
import {
  PackageSearch, CheckCircle, XCircle, Plus,
  ChevronLeft, ChevronRight, AlertTriangle, Lock, Unlock,
  X, Edit3, Zap, Play, Trash2,
} from "lucide-react";
import { supabase, FuelPurchaseOrder } from "@/lib/supabase";
import { runFIFOEngine, forceClosePO, verifyPO, calcNetProfit, FIFORunResult } from "@/lib/fifo-engine";

const PAGE_SIZE = 20;

const PRODUCT_LABELS: Record<string, string> = {
  "92": "Fuel 92 Ron",
  "95": "Fuel 95 Ron",
  PD: "Premium Diesel",
  D: "Normal Diesel",
  pipa: "Pipa",
};

const STATUS_CONFIG = {
  ACTIVE: { label: "ACTIVE", bg: "bg-emerald-900/40", border: "border-emerald-600/40", text: "text-emerald-300", dot: "bg-emerald-400" },
  QUEUED: { label: "QUEUED", bg: "bg-amber-900/20", border: "border-amber-700/30", text: "text-amber-300", dot: "bg-amber-400" },
  DONE:   { label: "DONE",   bg: "bg-slate-800/40",  border: "border-slate-700/30",  text: "text-slate-400",  dot: "bg-slate-500" },
};

function mmk(v: number | null | undefined) {
  if (v == null) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(v) + " MMK";
}

function liters(v: number | null | undefined) {
  if (v == null) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(v) + " L";
}

function pct(remaining: number, initial: number) {
  if (!initial) return 0;
  return Math.max(0, Math.min(100, (remaining / initial) * 100));
}

// ─── Force Close Modal ──────────────────────────────────────────────────────

function ForceCloseModal({
  po,
  onClose,
  onDone,
}: {
  po: FuelPurchaseOrder;
  onClose: () => void;
  onDone: () => void;
}) {
  const [physical, setPhysical] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function handle() {
    const val = parseFloat(physical);
    if (isNaN(val) || val < 0) { setErr("Enter a valid dip-stick reading (liters)."); return; }
    setLoading(true);
    const res = await forceClosePO(po.id, val, po.remaining_volume);
    setLoading(false);
    if (!res.success) { setErr(res.error ?? "Unknown error"); return; }
    onDone();
  }

  const shortage = physical ? Math.max(0, po.remaining_volume - parseFloat(physical || "0")) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-[#111827] border border-red-700/40 rounded-xl p-6 w-full max-w-md shadow">
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-500 hover:text-white">
          <X className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-red-900/40 border border-red-700/40 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <p className="text-white font-bold">Force Close — Dip Mismatch</p>
            <p className="text-slate-400 text-xs mt-0.5">{PRODUCT_LABELS[po.product_type]} · PO #{po.id.slice(0, 8).toUpperCase()}</p>
          </div>
        </div>

        <div className="bg-slate-800/50 border border-slate-700/30 rounded-xl p-4 mb-4 text-sm">
          <div className="flex justify-between mb-1">
            <span className="text-slate-400">Expected Remaining</span>
            <span className="text-white font-medium">{liters(po.remaining_volume)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Calibration Factor</span>
            <span className="text-white font-medium">{po.calibration_factor.toFixed(2)}</span>
          </div>
        </div>

        <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
          Physical Dip-Stick Reading (Liters)
        </label>
        <input
          type="number"
          min="0"
          step="0.01"
          value={physical}
          onChange={e => { setPhysical(e.target.value); setErr(""); }}
          placeholder="Enter actual physical volume…"
          className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 mb-3"
        />

        {shortage != null && !isNaN(shortage) && (
          <div className={`rounded-xl px-4 py-3 mb-3 text-sm flex justify-between ${
            shortage > 0 ? "bg-red-900/30 border border-red-700/40" : "bg-emerald-900/20 border border-emerald-700/30"
          }`}>
            <span className={shortage > 0 ? "text-red-300" : "text-emerald-300"}>
              {shortage > 0 ? "Shortage" : "Surplus"}
            </span>
            <span className={`font-bold ${shortage > 0 ? "text-red-300" : "text-emerald-300"}`}>
              {liters(Math.abs(shortage))}
            </span>
          </div>
        )}

        {err && <p className="text-red-400 text-xs mb-3">{err}</p>}

        <button
          onClick={handle}
          disabled={loading || !physical}
          className="w-full bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-xl py-3 text-sm transition-all"
        >
          {loading ? "Closing…" : "Confirm Force Close"}
        </button>
      </div>
    </div>
  );
}

// ─── Verify / Edit Modal ─────────────────────────────────────────────────────

function VerifyModal({
  po,
  onClose,
  onDone,
}: {
  po: FuelPurchaseOrder;
  onClose: () => void;
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    wholesale_price: String(po.wholesale_price ?? ""),
    transportation_fees: String(po.transportation_fees ?? ""),
    confidential_fees: String(po.confidential_fees ?? ""),
    retail_price_set: String(po.retail_price_set ?? ""),
  });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  function num(s: string) { const v = parseFloat(s); return isNaN(v) ? null : v; }

  async function handle() {
    const w = num(form.wholesale_price);
    const t = num(form.transportation_fees);
    const c = num(form.confidential_fees);
    const r = num(form.retail_price_set);
    if (w == null || t == null || c == null || r == null) {
      setErr("All four fields are required."); return;
    }
    setLoading(true);
    const res = await verifyPO(po.id, {
      wholesale_price: w,
      transportation_fees: t,
      confidential_fees: c,
      retail_price_set: r,
    });
    setLoading(false);
    if (!res.success) { setErr(res.error ?? "Unknown error"); return; }
    onDone();
  }

  const Field = ({ label, field }: { label: string; field: keyof typeof form }) => (
    <div>
      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">{label}</label>
      <input
        type="number"
        min="0"
        step="0.01"
        value={form[field]}
        onChange={e => { setForm(f => ({ ...f, [field]: e.target.value })); setErr(""); }}
        placeholder="0"
        className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-[#111827] border border-slate-700/50 rounded-xl p-6 w-full max-w-md shadow">
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-500 hover:text-white">
          <X className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-blue-900/40 border border-blue-700/30 flex items-center justify-center">
            <Edit3 className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <p className="text-white font-bold">Unlock Net Profit</p>
            <p className="text-slate-400 text-xs mt-0.5">{PRODUCT_LABELS[po.product_type]} · PO #{po.id.slice(0, 8).toUpperCase()}</p>
          </div>
        </div>

        <div className="space-y-3 mb-4">
          <Field label="Wholesale Price (MMK / L)" field="wholesale_price" />
          <Field label="Transportation Fees (MMK / L)" field="transportation_fees" />
          <Field label="Confidential Fees (MMK / L)" field="confidential_fees" />
          <Field label="Retail Price Set (MMK / L)" field="retail_price_set" />
        </div>

        {err && <p className="text-red-400 text-xs mb-3">{err}</p>}

        <button
          onClick={handle}
          disabled={loading}
          className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-xl py-3 text-sm transition-all"
        >
          {loading ? "Saving…" : "Save & Unlock Profit"}
        </button>
      </div>
    </div>
  );
}

// ─── Create PO Form ──────────────────────────────────────────────────────────

function CreatePOForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [productType, setProductType] = useState<"92" | "95" | "PD" | "D" | "pipa">("92");
  const [volume, setVolume] = useState("");
  const [calibration, setCalibration] = useState("");
  const [wholesale, setWholesale] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");

  function reset() {
    setName(""); setProductType("92"); setVolume("");
    setCalibration(""); setWholesale(""); setErr(""); setOkMsg("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setOkMsg("");
    const vol = parseFloat(volume);
    if (!name.trim()) { setErr("PO Name is required."); return; }
    if (isNaN(vol) || vol <= 0) { setErr("Total Volume must be a positive number."); return; }
    const cal = calibration.trim() === "" ? 1.0 : parseFloat(calibration);
    if (isNaN(cal) || cal <= 0) { setErr("Calibration Factor must be a positive number."); return; }
    const ws = wholesale.trim() === "" ? 0 : parseFloat(wholesale);
    if (isNaN(ws) || ws < 0) { setErr("Wholesale Price must be 0 or greater."); return; }

    setSaving(true);
    const { error } = await supabase.from("fuel_purchase_orders").insert({
      name: name.trim(),
      product_type: productType,
      status: "QUEUED",
      initial_volume: vol,
      remaining_volume: vol,
      calibration_factor: cal,
      wholesale_price: ws,
      is_verified: false,
      total_volume_sold: 0,
    });
    setSaving(false);
    if (error) { setErr(error.message); return; }
    setOkMsg(`Created "${name.trim()}" — queued.`);
    reset();
    onCreated();
    setTimeout(() => setOkMsg(""), 3000);
  }

  return (
    <div className="bg-[#111827] border border-slate-700/50 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-5 py-4 flex items-center gap-2 hover:bg-slate-700/10 transition-colors"
      >
        <div className="w-7 h-7 rounded-lg bg-blue-500/20 flex items-center justify-center">
          <Plus className={`w-4 h-4 text-blue-400 transition-transform ${open ? "rotate-45" : ""}`} />
        </div>
        <h2 className="text-white font-semibold text-sm">Create New Purchase Order</h2>
        {okMsg && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-emerald-300 bg-emerald-900/30 border border-emerald-700/30 rounded-full px-2.5 py-1">
            <CheckCircle className="w-3 h-3" /> {okMsg}
          </span>
        )}
      </button>

      {open && (
        <form onSubmit={handleSubmit} className="px-5 pb-5 border-t border-slate-700/30 pt-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2">
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">PO Name</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Mandalay Depot Batch 23"
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Product Type</label>
              <select
                value={productType}
                onChange={e => setProductType(e.target.value as any)}
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none cursor-pointer"
              >
                <option value="92">92 Ron</option>
                <option value="95">95 Ron</option>
                <option value="PD">Premium Diesel (PD)</option>
                <option value="D">Normal Diesel (D)</option>
                <option value="pipa">Pipa</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Total Volume (Liters)</label>
              <input
                type="number" min="0" step="0.01"
                value={volume}
                onChange={e => setVolume(e.target.value)}
                placeholder="e.g. 10000"
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                Calibration Factor <span className="text-slate-600 normal-case font-normal">(default 1.00)</span>
              </label>
              <input
                type="number" min="0" step="0.01"
                value={calibration}
                onChange={e => setCalibration(e.target.value)}
                placeholder="1.00"
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                Wholesale Base Price (MMK/L) <span className="text-slate-600 normal-case font-normal">(default 0)</span>
              </label>
              <input
                type="number" min="0" step="0.01"
                value={wholesale}
                onChange={e => setWholesale(e.target.value)}
                placeholder="0"
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {err && (
            <div className="flex items-start gap-2 bg-red-900/20 border border-red-700/30 rounded-lg px-3 py-2 text-xs text-red-300">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              {err}
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-xl px-5 py-2.5 text-sm transition-all"
            >
              {saving
                ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Creating…</>
                : <><Plus className="w-4 h-4" /> Create Purchase Order</>}
            </button>
            <p className="text-slate-500 text-xs">Defaults to <span className="text-slate-300 font-semibold">QUEUED</span> — promote to ACTIVE from the table.</p>
          </div>
        </form>
      )}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function PORegistry() {
  const [pos, setPos] = useState<FuelPurchaseOrder[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);

  const [fifoRunning, setFifoRunning] = useState(false);
  const [fifoMsg, setFifoMsg] = useState("");
  const [fifoResult, setFifoResult] = useState<FIFORunResult | null>(null);

  const [forceCloseTarget, setForceCloseTarget] = useState<FuelPurchaseOrder | null>(null);
  const [verifyTarget, setVerifyTarget] = useState<FuelPurchaseOrder | null>(null);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const fetchPOs = useCallback(async (p: number) => {
    const from = p * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, error, count } = await supabase
      .from("fuel_purchase_orders")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);
    if (!error && data) {
      setPos(data as FuelPurchaseOrder[]);
      setTotalCount(count ?? 0);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchPOs(0).finally(() => setLoading(false));

    // Auto-run FIFO engine the moment a new shift is inserted into Supabase.
    const channel = supabase
      .channel("shifts-auto-fifo")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "daily_sales_reports" },
        async () => {
          if (fifoRunning) return;
          setFifoRunning(true);
          setFifoResult(null);
          setFifoMsg("New shift detected — recalculating inventory…");
          const r = await runFIFOEngine(setFifoMsg);
          setFifoRunning(false);
          setFifoResult(r);
          fetchPOs(page);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loading) fetchPOs(page);
  }, [page]);

  async function handleSetActive(po: FuelPurchaseOrder) {
    const confirmMsg = `Promote "${po.name ?? po.id.slice(0, 8)}" (${PRODUCT_LABELS[po.product_type]}) to ACTIVE?\n\nThis marks it as the current on-hand batch for this product.`;
    if (!window.confirm(confirmMsg)) return;
    const { error } = await supabase
      .from("fuel_purchase_orders")
      .update({ status: "ACTIVE" })
      .eq("id", po.id);
    if (error) { alert("Failed to set active: " + error.message); return; }
    fetchPOs(page);
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === pos.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pos.map(p => p.id)));
    }
  }

  async function deletePOIds(ids: string[]): Promise<string | null> {
    const { data, error } = await supabase
      .from("fuel_purchase_orders")
      .delete()
      .in("id", ids)
      .select("id");
    if (error) return error.message;
    if (!data || data.length === 0) return "Supabase blocked the delete — go to Supabase → Table Editor → fuel_purchase_orders → RLS Policies and add a DELETE policy (e.g. USING (true)).";
    return null;
  }

  async function handleDeletePO(po: FuelPurchaseOrder) {
    if (!window.confirm(`Delete PO "${po.name ?? po.id.slice(0, 8)}" (${PRODUCT_LABELS[po.product_type]})?\n\nThis cannot be undone.`)) return;
    setDeleting(true);
    setDeleteError("");
    const err = await deletePOIds([po.id]);
    setDeleting(false);
    if (err) { setDeleteError(err); return; }
    setSelectedIds(prev => { const n = new Set(prev); n.delete(po.id); return n; });
    fetchPOs(page);
  }

  async function handleDeleteSelected() {
    const ids = [...selectedIds];
    if (!ids.length) return;
    if (!window.confirm(`Delete ${ids.length} selected PO${ids.length > 1 ? "s" : ""}?\n\nThis cannot be undone.`)) return;
    setDeleting(true);
    setDeleteError("");
    const err = await deletePOIds(ids);
    setDeleting(false);
    if (err) { setDeleteError(err); return; }
    setSelectedIds(new Set());
    fetchPOs(page);
  }

  async function handleRunFIFO() {
    setFifoRunning(true);
    setFifoResult(null);
    setFifoMsg("Initialising…");
    const result = await runFIFOEngine(setFifoMsg);
    setFifoRunning(false);
    setFifoResult(result);
    fetchPOs(page);
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const activePOs = pos.filter(p => p.status === "ACTIVE");

  return (
    <div className="flex-1 overflow-auto">
      {/* Header */}
      <div className="px-6 py-5 border-b border-slate-700/50">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white">PO Registry</h1>
            <p className="text-slate-400 text-sm mt-0.5">Fuel purchase orders · FIFO inventory engine</p>
          </div>
          <div className="flex items-center gap-2">
            {selectedIds.size > 0 && (
              <button
                onClick={handleDeleteSelected}
                disabled={deleting}
                className="flex items-center gap-2 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white font-semibold rounded-xl px-5 py-2.5 text-sm transition-all"
              >
                <Trash2 className="w-4 h-4" />
                {deleting ? "Deleting…" : `Delete Selected (${selectedIds.size})`}
              </button>
            )}
            <button
              onClick={handleRunFIFO}
              disabled={fifoRunning}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl px-5 py-2.5 text-sm transition-all"
            >
              {fifoRunning
                ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" /> Running…</>
                : <><Zap className="w-4 h-4" /> Run FIFO Engine</>
              }
            </button>
          </div>
        </div>

        {/* FIFO status bar */}
        {fifoRunning && (
          <div className="mt-3 rounded-xl px-4 py-2.5 text-sm flex items-center gap-2 border bg-slate-800/60 border-slate-700/30 text-slate-300">
            <span className="w-3 h-3 border border-slate-400/30 border-t-slate-300 rounded-full animate-spin shrink-0" />
            {fifoMsg}
          </div>
        )}

        {!fifoRunning && fifoResult && (
          <div className={`mt-3 rounded-xl px-4 py-3 text-sm border ${
            fifoResult.error
              ? "bg-red-900/20 border-red-700/30 text-red-300"
              : fifoResult.failedPOs > 0
              ? "bg-amber-900/20 border-amber-700/40 text-amber-200"
              : "bg-emerald-900/20 border-emerald-700/30 text-emerald-300"
          }`}>
            {fifoResult.error ? (
              <div className="flex items-start gap-2">
                <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">FIFO engine failed</p>
                  <p className="text-xs mt-0.5">{fifoResult.error}</p>
                </div>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  {fifoResult.failedPOs > 0
                    ? <AlertTriangle className="w-4 h-4 shrink-0" />
                    : <CheckCircle className="w-4 h-4 shrink-0" />}
                  <span className="font-bold">
                    {fifoResult.failedPOs > 0
                      ? `Completed with ${fifoResult.failedPOs} write failure${fifoResult.failedPOs > 1 ? "s" : ""}`
                      : "FIFO engine completed successfully"}
                  </span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  <div>
                    <span className="opacity-60">Shifts processed:</span>
                    <span className="font-bold ml-1">{fifoResult.processedShifts}</span>
                  </div>
                  <div>
                    <span className="opacity-60">POs updated:</span>
                    <span className="font-bold ml-1">{fifoResult.updatedPOs}</span>
                  </div>
                  <div>
                    <span className="opacity-60">Write failures:</span>
                    <span className={`font-bold ml-1 ${fifoResult.failedPOs > 0 ? "text-red-300" : ""}`}>{fifoResult.failedPOs}</span>
                  </div>
                  <div>
                    <span className="opacity-60">Total liters processed:</span>
                    <span className="font-bold ml-1">
                      {Object.values(fifoResult.productVolumes).reduce((a, b) => a + b, 0).toFixed(1)}
                    </span>
                  </div>
                </div>

                {Object.keys(fifoResult.productVolumes).length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {Object.entries(fifoResult.productVolumes).map(([p, vol]) => (
                      <span key={p} className="text-xs bg-black/20 rounded-full px-2.5 py-0.5">
                        {PRODUCT_LABELS[p]}: <span className="font-bold">{vol.toFixed(1)} L</span>
                      </span>
                    ))}
                  </div>
                )}

                {fifoResult.failures.length > 0 && (
                  <details className="mt-3 text-xs">
                    <summary className="cursor-pointer font-semibold text-red-300 hover:text-red-200">
                      Show {fifoResult.failures.length} failure detail{fifoResult.failures.length > 1 ? "s" : ""}
                    </summary>
                    <ul className="mt-2 space-y-1 bg-black/30 rounded-lg p-3 font-mono">
                      {fifoResult.failures.map((f, i) => (
                        <li key={i} className="text-red-300">• {f}</li>
                      ))}
                    </ul>
                  </details>
                )}

                {fifoResult.processedShifts === 0 && (
                  <p className="text-xs mt-2 opacity-80">
                    ⚠ No shifts were found in the database — nothing to deduct.
                  </p>
                )}
                {fifoResult.processedShifts > 0 && Object.keys(fifoResult.productVolumes).length === 0 && (
                  <p className="text-xs mt-2 opacity-80">
                    ⚠ Shifts exist but contain no fuel-liter data (fuel_92_liters, fuel_95_liters, premium_diesel_liters, pipa_amount, or diesel_cash + diesel_price). Nothing to deduct.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="p-6 space-y-6">
        {/* Create New PO */}
        <CreatePOForm onCreated={() => fetchPOs(page)} />

        {/* Active PO Cards */}
        {activePOs.length > 0 && (
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Active Batches</p>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {activePOs.map(po => {
                const fill = pct(po.remaining_volume, po.initial_volume);
                const profit = calcNetProfit(po);
                return (
                  <div key={po.id} className="bg-[#111827] border border-emerald-600/25 rounded-xl p-5 relative overflow-hidden">
                    {/* Progress bar background */}
                    <div
                      className="absolute inset-0 bg-emerald-500/5 origin-left transition-all"
                      style={{ width: `${fill}%` }}
                    />
                    <div className="relative">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <p className="text-white font-bold">{PRODUCT_LABELS[po.product_type]}</p>
                          <p className="text-slate-500 text-xs font-mono mt-0.5">#{po.id.slice(0, 8).toUpperCase()}</p>
                        </div>
                        <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-300 bg-emerald-900/40 border border-emerald-600/30 rounded-full px-2.5 py-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          ACTIVE
                        </span>
                      </div>

                      {/* Volume bar */}
                      <div className="mb-3">
                        <div className="flex justify-between text-xs text-slate-400 mb-1">
                          <span>Remaining</span>
                          <span className="font-semibold text-white">{fill.toFixed(1)}%</span>
                        </div>
                        <div className="h-2 bg-slate-700/60 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              fill < 20 ? "bg-red-500" : fill < 50 ? "bg-amber-500" : "bg-emerald-500"
                            }`}
                            style={{ width: `${fill}%` }}
                          />
                        </div>
                        <div className="flex justify-between text-xs text-slate-500 mt-1">
                          <span>{liters(po.remaining_volume)}</span>
                          <span>of {liters(po.initial_volume)}</span>
                        </div>
                      </div>

                      {/* Calibration */}
                      <div className="flex justify-between text-xs mb-4">
                        <span className="text-slate-400">Calibration Factor</span>
                        <span className="text-slate-300 font-mono">{po.calibration_factor.toFixed(2)}</span>
                      </div>

                      {/* Profit badge */}
                      <div className="mb-4">
                        {!po.is_verified ? (
                          <div className="flex items-center gap-2 bg-slate-800/60 border border-slate-700/30 rounded-lg px-3 py-2">
                            <Lock className="w-3.5 h-3.5 text-slate-500" />
                            <span className="text-slate-500 text-xs font-semibold tracking-wider">[ PENDING ] — Costs not verified</span>
                          </div>
                        ) : profit != null ? (
                          <div className={`flex items-center justify-between rounded-lg px-3 py-2 border ${
                            profit >= 0
                              ? "bg-emerald-900/30 border-emerald-700/30"
                              : "bg-red-900/30 border-red-700/30"
                          }`}>
                            <span className="text-xs font-semibold text-slate-400 flex items-center gap-1">
                              <Unlock className="w-3 h-3" /> Net Profit
                            </span>
                            <span className={`font-bold text-sm tabular-nums ${profit >= 0 ? "text-emerald-300" : "text-red-300"}`}>
                              {profit >= 0 ? "+" : ""}{mmk(profit)}
                            </span>
                          </div>
                        ) : null}
                      </div>

                      {/* Actions */}
                      <div className="flex gap-2">
                        <button
                          onClick={() => setForceCloseTarget(po)}
                          className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold text-red-400 hover:text-red-300 bg-red-900/20 hover:bg-red-900/30 border border-red-700/30 rounded-lg py-2 transition-all"
                        >
                          <AlertTriangle className="w-3.5 h-3.5" />
                          Force Close / Dip Mismatch
                        </button>
                        <button
                          onClick={() => setVerifyTarget(po)}
                          className="flex items-center justify-center gap-1.5 text-xs font-semibold text-blue-400 hover:text-blue-300 bg-blue-900/20 hover:bg-blue-900/30 border border-blue-700/30 rounded-lg px-3 py-2 transition-all"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          {po.is_verified ? "Edit" : "Verify"}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* PO Table */}
        <div className="bg-[#111827] border border-slate-700/50 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-700/40 flex items-center gap-2">
            <PackageSearch className="w-4 h-4 text-blue-400" />
            <h2 className="text-white font-semibold text-sm">All Purchase Orders</h2>
            <span className="ml-auto text-slate-500 text-xs">{totalCount} total</span>
          </div>
          {deleteError && (
            <div className="mx-5 mt-4 flex items-start gap-2 bg-red-900/30 border border-red-700/40 rounded-xl px-4 py-3 text-xs text-red-300">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{deleteError}</span>
              <button onClick={() => setDeleteError("")} className="ml-auto text-red-400 hover:text-red-200"><X className="w-3.5 h-3.5" /></button>
            </div>
          )}

          {loading ? (
            <div className="p-16 text-center">
              <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mx-auto mb-3" />
              <p className="text-slate-500 text-sm">Loading purchase orders…</p>
            </div>
          ) : pos.length === 0 ? (
            <div className="p-16 text-center">
              <PackageSearch className="w-10 h-10 text-slate-700 mx-auto mb-3" />
              <p className="text-slate-400 text-sm font-medium">No purchase orders found</p>
              <p className="text-slate-600 text-xs mt-1">Add records to the fuel_purchase_orders table in Supabase</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px]">
                <thead>
                  <tr className="border-b border-slate-700/40">
                    <th className="px-5 py-3 w-10">
                      <input type="checkbox"
                        checked={pos.length > 0 && selectedIds.size === pos.length}
                        onChange={toggleSelectAll}
                        className="w-4 h-4 rounded accent-red-500 cursor-pointer"
                      />
                    </th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">PO Name</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Product</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                    <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Initial Vol</th>
                    <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Remaining</th>
                    <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Sold</th>
                    <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Shortage</th>
                    <th className="text-center px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Cal. Factor</th>
                    <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Net Profit</th>
                    <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pos.map(po => {
                    const cfg = STATUS_CONFIG[po.status];
                    const profit = calcNetProfit(po);
                    const fillPct = pct(po.remaining_volume, po.initial_volume);
                    return (
                      <tr key={po.id} className={`border-b border-slate-700/20 last:border-0 transition-colors ${selectedIds.has(po.id) ? "bg-red-900/10" : "hover:bg-slate-700/10"}`}>
                        <td className="px-5 py-3.5" onClick={e => e.stopPropagation()}>
                          <input type="checkbox"
                            checked={selectedIds.has(po.id)}
                            onChange={() => toggleSelect(po.id)}
                            className="w-4 h-4 rounded accent-red-500 cursor-pointer"
                          />
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex flex-col">
                            <span className="text-white text-sm font-semibold">{po.name ?? "—"}</span>
                            <span className="text-slate-500 text-xs font-mono mt-0.5">#{po.id.slice(0, 8).toUpperCase()}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3.5 text-slate-300 text-sm">{PRODUCT_LABELS[po.product_type]}</td>
                        <td className="px-5 py-3.5">
                          <span className={`inline-flex items-center gap-1.5 text-xs font-semibold rounded-full px-2.5 py-1 border ${cfg.bg} ${cfg.border} ${cfg.text}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot} ${po.status === "ACTIVE" ? "animate-pulse" : ""}`} />
                            {cfg.label}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-right text-slate-300 text-sm tabular-nums">{liters(po.initial_volume)}</td>
                        <td className="px-5 py-3.5 text-right">
                          <div className="flex flex-col items-end gap-1">
                            <span className={`text-sm font-semibold tabular-nums ${fillPct < 20 ? "text-red-400" : "text-white"}`}>
                              {liters(po.remaining_volume)}
                            </span>
                            {po.status === "ACTIVE" && (
                              <div className="w-16 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${fillPct < 20 ? "bg-red-500" : fillPct < 50 ? "bg-amber-500" : "bg-emerald-500"}`}
                                  style={{ width: `${fillPct}%` }}
                                />
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-3.5 text-right text-slate-400 text-sm tabular-nums">
                          {liters(po.total_volume_sold)}
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          {po.shortage_liters != null ? (
                            <span className="text-red-400 text-sm font-semibold tabular-nums">{liters(po.shortage_liters)}</span>
                          ) : (
                            <span className="text-slate-600 text-sm">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-center text-slate-300 text-sm font-mono">
                          {po.calibration_factor.toFixed(2)}
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          {!po.is_verified ? (
                            <span className="inline-flex items-center gap-1 text-xs text-slate-500 bg-slate-800/60 border border-slate-700/30 rounded-full px-2.5 py-1">
                              <Lock className="w-3 h-3" /> PENDING
                            </span>
                          ) : profit != null ? (
                            <span className={`text-sm font-bold tabular-nums ${profit >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                              {profit >= 0 ? "+" : ""}{mmk(profit)}
                            </span>
                          ) : (
                            <span className="text-slate-600 text-sm">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-1">
                            {po.status === "QUEUED" && (
                              <button
                                onClick={() => handleSetActive(po)}
                                title="Promote to ACTIVE — current on-hand batch"
                                className="flex items-center gap-1 text-xs font-semibold text-emerald-400 hover:text-emerald-300 bg-emerald-900/20 hover:bg-emerald-900/30 border border-emerald-700/30 rounded-lg px-2.5 py-1.5 transition-all"
                              >
                                <Play className="w-3 h-3" />
                                Set Active
                              </button>
                            )}
                            {po.status === "ACTIVE" && (
                              <button
                                onClick={() => setForceCloseTarget(po)}
                                title="Force Close / Dip Mismatch"
                                className="text-red-400 hover:text-red-300 hover:bg-red-900/20 p-1.5 rounded-lg transition-all"
                              >
                                <AlertTriangle className="w-4 h-4" />
                              </button>
                            )}
                            <button
                              onClick={() => setVerifyTarget(po)}
                              title={po.is_verified ? "Edit costs" : "Verify costs"}
                              className="text-blue-400 hover:text-blue-300 hover:bg-blue-900/20 p-1.5 rounded-lg transition-all"
                            >
                              {po.is_verified ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                            </button>
                            <button
                              onClick={() => handleDeletePO(po)}
                              title="Delete this PO"
                              className="text-slate-500 hover:text-red-400 hover:bg-red-900/20 p-1.5 rounded-lg transition-all"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="px-5 py-4 border-t border-slate-700/40 flex items-center justify-between">
              <p className="text-slate-500 text-xs">Page {page + 1} of {totalPages} · {totalCount} POs</p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 border border-slate-700 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-700 transition-all"
                >
                  <ChevronLeft className="w-3.5 h-3.5" /> Previous
                </button>
                <button
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 border border-slate-700 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-700 transition-all"
                >
                  Next <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {forceCloseTarget && (
        <ForceCloseModal
          po={forceCloseTarget}
          onClose={() => setForceCloseTarget(null)}
          onDone={() => { setForceCloseTarget(null); fetchPOs(page); }}
        />
      )}
      {verifyTarget && (
        <VerifyModal
          po={verifyTarget}
          onClose={() => setVerifyTarget(null)}
          onDone={() => { setVerifyTarget(null); fetchPOs(page); }}
        />
      )}
    </div>
  );
}
