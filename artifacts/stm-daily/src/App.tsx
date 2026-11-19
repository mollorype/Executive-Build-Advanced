import { useState, useCallback, useEffect, useRef } from "react";
import { type ShiftPayload, type StaffLoginState, AUTH_STORAGE_KEY, authClient, staffAuth, storedStaffUser, supabase, submitShift } from "./lib/supabase";
import TeamChat, { useChatUnread } from "./components/team-chat";
import { CHAT_STRINGS } from "./lib/team-chat-core";
import { enqueueShift, flushQueue, useOfflineSync, useQueueItemStatus, type LinkedExpensePayload } from "./lib/offlineQueue";
import "./index.css";

// ─── helpers ────────────────────────────────────────────────────────────────
function n(v: string): number {
  const x = parseFloat(v.replace(/,/g, ""));
  return isNaN(x) ? 0 : x;
}

function fmt(v: number): string {
  if (v === 0) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(v);
}

function fmtSigned(v: number): string {
  const f = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.abs(v));
  return (v >= 0 ? "+" : "−") + " " + f + " MMK";
}

// ─── types ───────────────────────────────────────────────────────────────────
type Screen = "login" | "checking" | "denied" | "mode-select" | "form" | "confirm" | "success" | "settings" | "chat";

interface FuelRow { totalAmount: string; price: string; liters: string; }
interface DieselRow { cash: string; price: string; }
interface ExpenseItem { name: string; amount: string; profileId?: string; txnType?: "payment" | "debt"; }
type PipaProduct = "92" | "95" | "PD" | "D";
interface PipaItem { product: PipaProduct; containers: string; price: string; }
interface JellyCanItem { product: PipaProduct; pieces: string; liters: string; price: string; }
interface FormData {
  fuel92: FuelRow;          // Fuel 92 — normal pump
  fuel92New: FuelRow;       // Fuel 92 — new pump (closable)
  fuel92NewOpen: boolean;
  fuel95: FuelRow;
  premiumDiesel: FuelRow;
  pipa: PipaItem[];
  jellyCan: JellyCanItem[];
  diesel: DieselRow;
  expenses: ExpenseItem[];
  actualCash: string;
  shiftDate: string;
}

const PIPA_PRODUCT_LABELS: Record<PipaProduct, string> = {
  "92": "Fuel 92", "95": "Fuel 95", "PD": "Premium Diesel", "D": "Diesel",
};

// ─── Language / i18n ──────────────────────────────────────────────────────────
type Lang = "en" | "my";

const STRINGS = {
  signInTitle:          { en: "Sign in to continue",       my: "အကောင့်ဝင်ပါ။" },
  workEmail:            { en: "Work Email",                 my: "အကောင့်အီးမေးထည့်ပါ" },
  password:             { en: "Password",                   my: "စကားဝှက်" },
  confirmPassword:      { en: "Type it again",              my: "စကားဝှက် ထပ်ရိုက်ပါ" },
  createPassword:       { en: "Create your password",       my: "စကားဝှက် အသစ်ဖန်တီးပါ" },
  enterPassword:        { en: "Enter your password",        my: "စကားဝှက် ထည့်ပါ" },
  signIn:               { en: "Sign in →",                  my: "ဝင်မည် →" },
  fuelProducts:         { en: "Fuel Products",             my: "ဆီ အမျိုးအစား" },
  totalAmount:          { en: "Total Amount",              my: "ရောင်းရငွေ" },
  literPrice:           { en: "Liter Price",               my: "လီတာစျေးနှုန်း" },
  literSold:            { en: "Liters Sold",               my: "ရောင်းရလီတာ" },
  normalPump:           { en: "Normal Pump",               my: "ပုံမှန်ပန့်" },
  newPump:              { en: "New Pump",                  my: "ပန့်အသစ်" },
  addNewPump:           { en: "Add New Pump",              my: "ပန့်အသစ် ထည့်ရန်" },
  pipa:                 { en: "Pipa",                      my: "ပီပါ" },
  addPipaEntry:         { en: "Add Pipa Entry",            my: "ပီပါထည့်ရန်" },
  cashAmount:           { en: "Cash Amount",               my: "ငွေပမာဏ" },
  grandTotalLabel:      { en: "Grand Total (All Products)", my: "စုစုပေါင်းငွေပမာဏ" },
  operationalExpenses:  { en: "Other Costs and Income",    my: "အခြားကုန်ကျစရိတ်/ဝင်ငွေ" },
  expenseName:          { en: "Expense Name",              my: "အကြောင်းအရာ" },
  amount:               { en: "Amount",                    my: "ပမာဏ" },
  actualCash:           { en: "Actual Cash Collected",     my: "ငွေသားပမာဏ" },
  difference:           { en: "Difference",                my: "ကွာခြားချက်" },
  reviewSubmit:         { en: "Review & Submit →",         my: "ပေးပို့မည် →" },
  netExpected:          { en: "Net Expected",              my: "ရှိရမည့်ငွေ" },
  grandTotalShort:      { en: "Grand Total",               my: "စုစုပေါင်းငွေပမာဏ" },
  actualCollected:      { en: "Actual Collected",          my: "ငွေသားပမာဏ" },
  syncedLabel:          { en: "Synced",                    my: "ပေးပို့ပြီး" },
  pendingSyncLabel:     { en: "Pending sync",               my: "ပေးပို့ရန် စောင့်ဆိုင်းနေသည်" },
  offlineLabel:         { en: "Offline",                    my: "အင်တာနက် မရှိပါ" },
} as const;

function t(lang: Lang, key: keyof typeof STRINGS): string {
  return STRINGS[key][lang];
}

const LANG_KEY = "stm_daily_lang";

function LangToggle({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  return (
    <button
      type="button"
      onClick={() => {
        const next: Lang = lang === "en" ? "my" : "en";
        setLang(next);
        localStorage.setItem(LANG_KEY, next);
      }}
      aria-label={`Switch language (currently ${lang === "en" ? "English" : "Burmese"})`}
      className="flex items-center gap-0.5 bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] rounded-lg p-0.5 transition-colors"
    >
      <span className={`text-[11px] font-bold rounded px-1.5 py-0.5 ${lang === "en" ? "bg-blue-600 text-white" : "text-gray-600"}`}>EN</span>
      <span className={`text-[11px] font-bold rounded px-1.5 py-0.5 ${lang === "my" ? "bg-blue-600 text-white" : "text-gray-600"}`}>မြ</span>
    </button>
  );
}

const EMPTY: FormData = {
  fuel92:         { totalAmount: "", price: "", liters: "" },
  fuel92New:      { totalAmount: "", price: "", liters: "" },
  fuel92NewOpen:  true,
  fuel95:         { totalAmount: "", price: "", liters: "" },
  premiumDiesel:  { totalAmount: "", price: "", liters: "" },
  pipa:           [],
  jellyCan:       [],
  diesel:         { cash: "", price: "" },
  expenses:       [],
  actualCash:     "",
  shiftDate:      "",
};

/** Litres for one pump row: entered/auto-filled litres, else derived from total ÷ price. */
function fuelRowLiters(row: FuelRow): number {
  return n(row.liters) > 0 ? n(row.liters) : (n(row.price) > 0 ? n(row.totalAmount) / n(row.price) : 0);
}

type Pump92 = { key: "normal" | "new"; row: FuelRow };

/** The Fuel 92 pumps that count: the normal pump always, the new pump only while its card is open. */
function fuel92Pumps(form: FormData): Pump92[] {
  return form.fuel92NewOpen
    ? [{ key: "normal", row: form.fuel92 }, { key: "new", row: form.fuel92New }]
    : [{ key: "normal", row: form.fuel92 }];
}

/** Whether the "new pump" card is shown — remembered per device, since a station either has it or doesn't. */
const NEW_PUMP_KEY = "stm_daily_92_new_pump_open";
function loadNewPumpOpen(): boolean {
  try { return localStorage.getItem(NEW_PUMP_KEY) !== "0"; } catch { return true; }
}
function saveNewPumpOpen(open: boolean) {
  try { localStorage.setItem(NEW_PUMP_KEY, open ? "1" : "0"); } catch { /* storage unavailable — default next time */ }
}

// ─── Input component ─────────────────────────────────────────────────────────
function GoldInput({
  label, value, onChange, placeholder = "0", readOnly = false, prefix
}: {
  label: string; value: string; onChange?: (v: string) => void;
  placeholder?: string; readOnly?: boolean; prefix?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">{label}</label>
      <div className="relative">
        {prefix && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600 text-sm font-semibold select-none">{prefix}</span>
        )}
        <input
          type="number"
          value={value}
          onChange={e => onChange?.(e.target.value)}
          placeholder={placeholder}
          readOnly={readOnly}
          className={[
            "w-full rounded-xl border px-3 py-3 text-base font-semibold outline-none transition-all tabular-nums",
            prefix ? "pl-8" : "",
            readOnly
              ? "bg-[#0d1117] border-[#30363d] text-gray-500 cursor-default"
              : "bg-[#0d1117] border-[#30363d] text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 placeholder:text-gray-700",
          ].join(" ")}
        />
      </div>
    </div>
  );
}

// ─── Pipa panel — multi-item, each with product dropdown + containers + price ──
const PIPA_COLORS: Record<PipaProduct, string> = {
  "92": "bg-blue-500", "95": "bg-emerald-500", "PD": "bg-purple-500", "D": "bg-orange-500",
};

function PipaPanel({ items, onChange, lang }: {
  items: PipaItem[];
  onChange: (items: PipaItem[]) => void;
  lang: Lang;
}) {
  function add() {
    onChange([...items, { product: "92", containers: "", price: "" }]);
  }
  function remove(i: number) {
    onChange(items.filter((_, idx) => idx !== i));
  }
  function update(i: number, field: keyof PipaItem, val: string) {
    onChange(items.map((item, idx) => idx === i ? { ...item, [field]: val } : item));
  }

  return (
    <div className="bg-[#161b22] rounded-2xl border border-[#30363d] overflow-hidden">
      <div className="px-4 py-2.5 flex items-center gap-2 bg-[#1c2433] border-b border-[#30363d]">
        <span className="text-xs font-bold text-amber-400 uppercase tracking-widest">{t(lang, "pipa")}</span>
        <span className="ml-auto text-[10px] text-gray-600">1 {t(lang, "pipa")} = 215 L</span>
      </div>

      {items.length === 0 && (
        <p className="text-xs text-gray-600 text-center py-5">No {t(lang, "pipa")} entries — tap + to add one</p>
      )}

      {items.map((item, i) => {
        const containers = n(item.containers);
        const price = n(item.price);
        const total = containers * price;
        return (
          <div key={i} className="px-4 pt-4 pb-3 border-b border-[#30363d] last:border-0">
            <div className="flex items-center gap-2 mb-3">
              <span className={`text-[10px] font-bold text-white rounded px-1.5 py-0.5 ${PIPA_COLORS[item.product]}`}>
                {item.product}
              </span>
              <span className="text-xs font-semibold text-gray-500">Entry {i + 1}</span>
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label={`Remove ${t(lang, "pipa")} entry ${i + 1}`}
                className="ml-auto text-gray-600 hover:text-red-400 transition-colors p-0.5"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {/* Product dropdown */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">Product</label>
                <select
                  value={item.product}
                  onChange={e => update(i, "product", e.target.value as PipaProduct)}
                  className="w-full rounded-xl border px-3 py-3 text-sm font-semibold outline-none transition-all bg-[#0d1117] border-[#30363d] text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                >
                  <option value="92">Fuel 92</option>
                  <option value="95">Fuel 95</option>
                  <option value="PD">Premium Diesel</option>
                  <option value="D">Diesel</option>
                </select>
              </div>
              {/* Containers */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">Containers</label>
                <input
                  type="number"
                  value={item.containers}
                  onChange={e => update(i, "containers", e.target.value)}
                  placeholder="0"
                  className="w-full rounded-xl border px-3 py-3 text-base font-semibold outline-none transition-all tabular-nums bg-[#0d1117] border-[#30363d] text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 placeholder:text-gray-700"
                />
                {containers > 0 && (
                  <p className="text-[10px] text-amber-400 font-semibold">{(containers * 215).toLocaleString()} L</p>
                )}
              </div>
              {/* Price per pipa */}
              <GoldInput
                label="Price / Pipa"
                value={item.price}
                onChange={v => update(i, "price", v)}
                prefix="K"
              />
            </div>
            {total > 0 && (
              <p className="text-xs text-amber-400 font-semibold text-right mt-2">{fmt(total)} MMK</p>
            )}
          </div>
        );
      })}

      <div className="px-4 py-3 flex items-center justify-between">
        <button
          type="button"
          onClick={add}
          className="flex items-center gap-1.5 text-xs font-bold text-amber-400 hover:text-amber-300 border border-[#30363d] hover:border-amber-500/50 rounded-xl px-3 py-1.5 transition-all"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          {t(lang, "addPipaEntry")}
        </button>
        {items.length > 0 && (
          <span className="text-xs font-bold text-amber-400">
            Total: {fmt(items.reduce((s, item) => s + n(item.containers) * n(item.price), 0))} MMK
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Jelly Can panel — multi-item, each with product + pieces + L/can + price ──
function JellyCanPanel({ items, onChange }: {
  items: JellyCanItem[];
  onChange: (items: JellyCanItem[]) => void;
}) {
  function add() {
    onChange([...items, { product: "92", pieces: "", liters: "", price: "" }]);
  }
  function remove(i: number) { onChange(items.filter((_, idx) => idx !== i)); }
  function update(i: number, field: keyof JellyCanItem, val: string) {
    onChange(items.map((item, idx) => idx === i ? { ...item, [field]: val } : item));
  }

  const panelTotal = items.reduce((s, item) => s + n(item.pieces) * n(item.price), 0);

  return (
    <div className="bg-[#161b22] rounded-2xl border border-[#30363d] overflow-hidden">
      <div className="px-4 py-2.5 flex items-center gap-2 bg-[#1c2433] border-b border-[#30363d]">
        <span className="text-xs font-bold text-teal-400 uppercase tracking-widest">Jelly Can · ပုံးဝါ</span>
        <span className="ml-auto text-[10px] text-gray-600">Enter liters manually</span>
      </div>

      {items.length === 0 && (
        <p className="text-xs text-gray-600 text-center py-5">No jelly can entries — tap + to add one</p>
      )}

      {items.map((item, i) => {
        const pieces = n(item.pieces);
        const litersPerCan = n(item.liters);
        const price = n(item.price);
        const totalLiters = pieces * litersPerCan;
        const totalAmt = pieces * price;
        return (
          <div key={i} className="px-4 pt-4 pb-3 border-b border-[#30363d] last:border-0">
            <div className="flex items-center gap-2 mb-3">
              <span className={`text-[10px] font-bold text-white rounded px-1.5 py-0.5 ${PIPA_COLORS[item.product]}`}>
                {item.product}
              </span>
              <span className="text-xs font-semibold text-gray-500">Entry {i + 1}</span>
              <button type="button" onClick={() => remove(i)}
                aria-label={`Remove jelly can entry ${i + 1}`}
                className="ml-auto text-gray-600 hover:text-red-400 transition-colors p-0.5">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {/* Row 1: Product + Pieces */}
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">Product</label>
                <select value={item.product}
                  onChange={e => update(i, "product", e.target.value as PipaProduct)}
                  className="w-full rounded-xl border px-3 py-3 text-sm font-semibold outline-none bg-[#0d1117] border-[#30363d] text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20">
                  <option value="92">Fuel 92</option>
                  <option value="95">Fuel 95</option>
                  <option value="PD">Premium Diesel</option>
                  <option value="D">Diesel</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">Pieces (အရေအတွက်)</label>
                <input type="number" value={item.pieces}
                  onChange={e => update(i, "pieces", e.target.value)}
                  placeholder="0"
                  className="w-full rounded-xl border px-3 py-3 text-base font-semibold outline-none tabular-nums bg-[#0d1117] border-[#30363d] text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 placeholder:text-gray-700"
                />
              </div>
            </div>
            {/* Row 2: Liters per can + Price */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">Liters / Can (ပါရှိသောလီတာ)</label>
                <input type="number" value={item.liters}
                  onChange={e => update(i, "liters", e.target.value)}
                  placeholder="0"
                  className="w-full rounded-xl border px-3 py-3 text-base font-semibold outline-none tabular-nums bg-[#0d1117] border-[#30363d] text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 placeholder:text-gray-700"
                />
                {totalLiters > 0 && (
                  <p className="text-[10px] text-teal-400 font-semibold">{totalLiters.toLocaleString("en-US", { maximumFractionDigits: 2 })} L total</p>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">Price / Can</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600 text-sm font-semibold select-none">K</span>
                  <input type="number" value={item.price}
                    onChange={e => update(i, "price", e.target.value)}
                    placeholder="0"
                    className="w-full rounded-xl border pl-8 pr-3 py-3 text-base font-semibold outline-none tabular-nums bg-[#0d1117] border-[#30363d] text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 placeholder:text-gray-700"
                  />
                </div>
              </div>
            </div>
            {totalAmt > 0 && (
              <p className="text-xs text-teal-400 font-semibold text-right mt-2">{fmt(totalAmt)} MMK</p>
            )}
          </div>
        );
      })}

      <div className="px-4 py-3 flex items-center justify-between">
        <button type="button" onClick={add}
          className="flex items-center gap-1.5 text-xs font-bold text-teal-400 hover:text-teal-300 border border-[#30363d] hover:border-teal-500/50 rounded-xl px-3 py-1.5 transition-all">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Add Jelly Can · ပုံးဝါထည့်ရန်
        </button>
        {items.length > 0 && (
          <span className="text-xs font-bold text-teal-400">Total: {fmt(panelTotal)} MMK</span>
        )}
      </div>
    </div>
  );
}

// ─── Product card — full-width horizontal row, dark themed ────────────────────
function ProductCard({ label, badge, accentText, accentBorder, totalAmount, price, liters, total, onTotalAmount, onPrice, onLiters, lang }: {
  label: string; badge: string; accentText: string; accentBorder: string;
  totalAmount: string; price: string; liters: string; total: number;
  onTotalAmount: (v: string) => void; onPrice: (v: string) => void; onLiters: (v: string) => void;
  lang: Lang;
}) {
  return (
    <div className={`bg-[#161b22] rounded-2xl border border-[#30363d] overflow-hidden border-l-4 ${accentBorder}`}>
      <div className="px-5 pt-4 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className={`text-[11px] font-black px-2 py-0.5 rounded-md bg-white/5 ${accentText}`}>{badge}</span>
          <span className="text-sm font-bold text-white uppercase tracking-wide">{label}</span>
        </div>
        {total > 0 && (
          <span className={`text-base font-bold tabular-nums ${accentText}`}>
            {fmt(total)} <span className="text-gray-600 text-xs font-normal">MMK</span>
          </span>
        )}
      </div>
      <PumpInputs totalAmount={totalAmount} price={price} liters={liters}
        onTotalAmount={onTotalAmount} onPrice={onPrice} onLiters={onLiters} lang={lang} />
    </div>
  );
}

/** Total / price / litres inputs for one pump. */
function PumpInputs({ totalAmount, price, liters, onTotalAmount, onPrice, onLiters, lang }: {
  totalAmount: string; price: string; liters: string;
  onTotalAmount: (v: string) => void; onPrice: (v: string) => void; onLiters: (v: string) => void;
  lang: Lang;
}) {
  return (
    <>
      <div className="px-5 pb-3 grid grid-cols-2 gap-4">
        <GoldInput label={t(lang, "totalAmount")} value={totalAmount} onChange={onTotalAmount} prefix="K" />
        <GoldInput label={t(lang, "literPrice")} value={price} onChange={onPrice} prefix="K" />
      </div>
      <div className="px-5 pb-5">
        <GoldInput label={t(lang, "literSold")} value={liters} onChange={onLiters} />
      </div>
    </>
  );
}

type FuelField = "totalAmount" | "price" | "liters";

// ─── Fuel 92 card — normal pump + closable new pump ────────────────────────────
function Fuel92Card({ normal, fresh, newOpen, total, onField, onOpenNew, onCloseNew, lang }: {
  normal: FuelRow; fresh: FuelRow; newOpen: boolean; total: number;
  onField: (key: "fuel92" | "fuel92New", field: FuelField, v: string) => void;
  onOpenNew: () => void; onCloseNew: () => void;
  lang: Lang;
}) {
  const pumpHeader = (label: string, amount: number, close?: () => void) => (
    <div className="px-5 pb-2 flex items-center justify-between gap-2">
      <span className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">{label}</span>
      <div className="flex items-center gap-2">
        {amount > 0 && <span className="text-xs font-semibold text-blue-300 tabular-nums">{fmt(amount)}</span>}
        {close && (
          <button type="button" onClick={close} aria-label={`Close ${t(lang, "newPump")}`}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-500 hover:text-white hover:bg-white/10 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="bg-[#161b22] rounded-2xl border border-[#30363d] overflow-hidden border-l-4 border-l-blue-500">
      <div className="px-5 pt-4 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="text-[11px] font-black px-2 py-0.5 rounded-md bg-white/5 text-blue-400">92</span>
          <span className="text-sm font-bold text-white uppercase tracking-wide">Fuel 92</span>
        </div>
        {total > 0 && (
          <span className="text-base font-bold tabular-nums text-blue-400">
            {fmt(total)} <span className="text-gray-600 text-xs font-normal">MMK</span>
          </span>
        )}
      </div>

      {pumpHeader(t(lang, "normalPump"), n(normal.totalAmount))}
      <PumpInputs totalAmount={normal.totalAmount} price={normal.price} liters={normal.liters}
        onTotalAmount={v => onField("fuel92", "totalAmount", v)} onPrice={v => onField("fuel92", "price", v)}
        onLiters={v => onField("fuel92", "liters", v)} lang={lang} />

      {newOpen ? (
        <div className="border-t border-[#30363d] pt-3">
          {pumpHeader(t(lang, "newPump"), n(fresh.totalAmount), onCloseNew)}
          <PumpInputs totalAmount={fresh.totalAmount} price={fresh.price} liters={fresh.liters}
            onTotalAmount={v => onField("fuel92New", "totalAmount", v)} onPrice={v => onField("fuel92New", "price", v)}
            onLiters={v => onField("fuel92New", "liters", v)} lang={lang} />
        </div>
      ) : (
        <div className="px-5 pb-5">
          <button type="button" onClick={onOpenNew}
            className="w-full py-2.5 rounded-xl border border-dashed border-[#30363d] hover:border-blue-500/60 text-sm font-semibold text-gray-400 hover:text-blue-300 transition-colors">
            + {t(lang, "addNewPump")}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Expenses panel — searchable debt profile dropdown + amount ────────────────
type ProfileHit = { id: string; name: string; relation: string };

function ExpensesPanel({ items, onChange, lang }: {
  items: ExpenseItem[];
  onChange: (items: ExpenseItem[]) => void;
  lang: Lang;
}) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [profileId, setProfileId] = useState<string | undefined>(undefined);
  const [txnType, setTxnType] = useState<"payment" | "debt">("debt");
  const [hits, setHits] = useState<ProfileHit[]>([]);
  const [showDrop, setShowDrop] = useState(false);
  const [searching, setSearching] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setShowDrop(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  async function handleNameChange(val: string) {
    setName(val);
    setProfileId(undefined);
    if (!val.trim()) { setHits([]); setShowDrop(false); return; }
    setSearching(true);
    // Narrow SECURITY DEFINER RPC — returns only id/name/relation. The
    // debt_profiles table itself is not readable by the anon role.
    const { data } = await supabase.rpc("search_debt_profiles_basic", {
      search_term: val.trim(),
    });
    setSearching(false);
    if (data && data.length > 0) {
      setHits(data as ProfileHit[]);
      setShowDrop(true);
    } else {
      setHits([]);
      setShowDrop(false);
    }
  }

  function selectHit(hit: ProfileHit) {
    setName(hit.name);
    setProfileId(hit.id);
    setHits([]);
    setShowDrop(false);
  }

  function addItem() {
    if (!name.trim() || !amount.trim()) return;
    onChange([...items, { name: name.trim(), amount: amount.trim(), profileId, txnType: profileId ? txnType : undefined }]);
    setName(""); setAmount(""); setProfileId(undefined); setTxnType("debt"); setHits([]); setShowDrop(false);
  }

  function removeItem(idx: number) { onChange(items.filter((_, i) => i !== idx)); }

  const totalCosts  = items.reduce((s, i) => s + (i.txnType !== "payment" ? n(i.amount) : 0), 0);
  const totalIncome = items.reduce((s, i) => s + (i.txnType === "payment" ? n(i.amount) : 0), 0);

  return (
    <div className="flex flex-col gap-3">
      {/* Phones: the name/profile search gets its own full-width row, with Amount + Add
          below it. sm+: one row, as before ("sm:contents" dissolves the inner wrapper). */}
      <div className="flex flex-col sm:flex-row gap-2">
        {/* Name / search combobox */}
        <div className="flex-1 min-w-0 flex flex-col gap-1.5 relative" ref={wrapRef}>
          <label className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">{t(lang, "expenseName")}</label>
          <div className="relative">
            <input
              type="text"
              value={name}
              onChange={e => handleNameChange(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addItem()}
              onFocus={() => { if (hits.length > 0) setShowDrop(true); }}
              placeholder="Search a profile or type a new name…"
              className={`w-full rounded-xl border px-3 ${profileId ? "pr-16" : ""} py-3 text-sm font-medium outline-none bg-[#0d1117] text-white placeholder:text-gray-700 transition-colors ${
                profileId
                  ? "border-blue-500 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20"
                  : "border-[#30363d] focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              }`}
            />
            {profileId && (
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-bold bg-blue-500/20 text-blue-400 rounded px-1.5 py-0.5 pointer-events-none">
                LINKED
              </span>
            )}
            {searching && !profileId && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs animate-pulse">…</span>
            )}
          </div>
          {showDrop && hits.length > 0 && (
            <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-[#161b22] border border-[#30363d] rounded-xl shadow-2xl overflow-hidden">
              <p className="px-3 py-1.5 text-[10px] font-bold text-gray-500 uppercase tracking-widest bg-[#1c2433] border-b border-[#30363d]">
                Debt Profiles
              </p>
              {hits.map(h => (
                <button
                  key={h.id}
                  type="button"
                  onMouseDown={() => selectHit(h)}
                  className="w-full flex items-center justify-between px-3 py-2.5 text-sm hover:bg-[#1c2433] transition-colors text-left border-t border-[#30363d]"
                >
                  <span className="font-semibold text-white">{h.name}</span>
                  <span className="text-xs text-gray-500 ml-2 shrink-0">{h.relation}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-2 sm:contents">
        {/* Amount */}
        <div className="flex-1 sm:flex-none sm:w-32 flex flex-col gap-1.5">
          <label className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">{t(lang, "amount")}</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600 text-sm font-semibold select-none">K</span>
            <input
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addItem()}
              placeholder="0"
              className="w-full rounded-xl border pl-8 pr-3 py-3 text-base font-semibold outline-none tabular-nums bg-[#0d1117] border-[#30363d] text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 placeholder:text-gray-700"
            />
          </div>
        </div>

        {/* Add button */}
        <div className="flex flex-col gap-1.5">
          <label aria-hidden="true" className="text-[11px] font-bold text-transparent uppercase tracking-widest select-none">Add</label>
          <button
            type="button"
            onClick={addItem}
            className="h-[50px] px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm transition-all active:scale-95 flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add
          </button>
        </div>
        </div>
      </div>

      {/* Linked profile: payment/debt toggle */}
      {profileId && (
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl px-3 py-2.5 space-y-2">
          <p className="text-[11px] font-bold text-blue-400">✓ Linked to Debt Tracker</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setTxnType("debt")}
              className={`flex-1 py-1.5 rounded-xl text-[11px] font-bold border transition-all ${
                txnType === "debt"
                  ? "bg-red-500 text-white border-red-500"
                  : "bg-transparent text-gray-500 border-[#30363d] hover:text-gray-300"
              }`}
            >
              ↑ Add Debt (increase balance)
            </button>
            <button
              type="button"
              onClick={() => setTxnType("payment")}
              className={`flex-1 py-1.5 rounded-xl text-[11px] font-bold border transition-all ${
                txnType === "payment"
                  ? "bg-emerald-500 text-white border-emerald-500"
                  : "bg-transparent text-gray-500 border-[#30363d] hover:text-gray-300"
              }`}
            >
              ↓ Payment (reduce debt)
            </button>
          </div>
        </div>
      )}

      {/* Item list */}
      {items.length > 0 && (
        <div className="rounded-xl border border-[#30363d] overflow-hidden">
          {items.map((item, idx) => (
            <div key={idx} className={["flex items-center justify-between px-4 py-2.5 text-sm bg-[#161b22]", idx > 0 ? "border-t border-[#30363d]" : ""].join(" ")}>
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-medium text-gray-300 truncate">{item.name}</span>
                {item.profileId && (
                  <span className={`text-[9px] font-bold rounded px-1 py-0.5 shrink-0 ${
                    item.txnType === "debt" ? "bg-red-500/20 text-red-400" : "bg-emerald-500/20 text-emerald-400"
                  }`}>
                    {item.txnType === "debt" ? "↑ DEBT" : "↓ PAY"}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className={`font-semibold tabular-nums ${item.txnType === "payment" ? "text-emerald-400" : "text-red-400"}`}>
                  {item.txnType === "payment" ? "+" : "−"}{fmt(n(item.amount))} MMK
                </span>
                <button
                  type="button"
                  onClick={() => removeItem(idx)}
                  aria-label={`Remove ${item.name}`}
                  className="w-6 h-6 flex items-center justify-center rounded-full bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
          <div className="bg-[#1c2433] border-t border-[#30363d] px-4 py-2.5 space-y-1">
            {totalIncome > 0 && (
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-emerald-600 uppercase tracking-wider">+ Income</span>
                <span className="text-sm font-bold text-emerald-400 tabular-nums">+{fmt(totalIncome)} MMK</span>
              </div>
            )}
            {totalCosts > 0 && (
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">− Costs</span>
                <span className="text-sm font-bold text-red-400 tabular-nums">−{fmt(totalCosts)} MMK</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Login screen ─────────────────────────────────────────────────────────────
const MIN_STAFF_PASSWORD = 6;
const LOGIN_FIELD_CLS = "w-full bg-[#0d1117] border border-[#30363d] rounded-xl px-4 py-3 text-base sm:text-sm font-medium text-white focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all placeholder:text-gray-700";
const LOGIN_LABEL_CLS = "block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5";

type LoginStep = "email" | "password" | "create";

// Email first; then the password — or, the first time, choosing one.
// Supabase Auth checks the password; the staff-auth function only creates the
// login, and only for an email on the STM Daily allowlist with no login yet.
function LoginScreen({ onSignedIn, onDenied, lang, setLang }: {
  onSignedIn: (email: string, userId: string) => void;
  onDenied: (email: string) => void;
  lang: Lang; setLang: (l: Lang) => void;
}) {
  const [step, setStep] = useState<LoginStep>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mail = email.trim().toLowerCase();

  async function signIn() {
    const { data, error: err } = await authClient.auth.signInWithPassword({ email: mail, password });
    if (err || !data.user) {
      const msg = err?.message ?? "";
      setError(/invalid login/i.test(msg) ? "Wrong password. Try again, or ask your manager to reset it."
        : !navigator.onLine || /fetch|network/i.test(msg) ? "No internet connection. Connect and try again."
        : msg || "Couldn't sign in. Try again.");
      return;
    }
    onSignedIn(mail, data.user.id);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (step === "email") {
      if (!mail.includes("@")) { setError("Please enter a valid email address."); return; }
      setBusy(true);
      try {
        const { state } = await staffAuth<{ state: StaffLoginState }>({ action: "status", email: mail });
        if (state === "not_allowed") { onDenied(mail); return; }
        setPassword(""); setConfirmPw(""); setShow(false);
        setStep(state === "has_password" ? "password" : "create");
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (step === "create") {
      if (password.length < MIN_STAFF_PASSWORD) { setError(`Use at least ${MIN_STAFF_PASSWORD} characters.`); return; }
      if (password !== confirmPw) { setError("The two passwords don't match."); return; }
      setBusy(true);
      try {
        await staffAuth({ action: "set_password", email: mail, password });
      } catch (err) {
        setError((err as Error).message);
        setBusy(false);
        return;
      }
      await signIn();
      setBusy(false);
      return;
    }
    setBusy(true);
    await signIn();
    setBusy(false);
  }

  const eye = (
    <button type="button" onClick={() => setShow(v => !v)} aria-label={show ? "Hide password" : "Show password"}
      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white p-1">
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        {show
          ? <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.1A9.5 9.5 0 0112 5c5 0 9 4.5 10 7-.4 1-1.2 2.3-2.4 3.6M6.1 6.1C4.2 7.4 2.8 9.4 2 12c1 2.5 5 7 10 7 1.7 0 3.3-.5 4.6-1.3" />
          : <><path strokeLinecap="round" strokeLinejoin="round" d="M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7S3 14.5 2 12z" /><circle cx="12" cy="12" r="3" /></>}
      </svg>
    </button>
  );

  return (
    <div className="min-h-screen bg-[#0f111a] flex flex-col items-center justify-center px-4">
      <div className="absolute top-4 right-4">
        <LangToggle lang={lang} setLang={setLang} />
      </div>
      <div className="mb-8 text-center">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-blue-600/20 mb-4">
          <svg className="w-10 h-10 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2M12 2a10 10 0 100 20A10 10 0 0012 2z" />
          </svg>
        </div>
        <h1 className="text-3xl font-bold text-white tracking-tight">STM <span className="text-blue-400">Daily</span></h1>
        <p className="text-sm text-gray-500 mt-1">Daily Shift Report Portal</p>
      </div>

      <form onSubmit={handleSubmit} className="w-full max-w-sm bg-[#161b22] rounded-2xl border border-[#30363d] p-6 sm:p-8">
        {step === "email" ? (
          <>
            <h2 className="text-lg font-bold text-white mb-1">{t(lang, "signInTitle")}</h2>
            <p className="text-sm text-gray-500 mb-6">Enter your work email to start your shift report.</p>

            <label htmlFor="login-email" className={LOGIN_LABEL_CLS}>{t(lang, "workEmail")}</label>
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={e => { setEmail(e.target.value); setError(""); }}
              placeholder="you@company.com"
              autoComplete="username"
              className={LOGIN_FIELD_CLS}
              autoFocus
              required
            />
          </>
        ) : (
          <>
            <h2 className="text-lg font-bold text-white mb-1">{t(lang, step === "create" ? "createPassword" : "enterPassword")}</h2>
            <p className="text-sm text-gray-500 mb-5">
              {step === "create"
                ? `First time signing in — choose a password (at least ${MIN_STAFF_PASSWORD} characters; numbers are fine). You'll use it every time.`
                : "Welcome back."}
            </p>

            <div className="flex items-center justify-between gap-2 bg-[#0d1117] border border-[#30363d] rounded-xl px-4 py-2.5 mb-4">
              <span className="text-sm text-gray-300 truncate">{mail}</span>
              <button type="button" onClick={() => { setStep("email"); setError(""); setPassword(""); setConfirmPw(""); }}
                className="text-xs font-semibold text-blue-400 hover:text-blue-300 shrink-0">Change</button>
            </div>

            <label htmlFor="login-password" className={LOGIN_LABEL_CLS}>{t(lang, "password")}</label>
            <div className="relative">
              <input
                id="login-password"
                type={show ? "text" : "password"}
                value={password}
                onChange={e => { setPassword(e.target.value); setError(""); }}
                autoComplete={step === "create" ? "new-password" : "current-password"}
                className={`${LOGIN_FIELD_CLS} pr-11`}
                autoFocus
                required
              />
              {eye}
            </div>

            {step === "create" && (
              <>
                <label htmlFor="login-confirm" className={`${LOGIN_LABEL_CLS} mt-4`}>{t(lang, "confirmPassword")}</label>
                <input
                  id="login-confirm"
                  type={show ? "text" : "password"}
                  value={confirmPw}
                  onChange={e => { setConfirmPw(e.target.value); setError(""); }}
                  autoComplete="new-password"
                  className={LOGIN_FIELD_CLS}
                  required
                />
              </>
            )}
          </>
        )}

        {error && <p role="alert" className="text-xs text-red-400 mt-2">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="mt-5 w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white font-bold rounded-2xl py-4 text-base transition-all active:scale-[0.98]"
        >
          {busy && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
          {step === "email" ? "Continue →" : step === "create" ? "Save password & sign in →" : t(lang, "signIn")}
        </button>
        {step === "password" && (
          <p className="text-xs text-gray-600 mt-3 text-center">Forgot it? Ask your manager to reset your password.</p>
        )}
      </form>
      <p className="text-xs text-gray-700 mt-6">STM Daily · Confidential</p>
    </div>
  );
}

// ─── Checking screen ──────────────────────────────────────────────────────────
function CheckingScreen() {
  return (
    <div className="min-h-screen bg-[#0f111a] flex items-center justify-center">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-[#30363d] border-t-blue-500 rounded-full animate-spin mx-auto mb-4" />
        <p className="text-gray-400 font-semibold">Verifying access…</p>
      </div>
    </div>
  );
}

// ─── Access Denied screen ─────────────────────────────────────────────────────
function DeniedScreen({ email, onBack }: { email: string; onBack: () => void }) {
  return (
    <div className="min-h-screen bg-[#0f111a] flex flex-col items-center justify-center px-4 text-center">
      <div className="w-20 h-20 rounded-3xl bg-red-500/10 flex items-center justify-center mb-6">
        <svg className="w-10 h-10 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
        </svg>
      </div>
      <h1 className="text-3xl font-bold text-white mb-2">Access Not Granted</h1>
      <p className="text-gray-500 text-sm mb-1">
        <span className="font-semibold text-gray-300">{email}</span> is not on the approved list.
      </p>
      <p className="text-gray-600 text-sm mb-8">Contact your manager to get access.</p>
      <button
        onClick={onBack}
        className="bg-[#161b22] border border-[#30363d] hover:border-gray-500 text-gray-300 hover:text-white font-bold rounded-xl px-8 py-3 text-sm transition-colors"
      >
        ← Try a Different Email
      </button>
    </div>
  );
}

// ─── Shift form ───────────────────────────────────────────────────────────────
function ShiftForm({ employeeName, onSubmit, onLogout, onBack, lang, setLang, initialData }: {
  employeeName: string;
  onSubmit: (data: FormData, grandTotal: number, difference: number) => void;
  onLogout: () => void;
  onBack: () => void;
  lang: Lang; setLang: (l: Lang) => void;
  initialData?: FormData;
}) {
  const [form, setForm] = useState<FormData>(() => {
    if (initialData) return initialData;
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const localDt = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
    // Pre-fill prices from App Settings defaults — staff can still edit every field.
    const cfg = loadConfig();
    return {
      ...EMPTY,
      shiftDate: localDt,
      fuel92: { ...EMPTY.fuel92, price: cfg.price92 },
      fuel92New: { ...EMPTY.fuel92New, price: cfg.price92 },
      fuel92NewOpen: loadNewPumpOpen(),
      fuel95: { ...EMPTY.fuel95, price: cfg.price95 },
      premiumDiesel: { ...EMPTY.premiumDiesel, price: cfg.pricePD },
      diesel: { ...EMPTY.diesel, price: cfg.priceHSD },
    };
  });

  // Helper to format auto-calculated numbers nicely (no trailing zeros)
  function autoNum(v: number): string {
    if (v === 0) return "";
    return parseFloat(v.toFixed(6)).toString();
  }

  const setFuelField = useCallback((
    key: "fuel92" | "fuel92New" | "fuel95" | "premiumDiesel",
    field: FuelField,
    val: string,
  ) => {
    setForm(f => {
      const row = { ...(f[key] as FuelRow), [field]: val };
      const p = n(row.price);
      if (field === "totalAmount" && p > 0) {
        row.liters = n(val) > 0 ? autoNum(n(val) / p) : row.liters;
      } else if (field === "liters" && p > 0) {
        row.totalAmount = n(val) > 0 ? autoNum(n(val) * p) : row.totalAmount;
      } else if (field === "price" && n(val) > 0) {
        if (n(row.totalAmount) > 0) {
          row.liters = autoNum(n(row.totalAmount) / n(val));
        } else if (n(row.liters) > 0) {
          row.totalAmount = autoNum(n(row.liters) * n(val));
        }
      }
      return { ...f, [key]: row };
    });
  }, []);

  // Totals are the entered totalAmount directly; Fuel 92 adds up every open pump
  const t92   = fuel92Pumps(form).reduce((s, p) => s + n(p.row.totalAmount), 0);
  const t95   = n(form.fuel95.totalAmount);
  const tPD   = n(form.premiumDiesel.totalAmount);
  // Liters: use the stored (entered or auto-calculated) value
  const l92   = fuel92Pumps(form).reduce((s, p) => s + n(p.row.liters), 0);
  const l95   = n(form.fuel95.liters);
  const lPD   = n(form.premiumDiesel.liters);

  const tPipa           = form.pipa.reduce((s, item) => s + n(item.containers) * n(item.price), 0);
  const tJelly          = form.jellyCan.reduce((s, item) => s + n(item.pieces) * n(item.price), 0);
  const tD              = n(form.diesel.cash);
  const grandTotal      = t92 + t95 + tPD + tPipa + tJelly + tD;
  const actualCash      = n(form.actualCash);
  const totalDeductions = form.expenses.reduce((s, i) => s + (i.txnType !== "payment" ? n(i.amount) : 0), 0);
  const totalIncome     = form.expenses.reduce((s, i) => s + (i.txnType === "payment"  ? n(i.amount) : 0), 0);
  const totalExp        = totalDeductions;
  // Pipa and JellyCan are pre-paid / billed separately — exclude from cash expected
  const cashGrandTotal  = t92 + t95 + tPD + tD;   // only cash products
  const netExpected     = cashGrandTotal - totalDeductions + totalIncome;
  const difference      = actualCash - netExpected;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit(form, grandTotal, difference);
  }

  function openNewPump() {
    saveNewPumpOpen(true);
    setForm(f => ({ ...f, fuel92NewOpen: true }));
  }

  function closeNewPump() {
    const r = form.fuel92New;
    if ((n(r.totalAmount) > 0 || n(r.liters) > 0)
        && !window.confirm(lang === "my" ? "ပန့်အသစ်ကို ပိတ်မလား? ထည့်ထားသော ပမာဏများ ဖျက်ပါမည်။" : "Close the New Pump? Its numbers will be cleared.")) return;
    saveNewPumpOpen(false);
    // Clear it, so nothing hidden is ever counted; keep the price for next time.
    setForm(f => ({ ...f, fuel92NewOpen: false, fuel92New: { ...EMPTY.fuel92New, price: f.fuel92New.price } }));
  }

  return (
    <div className="min-h-screen bg-[#0f111a]">
      {/* Phones: two rows (identity + language, then date + actions) so nothing
          forces the page wider than the screen. md+: one row as before. */}
      <div className="sticky top-0 z-10 bg-[#0f111a]/95 backdrop-blur border-b border-[#30363d] px-4 py-3 flex flex-col gap-2.5 md:flex-row md:items-center md:gap-3">
        <div className="flex items-center gap-3 min-w-0 md:flex-1">
          <div className="w-8 h-8 rounded-lg bg-blue-600/20 flex items-center justify-center shrink-0">
            <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2M12 2a10 10 0 100 20A10 10 0 0012 2z" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-gray-500 font-semibold uppercase tracking-widest">STM Daily</p>
            <p className="text-sm font-bold text-white capitalize truncate">{employeeName}'s Shift Report</p>
          </div>
          <div className="shrink-0">
            <LangToggle lang={lang} setLang={setLang} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 md:flex-nowrap md:shrink-0">
          <input
            type="datetime-local"
            value={form.shiftDate}
            onChange={e => setForm(f => ({ ...f, shiftDate: e.target.value }))}
            aria-label="Shift date and time"
            className="flex-1 min-w-[10rem] md:flex-none text-xs text-gray-400 bg-[#161b22] border border-[#30363d] hover:border-gray-500 focus:border-blue-500 focus:outline-none rounded-lg px-2 py-1.5 cursor-pointer"
          />
          <button
            type="button"
            onClick={onBack}
            aria-label="Switch mode"
            className="shrink-0 whitespace-nowrap text-xs text-gray-500 hover:text-white font-semibold border border-[#30363d] hover:border-gray-500 rounded-lg px-2.5 py-1.5 transition-colors"
          >
            <span className="md:hidden">← Mode</span>
            <span className="hidden md:inline">← Switch Mode</span>
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="shrink-0 whitespace-nowrap text-xs text-gray-500 hover:text-white font-semibold border border-[#30363d] hover:border-gray-500 rounded-lg px-2.5 py-1.5 transition-colors"
          >
            Switch User
          </button>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div>
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">{t(lang, "fuelProducts")}</h3>
          {/* Fuel rows — full-width vertical stack */}
          <div className="space-y-3">
            <Fuel92Card normal={form.fuel92} fresh={form.fuel92New} newOpen={form.fuel92NewOpen} total={t92}
              onField={setFuelField} onOpenNew={openNewPump} onCloseNew={closeNewPump} lang={lang} />
            <ProductCard label="Fuel 95" badge="95" accentText="text-emerald-400" accentBorder="border-l-emerald-500"
              totalAmount={form.fuel95.totalAmount} price={form.fuel95.price} liters={form.fuel95.liters} total={t95}
              onTotalAmount={v => setFuelField("fuel95", "totalAmount", v)} onPrice={v => setFuelField("fuel95", "price", v)} onLiters={v => setFuelField("fuel95", "liters", v)} lang={lang} />
            <ProductCard label="Premium Diesel" badge="PD" accentText="text-purple-400" accentBorder="border-l-purple-500"
              totalAmount={form.premiumDiesel.totalAmount} price={form.premiumDiesel.price} liters={form.premiumDiesel.liters} total={tPD}
              onTotalAmount={v => setFuelField("premiumDiesel", "totalAmount", v)} onPrice={v => setFuelField("premiumDiesel", "price", v)} onLiters={v => setFuelField("premiumDiesel", "liters", v)} lang={lang} />
          </div>
          <div className="space-y-3 mt-3">
            <PipaPanel
              items={form.pipa}
              onChange={items => setForm(f => ({ ...f, pipa: items }))} lang={lang} />
            <JellyCanPanel
              items={form.jellyCan}
              onChange={items => setForm(f => ({ ...f, jellyCan: items }))} />

            {/* Diesel — cash only */}
            <div className="bg-[#161b22] rounded-2xl border border-[#30363d] border-l-4 border-l-orange-500 overflow-hidden">
              <div className="px-5 pt-4 pb-2 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="text-[11px] font-black px-2 py-0.5 rounded-md bg-white/5 text-orange-400">D</span>
                  <span className="text-sm font-bold text-white uppercase tracking-wide">Diesel</span>
                </div>
                {tD > 0 && <span className="text-base font-bold tabular-nums text-orange-400">{fmt(tD)} <span className="text-gray-600 text-xs font-normal">MMK</span></span>}
              </div>
              <div className="px-5 pb-5 grid grid-cols-2 gap-4">
                <GoldInput label={t(lang, "cashAmount")} value={form.diesel.cash} onChange={v => setForm(f => ({ ...f, diesel: { ...f.diesel, cash: v } }))} prefix="K" />
                <GoldInput label="Price / L" value={form.diesel.price} onChange={v => setForm(f => ({ ...f, diesel: { ...f.diesel, price: v } }))} prefix="K" />
              </div>
            </div>
          </div>
        </div>

        {/* Grand Total */}
        <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-5">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">{t(lang, "grandTotalLabel")}</p>
          <p className="text-3xl font-bold mt-1.5 text-white tabular-nums">{fmt(grandTotal)} <span className="text-base font-normal text-gray-500">MMK</span></p>
        </div>

        {/* Cash Summary */}
        <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-5 space-y-4">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest">Cash Summary</h3>

          {/* Expenses — itemized */}
          <div>
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">{t(lang, "operationalExpenses")}</p>
            <ExpensesPanel items={form.expenses} onChange={items => setForm(f => ({ ...f, expenses: items }))} lang={lang} />
          </div>

          {/* Pipa / JellyCan pre-paid notice */}
          {(tPipa > 0 || tJelly > 0) && (
            <div className="flex items-center justify-between bg-violet-500/10 border border-violet-500/20 rounded-xl px-4 py-2.5">
              <div>
                <p className="text-xs font-semibold text-violet-300">Pipa / Jelly Can</p>
                <p className="text-[10px] text-violet-400/60 mt-0.5">Pre-paid — not included in cash</p>
              </div>
              <span className="text-sm font-bold text-violet-300 tabular-nums">− {fmt(tPipa + tJelly)} MMK</span>
            </div>
          )}

          <div className="flex items-center justify-between bg-[#1c2433] rounded-xl px-4 py-2.5 border border-[#30363d]">
            <span className="text-xs font-semibold text-gray-400">{t(lang, "netExpected")}</span>
            <span className="text-sm font-bold text-white tabular-nums">{fmt(netExpected)} MMK</span>
          </div>
          <GoldInput label={t(lang, "actualCash")} value={form.actualCash} onChange={v => setForm(f => ({ ...f, actualCash: v }))} placeholder="0" prefix="K" />
          <div className={["flex items-center justify-between rounded-xl px-4 py-3 border",
            difference === 0 ? "bg-[#1c2433] border-[#30363d]" : difference > 0 ? "bg-emerald-500/10 border-emerald-500/30" : "bg-red-500/10 border-red-500/30"
          ].join(" ")}>
            <span className="text-xs font-bold uppercase tracking-wider text-gray-500">{t(lang, "difference")}</span>
            <span className={["text-base font-bold tabular-nums",
              difference === 0 ? "text-gray-400" : difference > 0 ? "text-emerald-400" : "text-red-400"
            ].join(" ")}>
              {form.actualCash ? fmtSigned(difference) : "—"}
            </span>
          </div>
        </div>

        <button type="submit"
          className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-2xl py-4 text-base transition-all active:scale-[0.98] mt-2">
          {t(lang, "reviewSubmit")}
        </button>
      </form>
    </div>
  );
}

// ─── Confirm screen ───────────────────────────────────────────────────────────
function ConfirmScreen({ employeeName, email, form, grandTotal, difference, onConfirm, onBack, submitting, lang }: {
  employeeName: string; email: string; form: FormData; grandTotal: number; difference: number;
  onConfirm: () => void; onBack: () => void; submitting: boolean; lang: Lang;
}) {
  const pumps92 = fuel92Pumps(form);
  const t92   = pumps92.reduce((s, p) => s + n(p.row.totalAmount), 0);
  const t95   = n(form.fuel95.totalAmount);
  const tPD   = n(form.premiumDiesel.totalAmount);
  const l92   = pumps92.reduce((s, p) => s + fuelRowLiters(p.row), 0);
  const l95   = n(form.fuel95.liters)        || (n(form.fuel95.price)        > 0 ? t95 / n(form.fuel95.price)        : 0);
  const lPD   = n(form.premiumDiesel.liters) || (n(form.premiumDiesel.price) > 0 ? tPD / n(form.premiumDiesel.price) : 0);
  const tPipa           = form.pipa.reduce((s, item) => s + n(item.containers) * n(item.price), 0);
  const tJelly          = form.jellyCan.reduce((s, item) => s + n(item.pieces) * n(item.price), 0);
  const tD              = n(form.diesel.cash);
  const totalDeductions = form.expenses.reduce((s, i) => s + (i.txnType !== "payment" ? n(i.amount) : 0), 0);
  const totalIncome     = form.expenses.reduce((s, i) => s + (i.txnType === "payment"  ? n(i.amount) : 0), 0);
  const totalExp        = totalDeductions;
  const actualCash      = n(form.actualCash);

  const rows = [
    // With the new pump open, each pump gets its own line (empty ones are hidden below).
    ...(pumps92.length > 1
      ? pumps92.map(p => ({
          label: `Fuel 92 · ${t(lang, p.key === "new" ? "newPump" : "normalPump")}`,
          liters: fuelRowLiters(p.row), price: p.row.price, total: n(p.row.totalAmount), color: "text-blue-400",
        }))
      : [{ label: "Fuel 92", liters: l92, price: form.fuel92.price, total: t92, color: "text-blue-400" }]),
    { label: "Fuel 95",        liters: l95,  price: form.fuel95.price,         total: t95,   color: "text-emerald-400" },
    { label: "Premium Diesel", liters: lPD,  price: form.premiumDiesel.price,  total: tPD,   color: "text-purple-400" },
  ];

  return (
    <div className="min-h-screen bg-[#0f111a]">
      <div className="sticky top-0 z-10 bg-[#0f111a]/95 backdrop-blur border-b border-[#30363d] px-4 py-3 flex items-center gap-3">
        <button onClick={onBack} className="text-gray-400 hover:text-white text-sm font-semibold flex items-center gap-1 transition-colors">← Back</button>
        <p className="text-sm font-bold text-white mx-auto">Review Submission</p>
        <div className="w-14" />
      </div>
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-5 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-600/20 flex items-center justify-center">
            <span className="text-lg font-bold text-blue-400">{employeeName[0].toUpperCase()}</span>
          </div>
          <div>
            <p className="font-bold text-white capitalize">{employeeName}</p>
            <p className="text-xs text-gray-500">{email} · {(form.shiftDate ? new Date(form.shiftDate) : new Date()).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
          </div>
        </div>

        <div className="bg-[#161b22] border border-[#30363d] rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[#30363d]"><h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest">Products</h3></div>
          <div className="divide-y divide-[#30363d]">
            {rows.map(r => r.total > 0 && (
              <div key={r.label} className="px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-white">{r.label}</p>
                  <p className="text-xs text-gray-400">{r.liters.toLocaleString("en-US", { maximumFractionDigits: 2 })} L · {fmt(n(r.price))} MMK/L</p>
                </div>
                <p className={`text-sm font-bold ${r.color}`}>{fmt(r.total)} MMK</p>
              </div>
            ))}
            {form.pipa.map((item, i) => {
              const containers = n(item.containers);
              const price = n(item.price);
              const total = containers * price;
              if (total <= 0) return null;
              return (
                <div key={`pipa-${i}`} className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-white">
                      Pipa · <span className="text-amber-400">{PIPA_PRODUCT_LABELS[item.product]}</span>
                    </p>
                    <p className="text-xs text-gray-400">
                      {containers} containers · {(containers * 215).toLocaleString()} L · {fmt(price)} MMK/pipa
                    </p>
                  </div>
                  <p className="text-sm font-bold text-amber-400">{fmt(total)} MMK</p>
                </div>
              );
            })}
            {form.jellyCan.map((item, i) => {
              const pieces = n(item.pieces);
              const litersPerCan = n(item.liters);
              const price = n(item.price);
              const total = pieces * price;
              const totalLiters = pieces * litersPerCan;
              if (total <= 0) return null;
              return (
                <div key={`jelly-${i}`} className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-white">
                      Jelly Can · <span className="text-teal-400">{PIPA_PRODUCT_LABELS[item.product]}</span>
                    </p>
                    <p className="text-xs text-gray-400">
                      {pieces} cans · {litersPerCan} L/can · {totalLiters.toLocaleString("en-US", { maximumFractionDigits: 2 })} L total · {fmt(price)} MMK/can
                    </p>
                  </div>
                  <p className="text-sm font-bold text-teal-400">{fmt(total)} MMK</p>
                </div>
              );
            })}
            {tD > 0 && (
              <div className="px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-white">Diesel</p>
                  <p className="text-xs text-gray-400">Cash only · {fmt(n(form.diesel.price))} MMK/L</p>
                </div>
                <p className="text-sm font-bold text-orange-400">{fmt(tD)} MMK</p>
              </div>
            )}
          </div>
        </div>

        {/* Expenses breakdown */}
        {form.expenses.length > 0 && (
          <div className="bg-[#161b22] border border-[#30363d] rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-[#30363d]"><h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest">Expenses</h3></div>
            <div className="divide-y divide-[#30363d]">
              {form.expenses.map((exp, idx) => (
                <div key={idx} className="px-4 py-3 flex justify-between text-sm">
                  <span className="text-gray-400">{exp.name}</span>
                  <span className={`font-semibold ${exp.txnType === "payment" ? "text-emerald-400" : "text-red-400"}`}>
                    {exp.txnType === "payment" ? "+" : "−"}{fmt(n(exp.amount))} MMK
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="bg-[#161b22] border border-[#30363d] rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[#30363d]"><h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest">Cash Summary</h3></div>
          <div className="divide-y divide-[#30363d]">
            <div className="px-4 py-3 flex justify-between text-sm"><span className="text-gray-500">{t(lang, "grandTotalShort")}</span><span className="font-bold text-white tabular-nums">{fmt(grandTotal)} MMK</span></div>
            {totalIncome > 0 && (
              <div className="px-4 py-3 flex justify-between text-sm"><span className="text-gray-500">+ Payment Income</span><span className="font-semibold text-emerald-400 tabular-nums">+{fmt(totalIncome)} MMK</span></div>
            )}
            {totalDeductions > 0 && (
              <div className="px-4 py-3 flex justify-between text-sm"><span className="text-gray-500">− Other Costs</span><span className="font-semibold text-red-400 tabular-nums">−{fmt(totalDeductions)} MMK</span></div>
            )}
            <div className="px-4 py-3 flex justify-between text-sm"><span className="text-gray-500">{t(lang, "netExpected")}</span><span className="font-bold text-white tabular-nums">{fmt(grandTotal - tPipa - tJelly - totalDeductions + totalIncome)} MMK</span></div>
            <div className="px-4 py-3 flex justify-between text-sm"><span className="text-gray-500">{t(lang, "actualCollected")}</span><span className="font-bold text-white tabular-nums">{fmt(actualCash)} MMK</span></div>
            <div className={["px-4 py-3 flex justify-between text-sm font-bold", difference === 0 ? "bg-[#1c2433]" : difference > 0 ? "bg-emerald-500/10" : "bg-red-500/10"].join(" ")}>
              <span className={difference === 0 ? "text-gray-400" : difference > 0 ? "text-emerald-400" : "text-red-400"}>{t(lang, "difference")}</span>
              <span className={["text-base tabular-nums", difference === 0 ? "text-gray-400" : difference > 0 ? "text-emerald-400" : "text-red-400"].join(" ")}>{fmtSigned(difference)}</span>
            </div>
          </div>
        </div>

        <button onClick={onConfirm} disabled={submitting}
          className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white font-bold rounded-2xl py-4 text-base transition-all active:scale-[0.98]">
          {submitting ? "Submitting…" : "✓ Confirm & Submit"}
        </button>
      </div>
    </div>
  );
}

// ─── Success screen ───────────────────────────────────────────────────────────
function SuccessScreen({ employeeName, onNewShift, queuedItemId, lang }: { employeeName: string; onNewShift: () => void; queuedItemId: string | null; lang: Lang }) {
  const status = useQueueItemStatus(queuedItemId);
  return (
    <div className="min-h-screen bg-[#0f111a] flex flex-col items-center justify-center px-4 text-center">
      <div className="success-ring w-28 h-28 rounded-full bg-blue-600/20 border-2 border-blue-500/30 flex items-center justify-center mb-6">
        <svg className="w-14 h-14 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h1 className="text-3xl font-bold text-white mb-2">Shift Report Submitted</h1>
      <p className="text-sm text-gray-400 mb-4 capitalize">Saved for <strong className="text-white">{employeeName}</strong>.</p>
      {status && (
        <div className="mb-8">
          {status === "synced" ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-bold rounded-full px-3 py-1.5 bg-emerald-500/15 text-emerald-400">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              {t(lang, "syncedLabel")}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs font-bold rounded-full px-3 py-1.5 bg-amber-500/15 text-amber-400">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2M12 2a10 10 0 100 20A10 10 0 0012 2z" />
              </svg>
              {t(lang, "pendingSyncLabel")} — saved on this device
            </span>
          )}
        </div>
      )}
      <div className="space-y-3 w-full max-w-xs">
        <button onClick={onNewShift}
          className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-2xl py-4 text-base transition-all active:scale-[0.98]">
          Submit Another Shift
        </button>
        <p className="text-xs text-gray-400">STM Daily · {new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</p>
      </div>
    </div>
  );
}

// ─── App Config (localStorage) ────────────────────────────────────────────────
const CONFIG_KEY = "stm_app_config";
interface AppConfig { price92: string; pricePD: string; price95: string; priceHSD: string; }
const DEFAULT_CONFIG: AppConfig = { price92: "1200", pricePD: "1400", price95: "1350", priceHSD: "1100" };
function loadConfig(): AppConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch { return { ...DEFAULT_CONFIG }; }
}
function saveConfig(cfg: AppConfig) { localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg)); }

// ─── Mode Select Screen ───────────────────────────────────────────────────────
function ModeSelectScreen({ employeeName, onShift, onChat, unread, onSettings, onLogout, lang, setLang }: {
  employeeName: string; onShift: () => void; onChat: () => void; unread: number;
  onSettings: () => void; onLogout: () => void; lang: Lang; setLang: (l: Lang) => void;
}) {
  return (
    <div className="min-h-screen bg-[#0f111a] flex flex-col">
      <div className="sticky top-0 z-10 bg-[#0f111a]/95 backdrop-blur border-b border-[#30363d] px-4 py-3 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-blue-600/20 flex items-center justify-center shrink-0">
          <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2M12 2a10 10 0 100 20A10 10 0 0012 2z" />
          </svg>
        </div>
        <div>
          <p className="text-xs text-gray-500 font-semibold uppercase tracking-widest">STM Daily</p>
          <p className="text-sm font-bold text-white capitalize">{employeeName}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <LangToggle lang={lang} setLang={setLang} />
          <button type="button" onClick={onSettings}
            className="w-8 h-8 flex items-center justify-center rounded-xl bg-[#161b22] border border-[#30363d] hover:border-gray-500 text-gray-400 hover:text-white transition-colors"
            title="App Settings" aria-label="Open app settings">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
          <button type="button" onClick={onLogout}
            className="text-xs text-gray-500 hover:text-white font-semibold border border-[#30363d] hover:border-gray-500 rounded-lg px-2.5 py-1 transition-colors">
            Switch User
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 gap-5 max-w-sm mx-auto w-full">
        <div className="text-center mb-2">
          <h1 className="text-3xl font-bold text-white">Select Mode</h1>
          <p className="text-sm text-gray-500 mt-1">What would you like to do?</p>
        </div>

        <button type="button" onClick={onShift}
          className="w-full bg-[#161b22] border-2 border-[#30363d] hover:border-blue-500/60 hover:bg-blue-600/5 rounded-2xl p-6 text-left transition-all active:scale-[0.98] group">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-blue-600/20 flex items-center justify-center shrink-0 group-hover:bg-blue-600/30 transition-colors">
              <svg className="w-6 h-6 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>
              <p className="text-base font-bold text-white">Daily Shift Submission</p>
              <p className="text-sm text-gray-500 mt-0.5">Record end-of-shift meter readings, fuel sales &amp; expenses</p>
            </div>
          </div>
          <div className="mt-4 flex items-center text-xs font-semibold text-blue-400">
            Open form
            <svg className="w-4 h-4 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
          </div>
        </button>

        <button type="button" onClick={onChat}
          aria-label={unread > 0 ? `${CHAT_STRINGS.title[lang]}, ${unread} new` : CHAT_STRINGS.title[lang]}
          className="w-full bg-[#161b22] border-2 border-[#30363d] hover:border-emerald-500/60 hover:bg-emerald-600/5 rounded-2xl p-6 text-left transition-all active:scale-[0.98] group">
          <div className="flex items-start gap-4">
            <div className="relative w-12 h-12 rounded-xl bg-emerald-600/20 flex items-center justify-center shrink-0 group-hover:bg-emerald-600/30 transition-colors">
              <svg className="w-6 h-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h8M8 14h5M21 12a8.5 8.5 0 01-12.4 7.6L3 21l1.4-5.6A8.5 8.5 0 1121 12z" />
              </svg>
              {unread > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full bg-red-500 text-white text-[11px] font-bold flex items-center justify-center">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </div>
            <div>
              <p className="text-base font-bold text-white">{CHAT_STRINGS.title[lang]}</p>
              <p className="text-sm text-gray-500 mt-0.5">Message the team and the CEO, and share photos</p>
            </div>
          </div>
          <div className="mt-4 flex items-center text-xs font-semibold text-emerald-400">
            {unread > 0 ? `${unread > 99 ? "99+" : unread} new message${unread === 1 ? "" : "s"}` : "Open chat"}
            <svg className="w-4 h-4 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
          </div>
        </button>

      </div>
    </div>
  );
}

// ─── App Settings Screen ───────────────────────────────────────────────────────
const SETTINGS_FIELD_CLS = "w-full bg-[#0d1117] border border-[#30363d] rounded-xl px-4 py-3 text-sm font-medium text-white focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all placeholder:text-gray-700";
const SETTINGS_LABEL_CLS = "block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5";

// Hoisted to module scope so it keeps a stable component identity across
// re-renders — defining it inside AppSettingsScreen made React remount the
// <input> (and drop focus) on every keystroke, so only one digit could be
// typed before you had to click back into the field.
function PriceField({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (val: string) => void; placeholder: string;
}) {
  return (
    <div>
      <label className={SETTINGS_LABEL_CLS}>{label}</label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600 text-sm font-semibold select-none">K</span>
        <input type="number" value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder} className={"pl-8 " + SETTINGS_FIELD_CLS} />
      </div>
    </div>
  );
}

function AppSettingsScreen({ onBack }: { onBack: () => void }) {
  const [cfg, setCfg] = useState<AppConfig>(loadConfig);
  const [saved, setSaved] = useState(false);

  function handleSave() { saveConfig(cfg); setSaved(true); setTimeout(() => setSaved(false), 2000); }

  function setField(field: keyof AppConfig, value: string) {
    setCfg(c => ({ ...c, [field]: value }));
  }

  return (
    <div className="min-h-screen bg-[#0f111a]">
      <div className="sticky top-0 z-10 bg-[#0f111a]/95 backdrop-blur border-b border-[#30363d] px-4 py-3 flex items-center">
        <button onClick={onBack} className="text-gray-400 hover:text-white text-sm font-semibold flex items-center gap-1 transition-colors">← Back</button>
        <p className="text-sm font-bold text-white mx-auto">App Settings</p>
        <div className="w-14" />
      </div>
      <div className="max-w-sm mx-auto px-4 py-8 space-y-5">
        <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-5 space-y-4">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">Default Prices Per Liter (MMK)</p>
          <PriceField label="Fuel 92" value={cfg.price92} onChange={v => setField("price92", v)} placeholder="1200" />
          <PriceField label="Premium Diesel" value={cfg.pricePD} onChange={v => setField("pricePD", v)} placeholder="1400" />
          <PriceField label="Fuel 95" value={cfg.price95} onChange={v => setField("price95", v)} placeholder="1350" />
          <PriceField label="Diesel" value={cfg.priceHSD} onChange={v => setField("priceHSD", v)} placeholder="1100" />
          <p className="text-xs text-gray-600">Auto-filled in the shift form per product</p>
        </div>
        <button type="button" onClick={handleSave}
          className={`w-full font-bold rounded-2xl py-4 text-base transition-all active:scale-[0.98] ${saved ? "bg-emerald-600 text-white" : "bg-blue-600 hover:bg-blue-500 text-white"}`}>
          {saved ? "✓ Saved!" : "Save Changes"}
        </button>
      </div>
    </div>
  );
}

// ─── Sync status banner ─────────────────────────────────────────────────────
const OfflineIcon = () => (
  <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8.5 16.5a5 5 0 017 0M5 12.5a10 10 0 0114 0M2 8.5a15 15 0 0120 0" />
    <circle cx="12" cy="20" r="1" fill="currentColor" stroke="none" />
    <path strokeLinecap="round" d="M2 2l20 20" />
  </svg>
);
const SyncingIcon = () => (
  <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2M12 2a10 10 0 100 20A10 10 0 0012 2z" />
  </svg>
);
const SyncedIcon = () => (
  <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
);

function SyncStatusBanner({ isOnline, pendingCount, justSynced, lang }: { isOnline: boolean; pendingCount: number; justSynced: boolean; lang: Lang }) {
  if (isOnline && pendingCount === 0 && !justSynced) return null;

  let icon: React.ReactNode;
  let label: string;
  let className: string;
  if (!isOnline) {
    icon = <OfflineIcon />;
    label = pendingCount > 0
      ? `${t(lang, "offlineLabel")} — ${pendingCount} shift${pendingCount === 1 ? "" : "s"} saved, will sync automatically`
      : t(lang, "offlineLabel");
    className = "bg-amber-500/15 text-amber-400 border border-amber-500/30";
  } else if (pendingCount > 0) {
    icon = <SyncingIcon />;
    label = `${t(lang, "pendingSyncLabel")} — ${pendingCount} shift${pendingCount === 1 ? "" : "s"}`;
    className = "bg-blue-500/15 text-blue-400 border border-blue-500/30";
  } else {
    icon = <SyncedIcon />;
    label = t(lang, "syncedLabel");
    className = "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30";
  }

  return (
    <div className="fixed bottom-20 inset-x-0 z-40 flex justify-center px-4 pointer-events-none">
      <div className={`flex items-center gap-1.5 text-xs font-bold rounded-full px-3.5 py-1.5 shadow-lg max-w-full pointer-events-auto ${className}`}>
        {icon}
        <span className="truncate">{label}</span>
      </div>
    </div>
  );
}

// ─── Session persistence ──────────────────────────────────────────────────────
const SESSION_KEY = "stm_daily_session";
const SESSION_DAYS = 30;

function saveSession(name: string, mail: string) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    name, mail,
    expires: Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000,
  }));
}

function loadSession(): { name: string; mail: string } | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const { name, mail, expires } = JSON.parse(raw);
    if (!name || !mail || Date.now() > expires) { localStorage.removeItem(SESSION_KEY); return null; }
    return { name, mail };
  } catch { return null; }
}

function clearSession() { localStorage.removeItem(SESSION_KEY); }

// ─── Root App ─────────────────────────────────────────────────────────────────
export default function App() {
  // The signed-in staff member, read from this device's saved sign-in, so the
  // app still opens offline (shifts are queued and sent later, as before).
  const [staff, setStaff] = useState<{ id: string; email: string } | null>(() => storedStaffUser());
  const [screen, setScreen] = useState<Screen>(() => (storedStaffUser() ? "mode-select" : "login"));
  const [employeeName, setEmployeeName] = useState(() => {
    const u = storedStaffUser();
    if (!u) return "";
    const saved = loadSession();
    return saved?.mail === u.email ? saved.name : u.email.split("@")[0];
  });
  const [email, setEmail] = useState(() => storedStaffUser()?.email ?? "");
  const [formData, setFormData] = useState<FormData>(EMPTY);
  const [grandTotal, setGrandTotal] = useState(0);
  const [difference, setDifference] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [lastQueuedId, setLastQueuedId] = useState<string | null>(null);
  const confirmingRef = useRef(false);
  const { isOnline, pendingCount, justSynced } = useOfflineSync();
  const [lang, setLang] = useState<Lang>(() => {
    const saved = localStorage.getItem(LANG_KEY);
    return (saved === "my" ? "my" : "en") as Lang;
  });

  const unread = useChatUnread(authClient, staff?.id ?? null, screen === "mode-select");

  async function signOutStaff() {
    await authClient.auth.signOut({ scope: "local" }).catch(() => {});
    // Offline, signOut can't reach the server and leaves the saved sign-in; drop it anyway.
    try { localStorage.removeItem(AUTH_STORAGE_KEY); } catch { /* storage blocked */ }
    setStaff(null);
  }

  useEffect(() => {
    // Email-only sign-ins from before passwords don't count any more.
    if (!storedStaffUser()) clearSession();

    // A password reset or revoked sign-in signs this device out.
    const { data: { subscription } } = authClient.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") setStaff(null);
      else if (session?.user?.email) setStaff({ id: session.user.id, email: session.user.email.toLowerCase() });
    });

    // Opened with a saved sign-in: still on the STM Daily list, and still the same login?
    const u = storedStaffUser();
    if (u && navigator.onLine) {
      staffAuth<{ state: StaffLoginState }>({ action: "status", email: u.email })
        .then(({ state }) => {
          if (state === "not_allowed") { signOutStaff(); setEmail(u.email); setScreen("denied"); }
          else if (state === "needs_password") signOutStaff();   // their password was reset
        })
        .catch(() => { /* offline or a server hiccup: carry on */ });
    }
    return () => subscription.unsubscribe();
  }, []);

  // Signed out on a screen that needs the sign-in → back to sign-in. A shift
  // being filled in is left alone (it doesn't need the sign-in) until they leave it.
  useEffect(() => {
    if (!staff && (screen === "mode-select" || screen === "chat" || screen === "settings")) {
      clearSession();
      setEmployeeName("");
      setEmail("");
      setScreen("login");
    }
  }, [staff, screen]);

  function handleSignedIn(mail: string, userId: string) {
    const name = mail.split("@")[0];
    saveSession(name, mail);
    setStaff({ id: userId, email: mail });
    setEmployeeName(name);
    setEmail(mail);
    setScreen("mode-select");
  }

  function handleLogout() {
    signOutStaff();
    clearSession();
    setEmployeeName("");
    setEmail("");
    setFormData(EMPTY);
    setGrandTotal(0);
    setDifference(0);
    setScreen("login");
  }

  function handleFormSubmit(data: FormData, gt: number, diff: number) {
    setFormData(data);
    setGrandTotal(gt);
    setDifference(diff);
    setScreen("confirm");
  }

  async function handleConfirm() {
    if (confirmingRef.current) return; // guard against double-tap before React re-renders the disabled button
    confirmingRef.current = true;
    setSubmitting(true);
    setSubmitError("");

    // Fuel 92 is saved combined (what the CEO portal, FIFO profit and alerts read),
    // with the per-pump split alongside whenever the new pump was used.
    const pumps92 = fuel92Pumps(formData)
      .map(p => ({ pump: p.key, liters: fuelRowLiters(p.row), price: n(p.row.price), total: n(p.row.totalAmount) }))
      .filter(p => p.total > 0 || p.liters > 0);
    const t92   = pumps92.reduce((s, p) => s + p.total, 0);
    const l92   = pumps92.reduce((s, p) => s + p.liters, 0);
    const usedNewPump = pumps92.some(p => p.pump === "new");
    // One pump: its own price, exactly as before. Two pumps: the litre-weighted price, so litres × price = total.
    const p92   = usedNewPump && l92 > 0 ? Math.round((t92 / l92) * 100) / 100 : n(formData.fuel92.price);
    const t95   = n(formData.fuel95.totalAmount);
    const tPD   = n(formData.premiumDiesel.totalAmount);
    const l95   = n(formData.fuel95.liters)   > 0 ? n(formData.fuel95.liters)   : (n(formData.fuel95.price)   > 0 ? t95 / n(formData.fuel95.price)   : 0);
    const lPD   = n(formData.premiumDiesel.liters) > 0 ? n(formData.premiumDiesel.liters) : (n(formData.premiumDiesel.price) > 0 ? tPD / n(formData.premiumDiesel.price) : 0);
    const pipaItems = formData.pipa.map(item => ({
      product: item.product,
      containers: n(item.containers),
      price: n(item.price),
      total: n(item.containers) * n(item.price),
    })).filter(item => item.containers > 0 || item.price > 0);
    const tPipa = pipaItems.reduce((s, item) => s + item.total, 0);
    const totalPipaContainers = pipaItems.reduce((s, item) => s + item.containers, 0);

    const jellyCanItems = formData.jellyCan.map(item => ({
      product: item.product,
      pieces: n(item.pieces),
      liters_per_can: n(item.liters),
      total_liters: n(item.pieces) * n(item.liters),
      price: n(item.price),
      total: n(item.pieces) * n(item.price),
    })).filter(item => item.pieces > 0 || item.price > 0);

    const tJelly = jellyCanItems.reduce((s, item) => s + item.total, 0);

    const totalDeductions = formData.expenses.reduce((s, i) => s + (i.txnType !== "payment" ? n(i.amount) : 0), 0);
    const totalIncome     = formData.expenses.reduce((s, i) => s + (i.txnType === "payment"  ? n(i.amount) : 0), 0);
    const totalExp        = totalDeductions - totalIncome; // net effect on expected cash
    const actualCash      = n(formData.actualCash);
    // Pipa and JellyCan are pre-paid — exclude from expected cash total
    const cashGrandTotal  = t92 + t95 + tPD + n(formData.diesel.cash);

    const payload: ShiftPayload = {
      employee_name: employeeName,
      employee_id: email,
      timestamp: formData.shiftDate ? new Date(formData.shiftDate).toISOString() : new Date().toISOString(),
      fuel_data: {
        fuel_92_liters:        l92,
        fuel_92_price:         p92,
        fuel_92_total:         t92,
        ...(usedNewPump ? { fuel_92_pumps: pumps92 } : {}),
        fuel_95_liters:        l95,
        fuel_95_price:         n(formData.fuel95.price),
        fuel_95_total:         t95,
        premium_diesel_liters: lPD,
        premium_diesel_price:  n(formData.premiumDiesel.price),
        premium_diesel_total:  tPD,
        pipa_amount:           totalPipaContainers,
        pipa_price:            pipaItems.length === 1 ? pipaItems[0].price : 0,
        pipa_total:            tPipa,
        pipa_items:            pipaItems,
        jelly_can_items:       jellyCanItems,
        diesel_cash:           n(formData.diesel.cash),
        diesel_price:          n(formData.diesel.price),
      },
      total_expenses:  totalExp,
      expenses_breakdown: formData.expenses
        .map(e => ({ name: e.name.trim(), amount: n(e.amount) }))
        .filter(e => e.name.length > 0 || e.amount > 0),
      expected_total:  cashGrandTotal - totalExp,
      actual_cash:     actualCash,
      variance:        difference,
    };

    // Push debt transactions for any linked expenses.
    // IMPORTANT: use formData.shiftDate directly (a datetime-local string like
    // "2024-01-15T14:30") so the local date/time is preserved.
    // Never call .toISOString() here — it converts to UTC and shifts the date
    // for users in UTC+ timezones (e.g. Myanmar +6:30).
    const linkedExpensesRaw = formData.expenses.filter(e => e.profileId && n(e.amount) > 0);

    // Local date string "YYYY-MM-DD" — sliced directly, no UTC conversion.
    const localDateStr = formData.shiftDate
      ? formData.shiftDate.slice(0, 10)
      : new Date().toISOString().slice(0, 10);

    // Full local datetime with browser timezone offset appended so Postgres
    // stores the correct UTC instant for timestamptz columns.
    function localISOWithTZ(dtLocal: string): string {
      const off = -new Date().getTimezoneOffset(); // minutes ahead of UTC
      const sign = off >= 0 ? "+" : "-";
      const hh = String(Math.floor(Math.abs(off) / 60)).padStart(2, "0");
      const mm = String(Math.abs(off) % 60).padStart(2, "0");
      // dtLocal is "YYYY-MM-DDTHH:MM" — add seconds + offset
      return `${dtLocal}:00${sign}${hh}:${mm}`;
    }
    const localDateTimeStr = formData.shiftDate
      ? localISOWithTZ(formData.shiftDate)
      : new Date().toISOString();

    const linkedExpenses: LinkedExpensePayload[] = linkedExpensesRaw.map(expense => {
      const d = localDateStr.replace(/-/g, "");
      return {
        profileId: expense.profileId!,
        amount: n(expense.amount),
        txnType: expense.txnType === "payment" ? "payment" : "debt",
        txnNumber: `TXN-${d}-${Math.floor(Math.random() * 90000) + 10000}`,
        localDateTimeStr,
        employeeName,
      };
    });

    let queuedId: string;
    try {
      const item = enqueueShift(payload, linkedExpenses);
      queuedId = item.id;
    } catch {
      // localStorage unavailable (quota exceeded / disabled) — fall back to a
      // direct submit attempt so the shift isn't silently dropped.
      const { error } = await submitShift(payload);
      confirmingRef.current = false;
      setSubmitting(false);
      if (error) { setSubmitError(error.message); return; }
      setLastQueuedId(null);
      setScreen("success");
      return;
    }

    // Data is safely saved locally — advance immediately and sync in the background.
    flushQueue();
    confirmingRef.current = false;
    setSubmitting(false);
    setLastQueuedId(queuedId);
    setScreen("success");
  }

  function handleNewShift() {
    setFormData(EMPTY);
    setGrandTotal(0);
    setDifference(0);
    setLastQueuedId(null);
    setScreen("mode-select");
  }

  return (
    <>
      {screen === "login"       && (
        <LoginScreen
          onSignedIn={handleSignedIn}
          onDenied={mail => { setEmail(mail); setScreen("denied"); }}
          lang={lang} setLang={setLang}
        />
      )}
      {screen === "checking"    && <CheckingScreen />}
      {screen === "denied"      && <DeniedScreen email={email} onBack={() => setScreen("login")} />}
      {screen === "mode-select" && (
        <ModeSelectScreen
          employeeName={employeeName}
          onShift={() => setScreen("form")}
          onChat={() => setScreen("chat")}
          unread={unread}
          onSettings={() => setScreen("settings")}
          onLogout={handleLogout}
          lang={lang} setLang={setLang}
        />
      )}
      {screen === "form"     && (
        <ShiftForm
          employeeName={employeeName}
          onSubmit={handleFormSubmit}
          onLogout={handleLogout}
          onBack={() => setScreen("mode-select")}
          lang={lang} setLang={setLang}
          initialData={formData.shiftDate ? formData : undefined}
        />
      )}
      {screen === "confirm"  && (
        <>
          <ConfirmScreen
            employeeName={employeeName} email={email} form={formData}
            grandTotal={grandTotal} difference={difference}
            onConfirm={handleConfirm} onBack={() => setScreen("form")} submitting={submitting} lang={lang}
          />
          {submitError && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-red-600 text-white text-sm font-semibold rounded-xl px-5 py-3 shadow-xl z-50">
              {submitError}
            </div>
          )}
        </>
      )}
      {screen === "success"  && <SuccessScreen employeeName={employeeName} onNewShift={handleNewShift} queuedItemId={lastQueuedId} lang={lang} />}
      {screen === "settings" && <AppSettingsScreen onBack={() => setScreen("mode-select")} />}
      {screen === "chat" && staff && (
        <div className="h-[100dvh]">
          <TeamChat
            client={authClient}
            me={{ id: staff.id, email: staff.email, role: "staff" }}
            theme="dark"
            lang={lang}
            onBack={() => setScreen("mode-select")}
          />
        </div>
      )}

      <SyncStatusBanner isOnline={isOnline} pendingCount={pendingCount} justSynced={justSynced} lang={lang} />
    </>
  );
}
