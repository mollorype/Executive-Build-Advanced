import { useEffect, useRef, useState, useCallback } from "react";
import {
  PackageSearch, CheckCircle, Plus,
  ChevronLeft, ChevronRight, AlertTriangle, Lock, Unlock,
  X, Edit3, Play, Trash2, Receipt, Pencil, Loader2, History as HistoryIcon,
} from "lucide-react";
import { supabase, FuelPurchaseOrder } from "@/lib/supabase";
import { forceClosePO, verifyPO } from "@/lib/fifo-engine";
import { loadUsageSums, poProfit, type Profit, type UsageSum } from "@/lib/po-usage";
import PipaStockSummary from "@/components/pipa/stock-summary-card";
import PipaModal, { ErrorNote, primaryBtn } from "@/components/pipa/modal";
import ShiftDeductDialog from "@/components/shift-deduct-dialog";
import POHistoryDialog from "@/components/po/po-history-dialog";
import { L_PER_PP, fmtTyped, fromUnit, liters, readUnit, saveUnit, toUnit, unitSuffix, vol, type VolUnit } from "@/lib/po-units";
import { makeT, useLang, type Lang } from "@/lib/app-i18n";
import { usePOT } from "@/lib/po-i18n";
import { confirmDialog, messageDialog } from "@/components/confirm-dialog";

const useT = makeT({
  // Force close
  badDip: { en: "Enter a valid dip-stick reading (liters).", my: "မှန်ကန်သော dip-stick တိုင်းတာချက် (လီတာ) ထည့်ပါ။" },
  unknownError: { en: "Unknown error", my: "အမည်မသိ အမှား" },
  close: { en: "Close", my: "ပိတ်ရန်" },
  forceCloseTitle: { en: "Force Close — Dip Mismatch", my: "အတင်းပိတ်ရန် — Dip မကိုက်ညီ" },
  expectedRemaining: { en: "Expected Remaining", my: "ကျန်ရမည့် ပမာဏ" },
  calibration: { en: "Calibration Factor", my: "Calibration Factor" },
  dipReading: { en: "Physical reading ({u})", my: "တကယ်ရှိသော ပမာဏ ({u})" },
  dipPlaceholder: { en: "Enter actual physical volume…", my: "တကယ်ရှိသော ပမာဏ ထည့်ပါ…" },
  shortage: { en: "Shortage", my: "လိုငွေ" },
  surplus: { en: "Surplus", my: "ပိုငွေ" },
  cancel: { en: "Cancel", my: "မလုပ်တော့ပါ" },
  closing: { en: "Closing…", my: "ပိတ်နေသည်…" },
  confirmForceClose: { en: "Confirm Force Close", my: "အတင်းပိတ်ရန် အတည်ပြု" },
  // Verify
  allFour: { en: "All three fields are required.", my: "အကွက် သုံးခုလုံး ဖြည့်ရန် လိုအပ်သည်။" },
  revenueNote: { en: "Money from sales comes from each day's selling price in the PO's sales history — no fixed retail price.", my: "ရောင်းရငွေကို PO ရောင်းအား မှတ်တမ်းရှိ နေ့စဉ် ရောင်းစျေးမှ ယူပါသည် — သတ်မှတ်ထားသော လက်လီစျေး မသုံးပါ။" },
  unlockProfit: { en: "Unlock Net Profit", my: "အသားတင်အမြတ် ဖွင့်ရန်" },
  wholesale: { en: "Wholesale Price (MMK/L)", my: "လက်ကား စျေး (MMK/L)" },
  transport: { en: "Transportation Fees (MMK/L)", my: "သယ်ယူစရိတ် (MMK/L)" },
  confidential: { en: "Confidential Fees (MMK/L)", my: "လျှို့ဝှက် စရိတ် (MMK/L)" },
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
  totalVolume: { en: "Total Volume ({u})", my: "စုစုပေါင်း ပမာဏ ({u})" },
  egVolume: { en: "e.g. {n}", my: "ဥပမာ {n}" },
  equalsOther: { en: "= {v} (1 P-P = {size} L)", my: "= {v} (1 P-P = {size} L)" },
  unit: { en: "Unit", my: "ယူနစ်" },
  unitPP: { en: "P-P", my: "P-P" },
  unitL: { en: "Litres (L)", my: "လီတာ (L)" },
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
  title: { en: "PO Registry", my: "PO မှတ်ပုံတင်" },
  subtitle: { en: "Fuel purchase orders · shift sales deducted oldest first", my: "ဆီ အော်ဒါများ · ဆိုင်း ရောင်းအားကို အဟောင်းဆုံးမှ စ၍ နုတ်" },
  deductBtn: { en: "Deduct shift sales", my: "ဆိုင်း ရောင်းအား နုတ်ရန်" },
  history: { en: "History", my: "မှတ်တမ်း" },
  editPO: { en: "Edit PO", my: "PO ပြင်ရန်" },
  costs: { en: "Costs", my: "ကုန်ကျစရိတ်" },
  forceShort: { en: "Force close", my: "အတင်းပိတ်" },
  selectAllShort: { en: "Select all", my: "အားလုံး ရွေးရန်" },
  deleting: { en: "Deleting…", my: "ဖျက်နေသည်…" },
  deleteSelected: { en: "Delete Selected ({n})", my: "ရွေးထားသည်ကို ဖျက်ရန် ({n})" },
  activeBatches: { en: "Active Batches", my: "အသုံးပြုဆဲ အသုတ်များ" },
  remaining: { en: "Remaining", my: "ကျန်" },
  of: { en: "of {n}", my: "{n} အနက်" },
  pendingCosts: { en: "[ PENDING ] — Costs not verified", my: "[ စောင့်ဆဲ ] — ကုန်ကျစရိတ် မစစ်ရသေး" },
  netProfit: { en: "Net Profit", my: "အသားတင်အမြတ်" },
  forceCloseBtn: { en: "Force Close / Dip Mismatch", my: "အတင်းပိတ် / Dip မကိုက်" },
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

// Volumes are stored in litres; shown and typed in P-P (default) or litres
// (lib/po-units). Prices are always MMK per litre.
/**
 * A volume box that remembers the exact litres typed, so switching P-P ↔ L
 * converts the number in the box (1000 L → 4.651 P-P) and switching back
 * gives exactly what was typed (1000 L), not a rounded copy.
 */
function useVolumeInput(unit: VolUnit, startLitres: number | null = null) {
  const [text, setText] = useState(() => (startLitres != null ? fmtTyped(toUnit(startLitres, unit)) : ""));
  const litres = useRef<number | null>(startLitres);
  const shownIn = useRef(unit);
  useEffect(() => {
    if (shownIn.current === unit) return;
    shownIn.current = unit;
    if (litres.current != null) setText(fmtTyped(toUnit(litres.current, unit)));
  }, [unit]);
  return {
    text,
    litres: litres.current,
    onChange(v: string) {
      setText(v);
      const n = parseFloat(v);
      litres.current = v.trim() === "" || isNaN(n) ? null : fromUnit(n, unit);
    },
    clear() { setText(""); litres.current = null; },
  };
}

/** The same amount in the other unit, under a volume box. */
function otherUnit(litres: number | null, unit: VolUnit) {
  if (litres == null || !(litres > 0)) return null;
  return vol(litres, unit === "pp" ? "l" : "pp");
}


function UnitSwitch({ unit, onChange, testId }: { unit: VolUnit; onChange: (u: VolUnit) => void; testId: string }) {
  const t = useT();
  return (
    <div className="inline-flex items-center gap-2" role="group" aria-label={t("unit")}>
      <span className="text-xs font-semibold text-slate-500 normal-case tracking-normal">{t("unit")}</span>
      <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5" data-testid={testId}>
        {(["pp", "l"] as const).map(u => (
          <button key={u} type="button" onClick={() => onChange(u)} aria-pressed={unit === u}
            className={`px-3 py-1 rounded-md text-xs font-bold normal-case tracking-normal transition-colors ${unit === u ? "bg-blue-600 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"}`}>
            {u === "pp" ? t("unitPP") : t("unitL")}
          </button>
        ))}
      </div>
    </div>
  );
}

function pct(remaining: number, initial: number) {
  if (!initial) return 0;
  return Math.max(0, Math.min(100, (remaining / initial) * 100));
}

// ─── Force Close Modal ──────────────────────────────────────────────────────

function ForceCloseModal({
  po,
  unit,
  onUnit,
  onClose,
  onDone,
}: {
  po: FuelPurchaseOrder;
  unit: VolUnit;
  onUnit: (u: VolUnit) => void;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const lang = useLang();
  const reading = useVolumeInput(unit);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function handle() {
    const physicalLitres = reading.litres;
    if (physicalLitres == null || physicalLitres < 0) { setErr(t("badDip")); return; }
    setLoading(true);
    const res = await forceClosePO(po.id, physicalLitres, po.remaining_volume);
    setLoading(false);
    if (!res.success) { setErr(res.error ?? t("unknownError")); return; }
    onDone();
  }

  // In litres, like everything stored.
  const shortage = reading.litres != null ? Math.max(0, po.remaining_volume - reading.litres) : null;

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
            <span className="text-slate-900 font-medium">{vol(po.remaining_volume, unit)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">{t("calibration")}</span>
            <span className="text-slate-900 font-medium">{po.calibration_factor.toFixed(2)}</span>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 flex-wrap mb-1.5">
          <label htmlFor="po-reading" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">
            {t("dipReading", { u: unitSuffix(unit) })}
          </label>
          <UnitSwitch unit={unit} onChange={onUnit} testId="po-unit-close" />
        </div>
        <input
          id="po-reading"
          type="number"
          min="0"
          step="any"
          value={reading.text}
          onChange={e => { reading.onChange(e.target.value); setErr(""); }}
          placeholder={t("dipPlaceholder")}
          className="w-full bg-white border border-slate-100 text-slate-900 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 mb-1"
        />
        <p className="text-[11px] text-slate-400 mb-3 min-h-[1em]" data-testid="po-reading-other">
          {otherUnit(reading.litres, unit) && t("equalsOther", { v: otherUnit(reading.litres, unit)!, size: L_PER_PP })}
        </p>

        {shortage != null && !isNaN(shortage) && (
          <div className={`rounded-xl px-4 py-3 mb-3 text-sm flex justify-between ${
            shortage > 0 ? "bg-pale-red border border-red-100" : "bg-pale-green border border-emerald-100"
          }`}>
            <span className={shortage > 0 ? "text-pale-red-foreground" : "text-pale-green-foreground"}>
              {shortage > 0 ? t("shortage") : t("surplus")}
            </span>
            <span className={`font-bold ${shortage > 0 ? "text-pale-red-foreground" : "text-pale-green-foreground"}`}>
              {vol(Math.abs(shortage), unit)}
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
            disabled={loading || reading.litres == null}
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
  });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  function num(s: string) { const v = parseFloat(s); return isNaN(v) ? null : v; }

  async function handle() {
    const w = num(form.wholesale_price);
    const t = num(form.transportation_fees);
    const c = num(form.confidential_fees);
    if (w == null || t == null || c == null) {
      setErr(tr("allFour")); return;
    }
    setLoading(true);
    const res = await verifyPO(po.id, {
      wholesale_price: w,
      transportation_fees: t,
      confidential_fees: c,
    });
    setLoading(false);
    if (!res.success) { setErr(res.error ?? tr("unknownError")); return; }
    onDone();
  }

  // A plain render function — not a component defined here, which React would
  // see as new on every render and remount, so each key press lost the focus.
  const field = (label: string, key: keyof typeof form) => (
    <div>
      <label htmlFor={`cost-${key}`} className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">{label}</label>
      <input
        id={`cost-${key}`}
        type="number"
        inputMode="decimal"
        min="0"
        step="any"
        value={form[key]}
        onChange={e => { setForm(f => ({ ...f, [key]: e.target.value })); setErr(""); }}
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
          {field(tr("wholesale"), "wholesale_price")}
          {field(tr("transport"), "transportation_fees")}
          {field(tr("confidential"), "confidential_fees")}
          <p className="text-[11px] text-slate-500">{tr("revenueNote")}</p>
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

// ─── Edit PO ─────────────────────────────────────────────────────────────────

/**
 * Name, fuel (until something is sold), total volume in P-P or litres, and
 * calibration factor. Changing the total moves what's left by the same amount;
 * it can't go below what has already been taken off the PO.
 */
function EditPOModal({ po, unit, onUnit, onClose, onDone }: {
  po: FuelPurchaseOrder;
  unit: VolUnit;
  onUnit: (u: VolUnit) => void;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const t = usePOT();
  const lang = useLang();
  const [name, setName] = useState(po.name ?? "");
  const [product, setProduct] = useState(po.product_type);
  const volume = useVolumeInput(unit, Number(po.initial_volume));
  const [cal, setCal] = useState(String(po.calibration_factor ?? 1));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const sold = Number(po.total_volume_sold) || 0;
  const closed = po.shortage_liters != null;
  const used = Number(po.initial_volume) - Number(po.remaining_volume);   // stock already taken off

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (!name.trim()) { setErr(t("nameRequired")); return; }
    const c = parseFloat(cal);
    if (isNaN(c) || c <= 0) { setErr(t("calPositive")); return; }
    const total = closed ? Number(po.initial_volume) : volume.litres;
    if (total == null || !(total > 0)) { setErr(t("volPositive")); return; }
    if (total < used - 0.0005) { setErr(t("tooSmall", { used: vol(used, unit) })); return; }
    const remaining = closed ? Number(po.remaining_volume) : Math.max(0, total - used);
    const patch: Record<string, unknown> = { name: name.trim(), calibration_factor: c, initial_volume: total, remaining_volume: remaining };
    if (sold === 0) patch.product_type = product;
    if (!closed) patch.status = remaining <= 0.0005 ? "DONE" : po.status === "DONE" ? "QUEUED" : po.status;   // more volume re-opens a used-up PO
    setBusy(true);
    const { data, error } = await supabase.from("fuel_purchase_orders").update(patch).eq("id", po.id).select("id");
    setBusy(false);
    if (error) { setErr(error.message); return; }
    if (!data?.length) { setErr(t("notSaved")); return; }
    onDone(t("saved"));
  }

  const label = "block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5";
  const field = "w-full bg-slate-50 border border-slate-200 text-slate-900 text-base sm:text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-300/50 disabled:opacity-60";
  return (
    <PipaModal title={t("editTitle")} subtitle={`${productLabel(po.product_type, lang)} · PO #${po.id.slice(0, 8).toUpperCase()}`} onClose={onClose}>
      <form onSubmit={save} className="space-y-4" data-testid="po-edit">
        <div>
          <label htmlFor="po-edit-name" className={label}>{t("name")}</label>
          <input id="po-edit-name" value={name} onChange={e => setName(e.target.value)} className={field} />
        </div>
        <div>
          <label htmlFor="po-edit-product" className={label}>{t("product")}</label>
          <select id="po-edit-product" value={product} onChange={e => setProduct(e.target.value as typeof product)} disabled={sold > 0} className={field}>
            {(["92", "95", "PD", "D"] as const).map(c => <option key={c} value={c}>{productLabel(c, lang)}</option>)}
          </select>
          {sold > 0 && <p className="text-[11px] text-slate-400 mt-1">{t("productLocked")}</p>}
        </div>
        <div>
          <div className="flex items-center justify-between gap-2 flex-wrap mb-1.5">
            <label htmlFor="po-edit-volume" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("volume", { u: unitSuffix(unit) })}</label>
            <UnitSwitch unit={unit} onChange={onUnit} testId="po-unit-edit" />
          </div>
          <input id="po-edit-volume" type="number" inputMode="decimal" min="0" step="any" value={volume.text} disabled={closed}
            onChange={e => volume.onChange(e.target.value)} className={field} />
          <p className="text-[11px] text-slate-400 mt-1" data-testid="po-edit-other">
            {closed ? t("volumeLocked") : <>
              {otherUnit(volume.litres, unit) && <>{t("equalsOther", { v: otherUnit(volume.litres, unit)!, size: L_PER_PP })} · </>}
              {t("volumeHelp", { sold: vol(sold, unit) })}
            </>}
          </p>
        </div>
        <div>
          <label htmlFor="po-edit-cal" className={label}>{t("calibration")}</label>
          <input id="po-edit-cal" type="number" inputMode="decimal" min="0" step="any" value={cal} onChange={e => setCal(e.target.value)} className={field} />
        </div>
        {err && <ErrorNote>{err}</ErrorNote>}
        <button type="submit" disabled={busy} className={primaryBtn}>
          {busy && <Loader2 className="w-4 h-4 animate-spin" />} {busy ? t("saving") : t("save")}
        </button>
      </form>
    </PipaModal>
  );
}

// ─── Create PO Form ──────────────────────────────────────────────────────────

function CreatePOForm({ unit, onUnit, onCreated }: { unit: VolUnit; onUnit: (u: VolUnit) => void; onCreated: () => void }) {
  const t = useT();
  const lang = useLang();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [productType, setProductType] = useState<"92" | "95" | "PD" | "D" | "pipa">("92");
  const volume = useVolumeInput(unit);
  const [calibration, setCalibration] = useState("");
  const [wholesale, setWholesale] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");

  function reset() {
    setName(""); setProductType("92"); volume.clear();
    setCalibration(""); setWholesale(""); setErr(""); setOkMsg("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setOkMsg("");
    const litres = volume.litres;
    if (!name.trim()) { setErr(t("nameRequired")); return; }
    if (litres == null || !(litres > 0)) { setErr(t("volPositive")); return; }
    const cal = calibration.trim() === "" ? 1.0 : parseFloat(calibration);
    if (isNaN(cal) || cal <= 0) { setErr(t("calPositive")); return; }
    const ws = wholesale.trim() === "" ? 0 : parseFloat(wholesale);
    if (isNaN(ws) || ws < 0) { setErr(t("wsMin")); return; }

    setSaving(true);
    const { error } = await supabase.from("fuel_purchase_orders").insert({
      name: name.trim(),
      product_type: productType,
      status: "QUEUED",
      // Stored in litres, whatever unit was typed.
      initial_volume: litres,
      remaining_volume: litres,
      calibration_factor: cal,
      wholesale_price: ws,   // MMK per litre
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
              <div className="flex items-center justify-between gap-2 flex-wrap mb-1.5">
                <label htmlFor="po-volume" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">{t("totalVolume", { u: unitSuffix(unit) })}</label>
                <UnitSwitch unit={unit} onChange={onUnit} testId="po-unit-form" />
              </div>
              <input
                id="po-volume"
                type="number" min="0" step="any"
                value={volume.text}
                onChange={e => volume.onChange(e.target.value)}
                placeholder={t("egVolume", { n: unit === "pp" ? "40" : "10000" })}
                className="w-full bg-white border border-slate-100 text-slate-900 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {otherUnit(volume.litres, unit) && (
                <p className="text-[11px] text-slate-400 mt-1" data-testid="po-volume-other">{t("equalsOther", { v: otherUnit(volume.litres, unit)!, size: L_PER_PP })}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                {t("calibration")} <span className="text-slate-400 normal-case font-normal">{t("default1")}</span>
              </label>
              <input
                type="number" min="0" step="any"
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
                type="number" min="0" step="any"
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

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 whitespace-nowrap shrink-0 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-xl px-5 py-2.5 text-sm transition-all"
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

function StatusBadge({ status }: { status: FuelPurchaseOrder["status"] }) {
  const t = useT();
  const cfg = STATUS_CONFIG[status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold rounded-full px-2.5 py-1 border whitespace-nowrap ${cfg.bg} ${cfg.border} ${cfg.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot} ${status === "ACTIVE" ? "animate-pulse" : ""}`} />
      {t(status)}
    </span>
  );
}

function ProfitValue({ profit }: { profit: Profit | null }) {
  const t = useT();
  if (!profit) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-full px-2.5 py-1">
        <Lock className="w-3 h-3" /> {t("pending")}
      </span>
    );
  }
  return (
    <span className={`font-bold tabular-nums ${profit.profit >= 0 ? "text-pale-green-foreground" : "text-pale-red-foreground"}`}>
      {profit.profit >= 0 ? "+" : ""}{mmk(profit.profit)}
    </span>
  );
}

const fillBar = (pctValue: number) => (pctValue < 20 ? "bg-red-500" : pctValue < 50 ? "bg-amber-500" : "bg-emerald-500");

export default function PORegistry() {
  const t = useT();
  const lang = useLang();
  const P = (code: string) => productLabel(code, lang);
  const [unit, setUnitState] = useState<VolUnit>(readUnit);
  const setUnit = (u: VolUnit) => { setUnitState(u); saveUnit(u); };
  const [pos, setPos] = useState<FuelPurchaseOrder[]>([]);
  const [usage, setUsage] = useState<Record<string, UsageSum>>({});
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");

  const [forceCloseTarget, setForceCloseTarget] = useState<FuelPurchaseOrder | null>(null);
  const [verifyTarget, setVerifyTarget] = useState<FuelPurchaseOrder | null>(null);
  const [editTarget, setEditTarget] = useState<FuelPurchaseOrder | null>(null);
  const [historyTarget, setHistoryTarget] = useState<FuelPurchaseOrder | null>(null);
  const [deductOpen, setDeductOpen] = useState(false);

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
      const list = data as FuelPurchaseOrder[];
      setPos(list);
      setTotalCount(count ?? 0);
      // Litres and money recorded for each PO — the profit comes from these.
      const { sums } = await loadUsageSums(list.map(x => x.id));
      setUsage(sums);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchPOs(0).finally(() => setLoading(false));
  }, [fetchPOs]);

  useEffect(() => {
    if (!loading) fetchPOs(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  function changed(message: string) {
    setEditTarget(null); setHistoryTarget(null); setDeductOpen(false);
    setNotice(message);
    setTimeout(() => setNotice(""), 3500);
    fetchPOs(page);
  }

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
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds(selectedIds.size === pos.length ? new Set() : new Set(pos.map(p => p.id)));
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

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const activePOs = pos.filter(p => p.status === "ACTIVE");
  const profitOf = (po: FuelPurchaseOrder) => poProfit(po, usage[po.id]);
  const chip = "inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg px-2.5 py-1.5 border transition-colors";

  return (
    <div className="flex-1 overflow-auto bg-slate-50">
      {/* Header */}
      <div className="px-4 md:px-6 py-5 border-b border-slate-100 bg-white">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{t("title")}</h1>
            <p className="text-slate-400 text-sm mt-0.5">{t("subtitle")}</p>
            <div className="mt-2"><UnitSwitch unit={unit} onChange={setUnit} testId="po-unit" /></div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {selectedIds.size > 0 && (
              <button
                onClick={handleDeleteSelected}
                disabled={deleting}
                className="flex items-center gap-2 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white font-semibold rounded-xl px-4 py-2.5 text-sm transition-all"
              >
                <Trash2 className="w-4 h-4" />
                {deleting ? t("deleting") : t("deleteSelected", { n: selectedIds.size })}
              </button>
            )}
            <button
              onClick={() => setDeductOpen(true)}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl px-4 py-2.5 text-sm transition-all"
            >
              <Receipt className="w-4 h-4" /> {t("deductBtn")}
            </button>
          </div>
        </div>
        {notice && <p className="mt-3 text-sm font-medium text-pale-green-foreground" role="status">{notice}</p>}
      </div>

      <div className="p-4 md:p-6 space-y-6">
        {/* Create New PO */}
        <CreatePOForm unit={unit} onUnit={setUnit} onCreated={() => fetchPOs(page)} />

        {/* Pipa stock, calculated from the Pipa Ledger */}
        <PipaStockSummary />

        {/* Active PO Cards */}
        {activePOs.length > 0 && (
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">{t("activeBatches")}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {activePOs.map(po => {
                const fill = pct(po.remaining_volume, po.initial_volume);
                const profit = profitOf(po);
                return (
                  <div key={po.id} className="bg-white border border-emerald-100 rounded-xl p-5 relative overflow-hidden">
                    <div className="absolute inset-0 bg-emerald-500/5 origin-left transition-all" style={{ width: `${fill}%` }} />
                    <div className="relative">
                      <div className="flex items-start justify-between mb-3 gap-2">
                        <div className="min-w-0">
                          <p className="text-slate-900 font-bold">{po.name ?? P(po.product_type)}</p>
                          <p className="text-slate-500 text-xs mt-0.5">{P(po.product_type)} · <span className="font-mono">#{po.id.slice(0, 8).toUpperCase()}</span></p>
                        </div>
                        <StatusBadge status="ACTIVE" />
                      </div>

                      <div className="mb-3">
                        <div className="flex justify-between text-xs text-slate-400 mb-1">
                          <span>{t("remaining")}</span>
                          <span className="font-semibold text-slate-900">{fill.toFixed(1)}%</span>
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${fillBar(fill)}`} style={{ width: `${fill}%` }} />
                        </div>
                        <div className="flex justify-between text-xs text-slate-500 mt-1">
                          <span>{vol(po.remaining_volume, unit)}</span>
                          <span>{t("of", { n: vol(po.initial_volume, unit) })}</span>
                        </div>
                      </div>

                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-slate-400">{t("sold")}</span>
                        <span className="text-slate-700 tabular-nums">{vol(po.total_volume_sold, unit)}</span>
                      </div>
                      <div className="flex justify-between text-xs mb-4">
                        <span className="text-slate-400">{t("calibration")}</span>
                        <span className="text-slate-700 font-mono">{po.calibration_factor.toFixed(2)}</span>
                      </div>

                      <div className="mb-4">
                        {!profit ? (
                          <div className="flex items-center gap-2 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
                            <Lock className="w-3.5 h-3.5 text-slate-500" />
                            <span className="text-slate-500 text-xs font-semibold tracking-wider">{t("pendingCosts")}</span>
                          </div>
                        ) : (
                          <div className={`flex items-center justify-between rounded-lg px-3 py-2 border ${profit.profit >= 0 ? "bg-pale-green border-emerald-100" : "bg-pale-red border-red-100"}`}>
                            <span className="text-xs font-semibold text-slate-400 flex items-center gap-1">
                              <Unlock className="w-3 h-3" /> {t("netProfit")}
                            </span>
                            <ProfitValue profit={profit} />
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => setHistoryTarget(po)} className={`${chip} text-slate-700 bg-white border-slate-200 hover:bg-slate-50`}>
                          <HistoryIcon className="w-3.5 h-3.5" /> {t("history")}
                        </button>
                        <button onClick={() => setVerifyTarget(po)} className={`${chip} text-pale-blue-foreground bg-pale-blue border-blue-100`}>
                          <Edit3 className="w-3.5 h-3.5" /> {po.is_verified ? t("editCosts") : t("verifyCosts")}
                        </button>
                        <button onClick={() => setForceCloseTarget(po)} className={`${chip} text-pale-red-foreground bg-pale-red border-red-100`}>
                          <AlertTriangle className="w-3.5 h-3.5" /> {t("forceCloseBtn")}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* All POs */}
        <div className="bg-white border border-slate-100 rounded-xl overflow-hidden">
          <div className="px-4 md:px-5 py-4 border-b border-slate-100 flex items-center gap-2">
            <PackageSearch className="w-4 h-4 text-pale-blue-foreground" />
            <h2 className="text-slate-900 font-semibold text-sm">{t("allPOs")}</h2>
            <span className="ml-auto text-slate-500 text-xs">{t("total", { n: totalCount })}</span>
          </div>
          {deleteError && (
            <div className="mx-4 md:mx-5 mt-4 flex items-start gap-2 bg-pale-red border border-red-100 rounded-xl px-4 py-3 text-xs text-pale-red-foreground">
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
            <>
              {/* Phones: one card per PO — everything readable without sideways scrolling. */}
              <div className="md:hidden divide-y divide-slate-100" data-testid="po-cards">
                <label className="flex items-center gap-2 px-4 py-2.5 text-xs text-slate-500">
                  <input type="checkbox" checked={pos.length > 0 && selectedIds.size === pos.length} onChange={toggleSelectAll}
                    aria-label={t("selectAll")} className="w-4 h-4 rounded accent-red-500" />
                  {t("selectAllShort")}
                </label>
                {pos.map(po => {
                  const fillPct = pct(po.remaining_volume, po.initial_volume);
                  return (
                    <div key={po.id} className={`px-4 py-4 space-y-3 ${selectedIds.has(po.id) ? "bg-pale-red" : ""}`} data-testid="po-card">
                      <div className="flex items-start gap-3">
                        <input type="checkbox" checked={selectedIds.has(po.id)} onChange={() => toggleSelect(po.id)}
                          aria-label={t("selectPO", { name: po.name ?? "" })} className="mt-1 w-4 h-4 rounded accent-red-500 shrink-0" />
                        <div className="min-w-0 flex-1 flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-slate-900 font-semibold break-words">{po.name ?? "—"}</p>
                            <p className="text-xs text-slate-500">{P(po.product_type)} · <span className="font-mono">#{po.id.slice(0, 8).toUpperCase()}</span></p>
                          </div>
                          <StatusBadge status={po.status} />
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between items-baseline text-xs mb-1">
                          <span className="text-slate-500">{t("remaining")}</span>
                          <span className="tabular-nums">
                            <span className={`font-semibold ${fillPct < 20 && po.status !== "DONE" ? "text-pale-red-foreground" : "text-slate-900"}`}>{vol(po.remaining_volume, unit)}</span>
                            <span className="text-slate-400"> / {vol(po.initial_volume, unit)}</span>
                          </span>
                        </div>
                        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${fillBar(fillPct)}`} style={{ width: `${fillPct}%` }} />
                        </div>
                      </div>
                      <dl className="grid grid-cols-3 gap-2 text-xs">
                        <div><dt className="text-slate-400">{t("sold")}</dt><dd className="font-semibold text-slate-900 tabular-nums">{vol(po.total_volume_sold, unit)}</dd></div>
                        <div><dt className="text-slate-400">{t("shortage")}</dt><dd className={`font-semibold tabular-nums ${po.shortage_liters != null ? "text-pale-red-foreground" : "text-slate-400"}`}>{po.shortage_liters != null ? vol(po.shortage_liters, unit) : "—"}</dd></div>
                        <div><dt className="text-slate-400">{t("netProfit")}</dt><dd className="text-sm"><ProfitValue profit={profitOf(po)} /></dd></div>
                      </dl>
                      <div className="flex flex-wrap gap-2">
                        {po.status === "QUEUED" && (
                          <button onClick={() => handleSetActive(po)} className={`${chip} text-pale-green-foreground bg-pale-green border-emerald-100`}>
                            <Play className="w-3 h-3" /> {t("setActive")}
                          </button>
                        )}
                        <button onClick={() => setHistoryTarget(po)} className={`${chip} text-slate-700 bg-white border-slate-200`}>
                          <HistoryIcon className="w-3.5 h-3.5" /> {t("history")}
                        </button>
                        <button onClick={() => setEditTarget(po)} className={`${chip} text-slate-700 bg-white border-slate-200`}>
                          <Pencil className="w-3.5 h-3.5" /> {t("editPO")}
                        </button>
                        <button onClick={() => setVerifyTarget(po)} className={`${chip} text-pale-blue-foreground bg-pale-blue border-blue-100`}>
                          {po.is_verified ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />} {t("costs")}
                        </button>
                        {po.status === "ACTIVE" && (
                          <button onClick={() => setForceCloseTarget(po)} className={`${chip} text-pale-red-foreground bg-pale-red border-red-100`}>
                            <AlertTriangle className="w-3.5 h-3.5" /> {t("forceShort")}
                          </button>
                        )}
                        <button onClick={() => handleDeletePO(po)} aria-label={t("deletePO")} title={t("deletePO")}
                          className={`${chip} text-slate-500 bg-white border-slate-200 ml-auto`}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Wider screens: the table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full min-w-[960px]">
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
                      const fillPct = pct(po.remaining_volume, po.initial_volume);
                      return (
                        <tr key={po.id} className={`border-b border-slate-100 last:border-0 transition-colors ${selectedIds.has(po.id) ? "bg-pale-red" : "hover:bg-slate-100"}`}>
                          <td className="px-5 py-3.5">
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
                          <td className="px-5 py-3.5"><StatusBadge status={po.status} /></td>
                          <td className="px-5 py-3.5 text-right text-slate-700 text-sm tabular-nums">{vol(po.initial_volume, unit)}</td>
                          <td className="px-5 py-3.5 text-right">
                            <div className="flex flex-col items-end gap-1">
                              <span className={`text-sm font-semibold tabular-nums ${fillPct < 20 ? "text-pale-red-foreground" : "text-slate-900"}`}>
                                {vol(po.remaining_volume, unit)}
                              </span>
                              {po.status === "ACTIVE" && (
                                <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                  <div className={`h-full rounded-full ${fillBar(fillPct)}`} style={{ width: `${fillPct}%` }} />
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="px-5 py-3.5 text-right text-slate-400 text-sm tabular-nums">{vol(po.total_volume_sold, unit)}</td>
                          <td className="px-5 py-3.5 text-right">
                            {po.shortage_liters != null
                              ? <span className="text-pale-red-foreground text-sm font-semibold tabular-nums">{vol(po.shortage_liters, unit)}</span>
                              : <span className="text-slate-400 text-sm">—</span>}
                          </td>
                          <td className="px-5 py-3.5 text-center text-slate-700 text-sm font-mono">{po.calibration_factor.toFixed(2)}</td>
                          <td className="px-5 py-3.5 text-right text-sm"><ProfitValue profit={profitOf(po)} /></td>
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-1">
                              {po.status === "QUEUED" && (
                                <button onClick={() => handleSetActive(po)} title={t("promoteTitle")}
                                  className="flex items-center gap-1 text-xs font-semibold text-pale-green-foreground bg-pale-green border border-emerald-100 rounded-lg px-2.5 py-1.5 transition-all">
                                  <Play className="w-3 h-3" /> {t("setActive")}
                                </button>
                              )}
                              <button onClick={() => setHistoryTarget(po)} title={t("history")} aria-label={t("history")}
                                className="text-slate-500 hover:text-slate-900 hover:bg-slate-100 p-1.5 rounded-lg transition-all">
                                <HistoryIcon className="w-4 h-4" />
                              </button>
                              <button onClick={() => setEditTarget(po)} title={t("editPO")} aria-label={t("editPO")}
                                className="text-slate-500 hover:text-slate-900 hover:bg-slate-100 p-1.5 rounded-lg transition-all">
                                <Pencil className="w-4 h-4" />
                              </button>
                              {po.status === "ACTIVE" && (
                                <button onClick={() => setForceCloseTarget(po)} title={t("forceCloseBtn")}
                                  className="text-pale-red-foreground hover:bg-pale-red p-1.5 rounded-lg transition-all">
                                  <AlertTriangle className="w-4 h-4" />
                                </button>
                              )}
                              <button onClick={() => setVerifyTarget(po)} title={po.is_verified ? t("editCosts") : t("verifyCosts")}
                                className="text-pale-blue-foreground hover:bg-pale-blue p-1.5 rounded-lg transition-all">
                                {po.is_verified ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                              </button>
                              <button onClick={() => handleDeletePO(po)} title={t("deletePO")}
                                className="text-slate-500 hover:text-pale-red-foreground hover:bg-pale-red p-1.5 rounded-lg transition-all">
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
            </>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="px-4 md:px-5 py-4 border-t border-slate-100 flex items-center justify-between gap-2 flex-wrap">
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

      {/* Dialogs */}
      {forceCloseTarget && (
        <ForceCloseModal
          po={forceCloseTarget}
          unit={unit}
          onUnit={setUnit}
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
      {editTarget && <EditPOModal po={editTarget} unit={unit} onUnit={setUnit} onClose={() => setEditTarget(null)} onDone={changed} />}
      {historyTarget && <POHistoryDialog po={historyTarget} unit={unit} onClose={() => setHistoryTarget(null)} onChanged={changed} />}
      {deductOpen && <ShiftDeductDialog unit={unit} owner onClose={() => setDeductOpen(false)} onSaved={changed} />}
    </div>
  );
}
