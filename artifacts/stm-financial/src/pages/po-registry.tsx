import { useEffect, useState, useCallback } from "react";
import {
  PackageSearch, CheckCircle, XCircle, Plus,
  ChevronLeft, ChevronRight, AlertTriangle, Lock, Unlock,
  X, Edit3, Zap, Play, Trash2,
} from "lucide-react";
import { supabase, FuelPurchaseOrder } from "@/lib/supabase";
import { runFIFOEngine, forceClosePO, verifyPO, calcNetProfit, FIFORunResult } from "@/lib/fifo-engine";
import PipaStockSummary from "@/components/pipa/stock-summary-card";
import { makeT, useLang, type Lang } from "@/lib/app-i18n";
import { confirmDialog, messageDialog } from "@/components/confirm-dialog";

const useT = makeT({
  // Force close
  badDip: { en: "Enter a valid dip-stick reading (liters).", my: "မှန်ကန်သော dip-stick တိုင်းတာချက် (လီတာ) ထည့်ပါ။" },
  unknownError: { en: "Unknown error", my: "အမည်မသိ အမှား" },
  close: { en: "Close", my: "ပိတ်ရန်" },
  forceCloseTitle: { en: "Force Close — Dip Mismatch", my: "အတင်းပိတ်ရန် — Dip မကိုက်ညီ" },
  expectedRemaining: { en: "Expected Remaining", my: "ကျန်ရမည့် ပမာဏ" },
  calibration: { en: "Calibration Factor", my: "Calibration Factor" },
  dipReading: { en: "Physical Dip-Stick Reading (L)", my: "Dip-Stick တိုင်းတာချက် အမှန် (L)" },
  dipPlaceholder: { en: "Enter actual physical volume…", my: "တကယ်ရှိသော ပမာဏ ထည့်ပါ…" },
  shortage: { en: "Shortage", my: "လိုငွေ" },
  surplus: { en: "Surplus", my: "ပိုငွေ" },
  cancel: { en: "Cancel", my: "မလုပ်တော့ပါ" },
  closing: { en: "Closing…", my: "ပိတ်နေသည်…" },
  confirmForceClose: { en: "Confirm Force Close", my: "အတင်းပိတ်ရန် အတည်ပြု" },
  // Verify
  allFour: { en: "All four fields are required.", my: "အကွက် လေးခုလုံး ဖြည့်ရန် လိုအပ်သည်။" },
  unlockProfit: { en: "Unlock Net Profit", my: "အသားတင်အမြတ် ဖွင့်ရန်" },
  wholesale: { en: "Wholesale Price (MMK/L)", my: "လက်ကား စျေး (MMK/L)" },
  transport: { en: "Transportation Fees (MMK/L)", my: "သယ်ယူစရိတ် (MMK/L)" },
  confidential: { en: "Confidential Fees (MMK/L)", my: "လျှို့ဝှက် စရိတ် (MMK/L)" },
  retail: { en: "Retail Price Set (MMK/L)", my: "လက်လီ စျေး (MMK/L)" },
  saving: { en: "Saving…", my: "သိမ်းနေသည်…" },
  saveUnlock: { en: "Save & Unlock Profit", my: "သိမ်းပြီး အမြတ် ဖွင့်ရန်" },
  // Create
  nameRequired: { en: "PO Name is required.", my: "PO အမည် လိုအပ်သည်။" },
  volPositive: { en: "Total Volume must be a positive number.", my: "စုစုပေါင်း ပမာဏ သည် အပေါင်းကိန်း ဖြစ်ရမည်။" },
  calPositive: { en: "Calibration Factor must be a positive number.", my: "Calibration Factor သည် အပေါင်းကိန်း ဖြစ်ရမည်။" },
  wsMin: { en: "Wholesale Price must be 0 or greater.", my: "လက်ကား စျေး သည် 0 သို့မဟုတ် ပိုများရမည်။" },
  created: { en: "Created \"{name}\" — queued.", my: "\"{name}\" ဖန်တီးပြီး — စောင့်ဆိုင်းစာရင်းတွင်။" },
  createTitle: { en: "Create New Purchase Order", my: "အော်ဒါ (PO) အသစ် ဖန်တီးရန်" },
  poName: { en: "PO Name", my: "PO အမည်" },
  poNamePh: { en: "e.g. Mandalay Depot Batch 23", my: "ဥပမာ - မန္တလေး Depot အသုတ် 23" },
  productType: { en: "Product Type", my: "ကုန်ပစ္စည်း အမျိုးအစား" },
  totalVolume: { en: "Total Volume (L)", my: "စုစုပေါင်း ပမာဏ (L)" },
  egVolume: { en: "e.g. 10000", my: "ဥပမာ 10000" },
  default1: { en: "(default 1.00)", my: "(မူလ 1.00)" },
  default0: { en: "(default 0)", my: "(မူလ 0)" },
  creating: { en: "Creating…", my: "ဖန်တီးနေသည်…" },
  createPO: { en: "Create Purchase Order", my: "PO ဖန်တီးရန်" },
  defaultsA: { en: "Defaults to ", my: "မူလအားဖြင့် " },
  defaultsB: { en: " — promote to ACTIVE from the table.", my: " ဖြစ်သည် — ဇယားမှ အသုံးပြုဆဲ သို့ ပြောင်းပါ။" },
  // Statuses
  ACTIVE: { en: "ACTIVE", my: "အသုံးပြုဆဲ" },
  QUEUED: { en: "QUEUED", my: "စောင့်ဆိုင်း" },
  DONE: { en: "DONE", my: "ပြီးဆုံး" },
  // Page
  confirmActive: { en: "Promote \"{name}\" ({product}) to ACTIVE?\n\nThis marks it as the current on-hand batch for this product.", my: "\"{name}\" ({product}) ကို အသုံးပြုဆဲ အဖြစ် ပြောင်းမလား?\n\nဤကုန်ပစ္စည်းအတွက် လက်ရှိ အသုတ်အဖြစ် သတ်မှတ်ပါမည်။" },
  activeFailed: { en: "Failed to set active: ", my: "အသုံးပြုဆဲ အဖြစ် မပြောင်းနိုင်ပါ: " },
  blocked: { en: "The delete was blocked by a permissions rule. Contact your system administrator.", my: "ခွင့်ပြုချက် စည်းကမ်းကြောင့် မဖျက်နိုင်ပါ။" },
  confirmDelete: { en: "Delete PO \"{name}\" ({product})?\n\nThis cannot be undone.", my: "PO \"{name}\" ({product}) ကို ဖျက်မလား?\n\nပြန်ယူ၍ မရပါ။" },
  confirmDeleteMany: { en: "Delete {n} selected PO(s)?\n\nThis cannot be undone.", my: "ရွေးထားသော PO {n} ခုကို ဖျက်မလား?\n\nပြန်ယူ၍ မရပါ။" },
  init: { en: "Initializing…", my: "စတင်နေသည်…" },
  newShift: { en: "New shift detected — recalculating inventory…", my: "ဆိုင်းအသစ် ရောက်လာ — လက်ကျန် ပြန်တွက်နေသည်…" },
  title: { en: "PO Registry", my: "PO မှတ်ပုံတင်" },
  subtitle: { en: "Fuel purchase orders · FIFO inventory engine", my: "ဆီ အော်ဒါများ · FIFO လက်ကျန် တွက်စက်" },
  deleting: { en: "Deleting…", my: "ဖျက်နေသည်…" },
  deleteSelected: { en: "Delete Selected ({n})", my: "ရွေးထားသည်ကို ဖျက်ရန် ({n})" },
  running: { en: "Running…", my: "လုပ်ဆောင်နေသည်…" },
  runFifo: { en: "Run FIFO Engine", my: "FIFO တွက်ရန်" },
  fifoFailed: { en: "FIFO engine failed", my: "FIFO တွက်ချက်မှု မအောင်မြင်ပါ" },
  completedFailures: { en: "Completed with {n} write failure(s)", my: "ပြီးဆုံး — သိမ်းမရသည် {n} ခု" },
  completedOk: { en: "FIFO engine completed successfully", my: "FIFO တွက်ချက်မှု အောင်မြင်စွာ ပြီးဆုံး" },
  shiftsProcessed: { en: "Shifts processed:", my: "တွက်ပြီး ဆိုင်း:" },
  posUpdated: { en: "POs updated:", my: "ပြင်ပြီး PO:" },
  writeFailures: { en: "Write failures:", my: "သိမ်းမရ:" },
  totalLiters: { en: "Total liters processed:", my: "တွက်ပြီး လီတာ စုစုပေါင်း:" },
  showFailures: { en: "Show {n} failure detail(s)", my: "အမှား အသေးစိတ် {n} ခု ပြရန်" },
  noShifts: { en: "No shifts were found — nothing to deduct.", my: "ဆိုင်း မတွေ့ပါ — နုတ်စရာ မရှိပါ။" },
  noLiters: { en: "Shifts exist but none report fuel liters sold. Nothing to deduct.", my: "ဆိုင်းများ ရှိသော်လည်း ရောင်းလီတာ မပါပါ။ နုတ်စရာ မရှိပါ။" },
  activeBatches: { en: "Active Batches", my: "အသုံးပြုဆဲ အသုတ်များ" },
  remaining: { en: "Remaining", my: "ကျန်" },
  of: { en: "of {n}", my: "{n} အနက်" },
  pendingCosts: { en: "[ PENDING ] — Costs not verified", my: "[ စောင့်ဆဲ ] — ကုန်ကျစရိတ် မစစ်ရသေး" },
  netProfit: { en: "Net Profit", my: "အသားတင်အမြတ်" },
  forceCloseBtn: { en: "Force Close / Dip Mismatch", my: "အတင်းပိတ် / Dip မကိုက်" },
  edit: { en: "Edit", my: "ပြင်ရန်" },
  verify: { en: "Verify", my: "စစ်ရန်" },
  allPOs: { en: "All Purchase Orders", my: "PO အားလုံး" },
  total: { en: "{n} total", my: "စုစုပေါင်း {n}" },
  dismissError: { en: "Dismiss error", my: "ပိတ်ရန်" },
  loading: { en: "Loading purchase orders…", my: "PO များ ဖွင့်နေသည်…" },
  none: { en: "No purchase orders found", my: "PO မရှိပါ" },
  getStarted: { en: "Create a purchase order to get started", my: "စတင်ရန် PO တစ်ခု ဖန်တီးပါ" },
  selectAll: { en: "Select all purchase orders", my: "PO အားလုံး ရွေးရန်" },
  product: { en: "Product", my: "ကုန်ပစ္စည်း" },
  status: { en: "Status", my: "အခြေအနေ" },
  initialVol: { en: "Initial Vol", my: "မူလ ပမာဏ" },
  sold: { en: "Sold", my: "ရောင်းပြီး" },
  calShort: { en: "Cal. Factor", my: "Cal. Factor" },
  actions: { en: "Actions", my: "လုပ်ဆောင်ချက်" },
  selectPO: { en: "Select purchase order {name}", my: "PO {name} ကို ရွေးရန်" },
  pending: { en: "PENDING", my: "စောင့်ဆဲ" },
  promoteTitle: { en: "Promote to ACTIVE — current on-hand batch", my: "အသုံးပြုဆဲ သို့ ပြောင်းရန် — လက်ရှိ အသုတ်" },
  setActive: { en: "Set Active", my: "အသုံးပြုရန်" },
  editCosts: { en: "Edit costs", my: "ကုန်ကျစရိတ် ပြင်ရန်" },
  verifyCosts: { en: "Verify costs", my: "ကုန်ကျစရိတ် စစ်ရန်" },
  deletePO: { en: "Delete this PO", my: "ဤ PO ကို ဖျက်ရန်" },
  page: { en: "Page {p} of {n} · {total} POs", my: "စာမျက်နှာ {p} / {n} · PO {total} ခု" },
  prev: { en: "Previous Page", my: "ယခင်" },
  next: { en: "Next Page", my: "နောက်" },
});

// Progress lines from the FIFO engine (lib/fifo-engine.ts), shown in the status bar.
const FIFO_PROGRESS: Record<string, string> = {
  "Fetching purchase orders…": "PO များ ရယူနေသည်…",
  "Fetching shifts…": "ဆိုင်းများ ရယူနေသည်…",
  "Writing results…": "ရလဒ် သိမ်းနေသည်…",
  "Done.": "ပြီးပါပြီ။",
};

const PAGE_SIZE = 20;

const PRODUCT_LABELS: Record<string, { en: string; my: string }> = {
  "92": { en: "92 RON", my: "92 RON" },
  "95": { en: "95 RON", my: "95 RON" },
  PD: { en: "PD (Premium Diesel)", my: "PD (ပရီမီယံ ဒီဇယ်)" },
  D: { en: "Diesel", my: "ဒီဇယ်" },
  pipa: { en: "P-P", my: "P-P" },
};
const productLabel = (code: string, lang: Lang) => PRODUCT_LABELS[code]?.[lang] ?? code;

const STATUS_CONFIG = {
  ACTIVE: { bg: "bg-pale-green", border: "border-emerald-100", text: "text-pale-green-foreground", dot: "bg-emerald-400" },
  QUEUED: { bg: "bg-pale-gold", border: "border-amber-100", text: "text-pale-gold-foreground", dot: "bg-amber-400" },
  DONE:   { bg: "bg-slate-50",  border: "border-slate-100",  text: "text-slate-400",  dot: "bg-slate-500" },
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
  const t = useT();
  const lang = useLang();
  const [physical, setPhysical] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function handle() {
    const val = parseFloat(physical);
    if (isNaN(val) || val < 0) { setErr(t("badDip")); return; }
    setLoading(true);
    const res = await forceClosePO(po.id, val, po.remaining_volume);
    setLoading(false);
    if (!res.success) { setErr(res.error ?? t("unknownError")); return; }
    onDone();
  }

  const shortage = physical ? Math.max(0, po.remaining_volume - parseFloat(physical || "0")) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-white border border-red-100 rounded-xl p-6 w-full max-w-md shadow">
        <button onClick={onClose} aria-label={t("close")} className="absolute top-4 right-4 text-slate-500 hover:text-slate-900">
          <X className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-pale-red border border-red-100 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-pale-red-foreground" />
          </div>
          <div>
            <p className="text-slate-900 font-bold">{t("forceCloseTitle")}</p>
            <p className="text-slate-400 text-xs mt-0.5">{productLabel(po.product_type, lang)} · PO #{po.id.slice(0, 8).toUpperCase()}</p>
          </div>
        </div>

        <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 mb-4 text-sm">
          <div className="flex justify-between mb-1">
            <span className="text-slate-400">{t("expectedRemaining")}</span>
            <span className="text-slate-900 font-medium">{liters(po.remaining_volume)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">{t("calibration")}</span>
            <span className="text-slate-900 font-medium">{po.calibration_factor.toFixed(2)}</span>
          </div>
        </div>

        <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
          {t("dipReading")}
        </label>
        <input
          type="number"
          min="0"
          step="0.01"
          value={physical}
          onChange={e => { setPhysical(e.target.value); setErr(""); }}
          placeholder={t("dipPlaceholder")}
          className="w-full bg-white border border-slate-100 text-slate-900 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 mb-3"
        />

        {shortage != null && !isNaN(shortage) && (
          <div className={`rounded-xl px-4 py-3 mb-3 text-sm flex justify-between ${
            shortage > 0 ? "bg-pale-red border border-red-100" : "bg-pale-green border border-emerald-100"
          }`}>
            <span className={shortage > 0 ? "text-pale-red-foreground" : "text-pale-green-foreground"}>
              {shortage > 0 ? t("shortage") : t("surplus")}
            </span>
            <span className={`font-bold ${shortage > 0 ? "text-pale-red-foreground" : "text-pale-green-foreground"}`}>
              {liters(Math.abs(shortage))}
            </span>
          </div>
        )}

        {err && <p className="text-pale-red-foreground text-xs mb-3">{err}</p>}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 bg-white hover:bg-slate-100 border border-slate-100 text-slate-700 font-semibold rounded-xl py-3 text-sm transition-all"
          >
            {t("cancel")}
          </button>
          <button
            onClick={handle}
            disabled={loading || !physical}
            className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-xl py-3 text-sm transition-all"
          >
            {loading ? t("closing") : t("confirmForceClose")}
          </button>
        </div>
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
  const tr = useT();
  const lang = useLang();
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
      setErr(tr("allFour")); return;
    }
    setLoading(true);
    const res = await verifyPO(po.id, {
      wholesale_price: w,
      transportation_fees: t,
      confidential_fees: c,
      retail_price_set: r,
    });
    setLoading(false);
    if (!res.success) { setErr(res.error ?? tr("unknownError")); return; }
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
        className="w-full bg-white border border-slate-100 text-slate-900 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-white border border-slate-100 rounded-xl p-6 w-full max-w-md shadow">
        <button onClick={onClose} aria-label={tr("close")} className="absolute top-4 right-4 text-slate-500 hover:text-slate-900">
          <X className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-pale-blue border border-blue-100 flex items-center justify-center">
            <Edit3 className="w-5 h-5 text-pale-blue-foreground" />
          </div>
          <div>
            <p className="text-slate-900 font-bold">{tr("unlockProfit")}</p>
            <p className="text-slate-400 text-xs mt-0.5">{productLabel(po.product_type, lang)} · PO #{po.id.slice(0, 8).toUpperCase()}</p>
          </div>
        </div>

        <div className="space-y-3 mb-4">
          <Field label={tr("wholesale")} field="wholesale_price" />
          <Field label={tr("transport")} field="transportation_fees" />
          <Field label={tr("confidential")} field="confidential_fees" />
          <Field label={tr("retail")} field="retail_price_set" />
        </div>

        {err && <p className="text-pale-red-foreground text-xs mb-3">{err}</p>}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 bg-white hover:bg-slate-100 border border-slate-100 text-slate-700 font-semibold rounded-xl py-3 text-sm transition-all"
          >
            {tr("cancel")}
          </button>
          <button
            onClick={handle}
            disabled={loading}
            className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-xl py-3 text-sm transition-all"
          >
            {loading ? tr("saving") : tr("saveUnlock")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Create PO Form ──────────────────────────────────────────────────────────

function CreatePOForm({ onCreated }: { onCreated: () => void }) {
  const t = useT();
  const lang = useLang();
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
    if (!name.trim()) { setErr(t("nameRequired")); return; }
    if (isNaN(vol) || vol <= 0) { setErr(t("volPositive")); return; }
    const cal = calibration.trim() === "" ? 1.0 : parseFloat(calibration);
    if (isNaN(cal) || cal <= 0) { setErr(t("calPositive")); return; }
    const ws = wholesale.trim() === "" ? 0 : parseFloat(wholesale);
    if (isNaN(ws) || ws < 0) { setErr(t("wsMin")); return; }

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
    setOkMsg(t("created", { name: name.trim() }));
    reset();
    onCreated();
    setTimeout(() => setOkMsg(""), 3000);
  }

  return (
    <div className="bg-white border border-slate-100 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-5 py-4 flex items-center gap-2 hover:bg-slate-100 transition-colors"
      >
        <div className="w-7 h-7 rounded-lg bg-blue-500/20 flex items-center justify-center">
          <Plus className={`w-4 h-4 text-pale-blue-foreground transition-transform ${open ? "rotate-45" : ""}`} />
        </div>
        <h2 className="text-slate-900 font-semibold text-sm">{t("createTitle")}</h2>
        {okMsg && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-pale-green-foreground bg-pale-green border border-emerald-100 rounded-full px-2.5 py-1">
            <CheckCircle className="w-3 h-3" /> {okMsg}
          </span>
        )}
      </button>

      {open && (
        <form onSubmit={handleSubmit} className="px-5 pb-5 border-t border-slate-100 pt-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2">
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">{t("poName")}</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={t("poNamePh")}
                className="w-full bg-white border border-slate-100 text-slate-900 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">{t("productType")}</label>
              <select
                value={productType}
                onChange={e => setProductType(e.target.value as any)}
                className="w-full bg-white border border-slate-100 text-slate-900 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none cursor-pointer"
              >
                {(["92", "95", "PD", "D"] as const).map(c => <option key={c} value={c}>{productLabel(c, lang)}</option>)}
                {/* No "Pipa" here: a pipa is the drum, not a fuel — pipas are tracked in the Pipa Ledger. */}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">{t("totalVolume")}</label>
              <input
                type="number" min="0" step="0.01"
                value={volume}
                onChange={e => setVolume(e.target.value)}
                placeholder={t("egVolume")}
                className="w-full bg-white border border-slate-100 text-slate-900 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                {t("calibration")} <span className="text-slate-400 normal-case font-normal">{t("default1")}</span>
              </label>
              <input
                type="number" min="0" step="0.01"
                value={calibration}
                onChange={e => setCalibration(e.target.value)}
                placeholder="1.00"
                className="w-full bg-white border border-slate-100 text-slate-900 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                {t("wholesale")} <span className="text-slate-400 normal-case font-normal">{t("default0")}</span>
              </label>
              <input
                type="number" min="0" step="0.01"
                value={wholesale}
                onChange={e => setWholesale(e.target.value)}
                placeholder="0"
                className="w-full bg-white border border-slate-100 text-slate-900 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {err && (
            <div className="flex items-start gap-2 bg-pale-red border border-red-100 rounded-lg px-3 py-2 text-xs text-pale-red-foreground">
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
                ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> {t("creating")}</>
                : <><Plus className="w-4 h-4" /> {t("createPO")}</>}
            </button>
            <p className="text-slate-500 text-xs">{t("defaultsA")}<span className="text-slate-700 font-semibold">{t("QUEUED")}</span>{t("defaultsB")}</p>
          </div>
        </form>
      )}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function PORegistry() {
  const t = useT();
  const lang = useLang();
  const P = (code: string) => productLabel(code, lang);
  // The engine reports progress in English; show it in the app language.
  const fifoProgress = useCallback((m: string) => setFifoMsg(lang === "my" ? FIFO_PROGRESS[m] ?? m : m), [lang]);
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
          setFifoMsg(t("newShift"));
          const r = await runFIFOEngine(fifoProgress);
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
    const confirmMsg = t("confirmActive", { name: po.name ?? po.id.slice(0, 8), product: P(po.product_type) });
    if (!(await confirmDialog(confirmMsg, { confirmLabel: t("setActive") }))) return;
    const { error } = await supabase
      .from("fuel_purchase_orders")
      .update({ status: "ACTIVE" })
      .eq("id", po.id);
    if (error) { await messageDialog(t("activeFailed") + error.message); return; }
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
    if (!data || data.length === 0) return t("blocked");
    return null;
  }

  async function handleDeletePO(po: FuelPurchaseOrder) {
    if (!(await confirmDialog(t("confirmDelete", { name: po.name ?? po.id.slice(0, 8), product: P(po.product_type) }), { danger: true }))) return;
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
    if (!(await confirmDialog(t("confirmDeleteMany", { n: ids.length }), { danger: true }))) return;
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
    setFifoMsg(t("init"));
    const result = await runFIFOEngine(fifoProgress);
    setFifoRunning(false);
    setFifoResult(result);
    fetchPOs(page);
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const activePOs = pos.filter(p => p.status === "ACTIVE");

  return (
    <div className="flex-1 overflow-auto bg-slate-50">
      {/* Header */}
      <div className="px-6 py-5 border-b border-slate-100 bg-white">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{t("title")}</h1>
            <p className="text-slate-400 text-sm mt-0.5">{t("subtitle")}</p>
          </div>
          <div className="flex items-center gap-2">
            {selectedIds.size > 0 && (
              <button
                onClick={handleDeleteSelected}
                disabled={deleting}
                className="flex items-center gap-2 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white font-semibold rounded-xl px-5 py-2.5 text-sm transition-all"
              >
                <Trash2 className="w-4 h-4" />
                {deleting ? t("deleting") : t("deleteSelected", { n: selectedIds.size })}
              </button>
            )}
            <button
              onClick={handleRunFIFO}
              disabled={fifoRunning}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl px-5 py-2.5 text-sm transition-all"
            >
              {fifoRunning
                ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" /> {t("running")}</>
                : <><Zap className="w-4 h-4" /> {t("runFifo")}</>
              }
            </button>
          </div>
        </div>

        {/* FIFO status bar */}
        {fifoRunning && (
          <div className="mt-3 rounded-xl px-4 py-2.5 text-sm flex items-center gap-2 border bg-slate-50 border-slate-100 text-slate-700">
            <span className="w-3 h-3 border border-slate-200 border-t-slate-500 rounded-full animate-spin shrink-0" />
            {fifoMsg}
          </div>
        )}

        {!fifoRunning && fifoResult && (
          <div className={`mt-3 rounded-xl px-4 py-3 text-sm border ${
            fifoResult.error
              ? "bg-pale-red border-red-100 text-pale-red-foreground"
              : fifoResult.failedPOs > 0
              ? "bg-pale-gold border-amber-100 text-pale-gold-foreground"
              : "bg-pale-green border-emerald-100 text-pale-green-foreground"
          }`}>
            {fifoResult.error ? (
              <div className="flex items-start gap-2">
                <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">{t("fifoFailed")}</p>
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
                      ? t("completedFailures", { n: fifoResult.failedPOs })
                      : t("completedOk")}
                  </span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  <div>
                    <span className="opacity-60">{t("shiftsProcessed")}</span>
                    <span className="font-bold ml-1">{fifoResult.processedShifts}</span>
                  </div>
                  <div>
                    <span className="opacity-60">{t("posUpdated")}</span>
                    <span className="font-bold ml-1">{fifoResult.updatedPOs}</span>
                  </div>
                  <div>
                    <span className="opacity-60">{t("writeFailures")}</span>
                    <span className={`font-bold ml-1 ${fifoResult.failedPOs > 0 ? "text-pale-red-foreground" : ""}`}>{fifoResult.failedPOs}</span>
                  </div>
                  <div>
                    <span className="opacity-60">{t("totalLiters")}</span>
                    <span className="font-bold ml-1">
                      {Object.values(fifoResult.productVolumes).reduce((a, b) => a + b, 0).toFixed(1)}
                    </span>
                  </div>
                </div>

                {Object.keys(fifoResult.productVolumes).length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {Object.entries(fifoResult.productVolumes).map(([p, vol]) => (
                      <span key={p} className="text-xs bg-black/20 rounded-full px-2.5 py-0.5">
                        {P(p)}: <span className="font-bold">{vol.toFixed(1)} L</span>
                      </span>
                    ))}
                  </div>
                )}

                {fifoResult.failures.length > 0 && (
                  <details className="mt-3 text-xs">
                    <summary className="cursor-pointer font-semibold text-pale-red-foreground hover:text-red-200">
                      {t("showFailures", { n: fifoResult.failures.length })}
                    </summary>
                    <ul className="mt-2 space-y-1 bg-black/30 rounded-lg p-3 font-mono">
                      {fifoResult.failures.map((f, i) => (
                        <li key={i} className="text-pale-red-foreground">• {f}</li>
                      ))}
                    </ul>
                  </details>
                )}

                {fifoResult.processedShifts === 0 && (
                  <p className="text-xs mt-2 opacity-80">
                    {t("noShifts")}
                  </p>
                )}
                {fifoResult.processedShifts > 0 && Object.keys(fifoResult.productVolumes).length === 0 && (
                  <p className="text-xs mt-2 opacity-80">
                    {t("noLiters")}
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

        {/* Pipa stock, calculated from the Pipa Ledger */}
        <PipaStockSummary />

        {/* Active PO Cards */}
        {activePOs.length > 0 && (
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">{t("activeBatches")}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {activePOs.map(po => {
                const fill = pct(po.remaining_volume, po.initial_volume);
                const profit = calcNetProfit(po);
                return (
                  <div key={po.id} className="bg-white border border-emerald-100 rounded-xl p-5 relative overflow-hidden">
                    {/* Progress bar background */}
                    <div
                      className="absolute inset-0 bg-emerald-500/5 origin-left transition-all"
                      style={{ width: `${fill}%` }}
                    />
                    <div className="relative">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <p className="text-slate-900 font-bold">{P(po.product_type)}</p>
                          <p className="text-slate-500 text-xs font-mono mt-0.5">#{po.id.slice(0, 8).toUpperCase()}</p>
                        </div>
                        <span className="flex items-center gap-1.5 text-xs font-semibold text-pale-green-foreground bg-pale-green border border-emerald-100 rounded-full px-2.5 py-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          {t("ACTIVE")}
                        </span>
                      </div>

                      {/* Volume bar */}
                      <div className="mb-3">
                        <div className="flex justify-between text-xs text-slate-400 mb-1">
                          <span>{t("remaining")}</span>
                          <span className="font-semibold text-slate-900">{fill.toFixed(1)}%</span>
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              fill < 20 ? "bg-red-500" : fill < 50 ? "bg-amber-500" : "bg-emerald-500"
                            }`}
                            style={{ width: `${fill}%` }}
                          />
                        </div>
                        <div className="flex justify-between text-xs text-slate-500 mt-1">
                          <span>{liters(po.remaining_volume)}</span>
                          <span>{t("of", { n: liters(po.initial_volume) })}</span>
                        </div>
                      </div>

                      {/* Calibration */}
                      <div className="flex justify-between text-xs mb-4">
                        <span className="text-slate-400">{t("calibration")}</span>
                        <span className="text-slate-700 font-mono">{po.calibration_factor.toFixed(2)}</span>
                      </div>

                      {/* Profit badge */}
                      <div className="mb-4">
                        {!po.is_verified ? (
                          <div className="flex items-center gap-2 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
                            <Lock className="w-3.5 h-3.5 text-slate-500" />
                            <span className="text-slate-500 text-xs font-semibold tracking-wider">{t("pendingCosts")}</span>
                          </div>
                        ) : profit != null ? (
                          <div className={`flex items-center justify-between rounded-lg px-3 py-2 border ${
                            profit >= 0
                              ? "bg-pale-green border-emerald-100"
                              : "bg-pale-red border-red-100"
                          }`}>
                            <span className="text-xs font-semibold text-slate-400 flex items-center gap-1">
                              <Unlock className="w-3 h-3" /> {t("netProfit")}
                            </span>
                            <span className={`font-bold text-sm tabular-nums ${profit >= 0 ? "text-pale-green-foreground" : "text-pale-red-foreground"}`}>
                              {profit >= 0 ? "+" : ""}{mmk(profit)}
                            </span>
                          </div>
                        ) : null}
                      </div>

                      {/* Actions */}
                      <div className="flex gap-2">
                        <button
                          onClick={() => setForceCloseTarget(po)}
                          className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold text-pale-red-foreground hover:text-pale-red-foreground bg-pale-red hover:bg-pale-red border border-red-100 rounded-lg py-2 transition-all"
                        >
                          <AlertTriangle className="w-3.5 h-3.5" />
                          {t("forceCloseBtn")}
                        </button>
                        <button
                          onClick={() => setVerifyTarget(po)}
                          className="flex items-center justify-center gap-1.5 text-xs font-semibold text-pale-blue-foreground hover:text-pale-blue-foreground bg-pale-blue hover:bg-pale-blue border border-blue-100 rounded-lg px-3 py-2 transition-all"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          {po.is_verified ? t("edit") : t("verify")}
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
        <div className="bg-white border border-slate-100 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
            <PackageSearch className="w-4 h-4 text-pale-blue-foreground" />
            <h2 className="text-slate-900 font-semibold text-sm">{t("allPOs")}</h2>
            <span className="ml-auto text-slate-500 text-xs">{t("total", { n: totalCount })}</span>
          </div>
          {deleteError && (
            <div className="mx-5 mt-4 flex items-start gap-2 bg-pale-red border border-red-100 rounded-xl px-4 py-3 text-xs text-pale-red-foreground">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{deleteError}</span>
              <button onClick={() => setDeleteError("")} aria-label={t("dismissError")} className="ml-auto text-pale-red-foreground hover:text-red-200"><X className="w-3.5 h-3.5" /></button>
            </div>
          )}

          {loading ? (
            <div className="p-16 text-center">
              <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mx-auto mb-3" />
              <p className="text-slate-500 text-sm">{t("loading")}</p>
            </div>
          ) : pos.length === 0 ? (
            <div className="p-16 text-center">
              <PackageSearch className="w-10 h-10 text-slate-200 mx-auto mb-3" />
              <p className="text-slate-400 text-sm font-medium">{t("none")}</p>
              <p className="text-slate-400 text-xs mt-1">{t("getStarted")}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px]">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="px-5 py-3 w-10">
                      <input type="checkbox"
                        checked={pos.length > 0 && selectedIds.size === pos.length}
                        onChange={toggleSelectAll}
                        aria-label={t("selectAll")}
                        className="w-4 h-4 rounded accent-red-500 cursor-pointer"
                      />
                    </th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("poName")}</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("product")}</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("status")}</th>
                    <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("initialVol")}</th>
                    <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("remaining")}</th>
                    <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("sold")}</th>
                    <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("shortage")}</th>
                    <th className="text-center px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("calShort")}</th>
                    <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("netProfit")}</th>
                    <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {pos.map(po => {
                    const cfg = STATUS_CONFIG[po.status];
                    const profit = calcNetProfit(po);
                    const fillPct = pct(po.remaining_volume, po.initial_volume);
                    return (
                      <tr key={po.id} className={`border-b border-slate-100 last:border-0 transition-colors ${selectedIds.has(po.id) ? "bg-pale-red" : "hover:bg-slate-100"}`}>
                        <td className="px-5 py-3.5" onClick={e => e.stopPropagation()}>
                          <input type="checkbox"
                            checked={selectedIds.has(po.id)}
                            onChange={() => toggleSelect(po.id)}
                            aria-label={t("selectPO", { name: po.name ?? "" })}
                            className="w-4 h-4 rounded accent-red-500 cursor-pointer"
                          />
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex flex-col">
                            <span className="text-slate-900 text-sm font-semibold">{po.name ?? "—"}</span>
                            <span className="text-slate-500 text-xs font-mono mt-0.5">#{po.id.slice(0, 8).toUpperCase()}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3.5 text-slate-700 text-sm">{P(po.product_type)}</td>
                        <td className="px-5 py-3.5">
                          <span className={`inline-flex items-center gap-1.5 text-xs font-semibold rounded-full px-2.5 py-1 border ${cfg.bg} ${cfg.border} ${cfg.text}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot} ${po.status === "ACTIVE" ? "animate-pulse" : ""}`} />
                            {t(po.status)}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-right text-slate-700 text-sm tabular-nums">{liters(po.initial_volume)}</td>
                        <td className="px-5 py-3.5 text-right">
                          <div className="flex flex-col items-end gap-1">
                            <span className={`text-sm font-semibold tabular-nums ${fillPct < 20 ? "text-pale-red-foreground" : "text-slate-900"}`}>
                              {liters(po.remaining_volume)}
                            </span>
                            {po.status === "ACTIVE" && (
                              <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
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
                            <span className="text-pale-red-foreground text-sm font-semibold tabular-nums">{liters(po.shortage_liters)}</span>
                          ) : (
                            <span className="text-slate-400 text-sm">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-center text-slate-700 text-sm font-mono">
                          {po.calibration_factor.toFixed(2)}
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          {!po.is_verified ? (
                            <span className="inline-flex items-center gap-1 text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-full px-2.5 py-1">
                              <Lock className="w-3 h-3" /> {t("pending")}
                            </span>
                          ) : profit != null ? (
                            <span className={`text-sm font-bold tabular-nums ${profit >= 0 ? "text-pale-green-foreground" : "text-pale-red-foreground"}`}>
                              {profit >= 0 ? "+" : ""}{mmk(profit)}
                            </span>
                          ) : (
                            <span className="text-slate-400 text-sm">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-1">
                            {po.status === "QUEUED" && (
                              <button
                                onClick={() => handleSetActive(po)}
                                title={t("promoteTitle")}
                                className="flex items-center gap-1 text-xs font-semibold text-pale-green-foreground hover:text-pale-green-foreground bg-pale-green hover:bg-pale-green border border-emerald-100 rounded-lg px-2.5 py-1.5 transition-all"
                              >
                                <Play className="w-3 h-3" />
                                {t("setActive")}
                              </button>
                            )}
                            {po.status === "ACTIVE" && (
                              <button
                                onClick={() => setForceCloseTarget(po)}
                                title={t("forceCloseBtn")}
                                className="text-pale-red-foreground hover:text-pale-red-foreground hover:bg-pale-red p-1.5 rounded-lg transition-all"
                              >
                                <AlertTriangle className="w-4 h-4" />
                              </button>
                            )}
                            <button
                              onClick={() => setVerifyTarget(po)}
                              title={po.is_verified ? t("editCosts") : t("verifyCosts")}
                              className="text-pale-blue-foreground hover:text-pale-blue-foreground hover:bg-pale-blue p-1.5 rounded-lg transition-all"
                            >
                              {po.is_verified ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                            </button>
                            <button
                              onClick={() => handleDeletePO(po)}
                              title={t("deletePO")}
                              className="text-slate-500 hover:text-pale-red-foreground hover:bg-pale-red p-1.5 rounded-lg transition-all"
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
            <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-between">
              <p className="text-slate-500 text-xs">{t("page", { p: page + 1, n: totalPages, total: totalCount })}</p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-slate-100 text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100 transition-all"
                >
                  <ChevronLeft className="w-3.5 h-3.5" /> {t("prev")}
                </button>
                <button
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-slate-100 text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100 transition-all"
                >
                  {t("next")} <ChevronRight className="w-3.5 h-3.5" />
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
