import { useState, useCallback, useEffect } from "react";
import { submitShift, type ShiftPayload, supabase } from "./lib/supabase";
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
type Screen = "login" | "checking" | "denied" | "form" | "confirm" | "success";

interface FuelRow { totalAmount: string; price: string; }
interface DieselRow { cash: string; price: string; }
interface ExpenseItem { name: string; amount: string; }
type PipaProduct = "92" | "95" | "PD" | "D";
interface PipaItem { product: PipaProduct; containers: string; price: string; }
interface FormData {
  fuel92: FuelRow;
  fuel95: FuelRow;
  premiumDiesel: FuelRow;
  pipa: PipaItem[];
  diesel: DieselRow;
  expenses: ExpenseItem[];
  actualCash: string;
}

const PIPA_PRODUCT_LABELS: Record<PipaProduct, string> = {
  "92": "Fuel 92", "95": "Fuel 95", "PD": "Premium Diesel", "D": "Diesel",
};

// ─── Language / i18n ──────────────────────────────────────────────────────────
type Lang = "en" | "my";

const STRINGS = {
  signInTitle:          { en: "Sign in to continue",       my: "အကောင့်ဝင်ပါ။" },
  workEmail:            { en: "Work Email",                 my: "အကောင့်အီးမေးထည့်ပါ" },
  fuelProducts:         { en: "Fuel Products",             my: "ဆီ အမျိုးအစား" },
  totalAmount:          { en: "Total Amount",              my: "ရောင်းရငွေ" },
  literPrice:           { en: "Liter Price",               my: "လီတာစျေးနှုန်း" },
  literSold:            { en: "Liters Sold",               my: "ရောင်းရလီတာ" },
  pipa:                 { en: "Pipa",                      my: "ပီပါ" },
  addPipaEntry:         { en: "Add Pipa Entry",            my: "ပီပါထည့်ရန်" },
  cashAmount:           { en: "Cash Amount",               my: "ငွေပမာဏ" },
  grandTotalLabel:      { en: "Grand Total (All Products)", my: "စုစုပေါင်းငွေပမာဏ" },
  operationalExpenses:  { en: "Operational Expenses",      my: "ထွက်ငွေ" },
  expenseName:          { en: "Expense Name",              my: "အကြောင်းအရာ" },
  amount:               { en: "Amount",                    my: "ပမာဏ" },
  actualCash:           { en: "Actual Cash Collected",     my: "ငွေသားပမာဏ" },
  difference:           { en: "Difference",                my: "ကွာခြားချက်" },
  reviewSubmit:         { en: "Review & Submit →",         my: "ပေးပို့မည် →" },
  totalExpenses:        { en: "Total Expenses",            my: "စုစုပေါင်း ထွက်ငွေ" },
  netExpected:          { en: "Net Expected",              my: "ရှိရမည့်ငွေ" },
  grandTotalShort:      { en: "Grand Total",               my: "စုစုပေါင်းငွေပမာဏ" },
  actualCollected:      { en: "Actual Collected",          my: "ငွေသားပမာဏ" },
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
      className="flex items-center gap-1 bg-amber-100 hover:bg-amber-200 border border-amber-200 rounded-lg px-2 py-1 transition-colors"
    >
      <span className={`text-[11px] font-bold ${lang === "en" ? "text-amber-800" : "text-amber-400"}`}>EN</span>
      <span className="text-amber-300 text-[10px]">|</span>
      <span className={`text-[11px] font-bold ${lang === "my" ? "text-amber-800" : "text-amber-400"}`}>မြ</span>
    </button>
  );
}

const EMPTY: FormData = {
  fuel92:        { totalAmount: "", price: "" },
  fuel95:        { totalAmount: "", price: "" },
  premiumDiesel: { totalAmount: "", price: "" },
  pipa:          [],
  diesel:        { cash: "", price: "" },
  expenses:      [],
  actualCash:    "",
};

// ─── Input component ─────────────────────────────────────────────────────────
function GoldInput({
  label, value, onChange, placeholder = "0", readOnly = false, prefix
}: {
  label: string; value: string; onChange?: (v: string) => void;
  placeholder?: string; readOnly?: boolean; prefix?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold text-amber-800/70 uppercase tracking-wider">{label}</label>
      <div className="relative">
        {prefix && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-amber-600 text-sm font-medium select-none">{prefix}</span>
        )}
        <input
          type="number"
          value={value}
          onChange={e => onChange?.(e.target.value)}
          placeholder={placeholder}
          readOnly={readOnly}
          className={[
            "w-full rounded-xl border px-3 py-2.5 text-sm font-medium outline-none transition-all",
            prefix ? "pl-8" : "",
            readOnly
              ? "bg-amber-50 border-amber-200 text-amber-700 cursor-default"
              : "bg-white border-amber-200 text-gray-900 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 placeholder:text-gray-300",
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
    <div className="bg-white rounded-2xl border border-amber-100 shadow-sm overflow-hidden">
      <div className="px-4 py-2.5 flex items-center gap-2 bg-gradient-to-r from-amber-500 to-yellow-600">
        <span className="text-xs font-bold text-white/90 uppercase tracking-widest">{t(lang, "pipa")}</span>
        <span className="ml-auto text-[10px] text-white/70">1 {t(lang, "pipa")} = 215 L</span>
      </div>

      {items.length === 0 && (
        <p className="text-xs text-amber-400/70 text-center py-4">No {t(lang, "pipa")} entries — tap + to add one</p>
      )}

      {items.map((item, i) => {
        const containers = n(item.containers);
        const price = n(item.price);
        const total = containers * price;
        return (
          <div key={i} className="px-4 pt-4 pb-3 border-b border-amber-50 last:border-0">
            <div className="flex items-center gap-2 mb-2">
              <span className={`text-[10px] font-bold text-white rounded px-1.5 py-0.5 ${PIPA_COLORS[item.product]}`}>
                {item.product}
              </span>
              <span className="text-xs font-semibold text-gray-600">Entry {i + 1}</span>
              <button
                type="button"
                onClick={() => remove(i)}
                className="ml-auto text-red-400 hover:text-red-600 transition-colors p-0.5"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {/* Product dropdown */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-amber-800/70 uppercase tracking-wider">Product</label>
                <select
                  value={item.product}
                  onChange={e => update(i, "product", e.target.value as PipaProduct)}
                  className="w-full rounded-xl border px-3 py-2.5 text-sm font-medium outline-none transition-all bg-white border-amber-200 text-gray-900 focus:border-amber-500 focus:ring-2 focus:ring-amber-200"
                >
                  <option value="92">Fuel 92</option>
                  <option value="95">Fuel 95</option>
                  <option value="PD">Premium Diesel</option>
                  <option value="D">Diesel</option>
                </select>
              </div>
              {/* Containers */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-amber-800/70 uppercase tracking-wider">Containers</label>
                <input
                  type="number"
                  value={item.containers}
                  onChange={e => update(i, "containers", e.target.value)}
                  placeholder="0"
                  className="w-full rounded-xl border px-3 py-2.5 text-sm font-medium outline-none transition-all bg-white border-amber-200 text-gray-900 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 placeholder:text-gray-300"
                />
                {containers > 0 && (
                  <p className="text-[10px] text-amber-500 font-semibold">{(containers * 215).toLocaleString()} L</p>
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
              <p className="text-xs text-amber-700 font-semibold text-right mt-2">{fmt(total)} MMK</p>
            )}
          </div>
        );
      })}

      <div className="px-4 py-3 flex items-center justify-between">
        <button
          type="button"
          onClick={add}
          className="flex items-center gap-1.5 text-xs font-bold text-amber-600 hover:text-amber-800 border border-amber-200 hover:border-amber-400 rounded-xl px-3 py-1.5 transition-all"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          {t(lang, "addPipaEntry")}
        </button>
        {items.length > 0 && (
          <span className="text-xs font-bold text-amber-700">
            Total: {fmt(items.reduce((s, item) => s + n(item.containers) * n(item.price), 0))} MMK
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Product card — enter Total Amount + Liter Price → auto-calculates liters ─
function ProductCard({ label, badge, color, totalAmount, price, total, liters, onTotalAmount, onPrice, lang }: {
  label: string; badge: string; color: string;
  totalAmount: string; price: string; total: number; liters: number;
  onTotalAmount: (v: string) => void; onPrice: (v: string) => void;
  lang: Lang;
}) {
  return (
    <div className="bg-white rounded-2xl border border-amber-100 shadow-sm overflow-hidden">
      <div className={`px-4 py-2.5 flex items-center gap-2 ${color}`}>
        <span className="text-xs font-bold text-white/90 uppercase tracking-widest">{label}</span>
        <span className="ml-auto text-xs font-bold bg-white/20 text-white rounded-full px-2 py-0.5">{badge}</span>
      </div>
      <div className="p-4 grid grid-cols-3 gap-3">
        <GoldInput label={t(lang, "totalAmount")} value={totalAmount} onChange={onTotalAmount} prefix="K" />
        <GoldInput label={t(lang, "literPrice")} value={price} onChange={onPrice} prefix="K" />
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-amber-800/70 uppercase tracking-wider">{t(lang, "literSold")}</label>
          <div className="relative">
            <input
              type="text"
              value={liters > 0 ? liters.toLocaleString("en-US", { maximumFractionDigits: 2 }) : ""}
              placeholder="Auto"
              readOnly
              className="w-full rounded-xl border px-3 py-2.5 text-sm font-medium outline-none bg-amber-50 border-amber-200 text-amber-700 cursor-default"
            />
          </div>
          {liters > 0 && <p className="text-[10px] text-amber-500 font-semibold">{liters.toLocaleString("en-US", { maximumFractionDigits: 2 })} L</p>}
        </div>
      </div>
      {total > 0 && (
        <div className="px-4 pb-3 -mt-1">
          <p className="text-xs text-amber-700 font-semibold text-right">{fmt(total)} MMK</p>
        </div>
      )}
    </div>
  );
}

// ─── Expenses panel — add items by name + amount ──────────────────────────────
function ExpensesPanel({ items, onChange, lang }: {
  items: ExpenseItem[];
  onChange: (items: ExpenseItem[]) => void;
  lang: Lang;
}) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");

  function addItem() {
    const trimName = name.trim();
    const trimAmount = amount.trim();
    if (!trimName || !trimAmount) return;
    onChange([...items, { name: trimName, amount: trimAmount }]);
    setName("");
    setAmount("");
  }

  function removeItem(idx: number) {
    onChange(items.filter((_, i) => i !== idx));
  }

  const total = items.reduce((s, i) => s + n(i.amount), 0);

  return (
    <div className="flex flex-col gap-3">
      {/* Add row */}
      <div className="flex gap-2">
        <div className="flex-1 flex flex-col gap-1">
          <label className="text-xs font-semibold text-amber-800/70 uppercase tracking-wider">{t(lang, "expenseName")}</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addItem()}
            placeholder="e.g. Oil, Maintenance…"
            className="w-full rounded-xl border px-3 py-2.5 text-sm font-medium outline-none bg-white border-amber-200 text-gray-900 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 placeholder:text-gray-300"
          />
        </div>
        <div className="w-32 flex flex-col gap-1">
          <label className="text-xs font-semibold text-amber-800/70 uppercase tracking-wider">{t(lang, "amount")}</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-amber-600 text-sm font-medium select-none">K</span>
            <input
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addItem()}
              placeholder="0"
              className="w-full rounded-xl border pl-8 pr-3 py-2.5 text-sm font-medium outline-none bg-white border-amber-200 text-gray-900 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 placeholder:text-gray-300"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-transparent uppercase tracking-wider select-none">Add</label>
          <button
            type="button"
            onClick={addItem}
            className="h-[42px] px-4 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 text-white font-bold text-sm shadow-sm shadow-amber-200 hover:from-amber-600 hover:to-yellow-600 transition-all active:scale-95"
          >
            + Add
          </button>
        </div>
      </div>

      {/* Item list */}
      {items.length > 0 && (
        <div className="rounded-xl border border-amber-100 overflow-hidden">
          {items.map((item, idx) => (
            <div key={idx} className={["flex items-center justify-between px-4 py-2.5 text-sm", idx > 0 ? "border-t border-amber-50" : ""].join(" ")}>
              <span className="font-medium text-gray-700">{item.name}</span>
              <div className="flex items-center gap-3">
                <span className="font-semibold text-amber-700">{fmt(n(item.amount))} MMK</span>
                <button
                  type="button"
                  onClick={() => removeItem(idx)}
                  className="w-6 h-6 flex items-center justify-center rounded-full bg-red-50 text-red-400 hover:bg-red-100 hover:text-red-600 transition-colors text-xs font-bold"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
          <div className="flex justify-between items-center px-4 py-2.5 bg-amber-50 border-t border-amber-100">
            <span className="text-xs font-bold text-amber-700 uppercase tracking-wider">{t(lang, "totalExpenses")}</span>
            <span className="text-sm font-bold text-amber-800">{fmt(total)} MMK</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Login screen ─────────────────────────────────────────────────────────────
function LoginScreen({ onLogin, lang, setLang }: {
  onLogin: (name: string, email: string) => void;
  lang: Lang; setLang: (l: Lang) => void;
}) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed.includes("@")) { setError("Please enter a valid email address."); return; }
    const name = trimmed.split("@")[0];
    onLogin(name, trimmed);
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-yellow-50 to-white flex flex-col items-center justify-center px-4">
      <div className="absolute top-4 right-4">
        <LangToggle lang={lang} setLang={setLang} />
      </div>
      <div className="mb-8 text-center">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-amber-400 to-yellow-600 shadow-lg shadow-amber-200 mb-4">
          <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2M12 2a10 10 0 100 20A10 10 0 0012 2z" />
          </svg>
        </div>
        <h1 className="text-3xl font-bold text-gray-900 tracking-tight">STM <span className="text-amber-600">Daily</span></h1>
        <p className="text-sm text-gray-500 mt-1">Daily Shift Report Portal</p>
      </div>

      <form onSubmit={handleSubmit} className="w-full max-w-sm bg-white rounded-3xl shadow-xl shadow-amber-100 border border-amber-100 p-8">
        <h2 className="text-lg font-bold text-gray-800 mb-1">{t(lang, "signInTitle")}</h2>
        <p className="text-sm text-gray-400 mb-6">Enter your work email to start your shift report.</p>

        <label className="block text-xs font-semibold text-amber-700 uppercase tracking-wider mb-1.5">{t(lang, "workEmail")}</label>
        <input
          type="email"
          value={email}
          onChange={e => { setEmail(e.target.value); setError(""); }}
          placeholder="you@gmail.com"
          className="w-full border-2 border-amber-200 rounded-xl px-4 py-3 text-sm font-medium text-gray-900 focus:outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-100 transition-all placeholder:text-gray-300"
          autoFocus
          required
        />
        {error && <p className="text-xs text-red-500 mt-2">{error}</p>}

        <button
          type="submit"
          className="mt-5 w-full bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-600 hover:to-yellow-600 text-white font-bold rounded-xl py-3 text-sm shadow-md shadow-amber-200 transition-all active:scale-[0.98]"
        >
          Continue →
        </button>
      </form>
      <p className="text-xs text-gray-400 mt-6">STM Financial Systems · Confidential</p>
    </div>
  );
}

// ─── Checking screen ──────────────────────────────────────────────────────────
function CheckingScreen() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 to-white flex items-center justify-center">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-amber-200 border-t-amber-500 rounded-full animate-spin mx-auto mb-4" />
        <p className="text-amber-700 font-semibold">Verifying access…</p>
      </div>
    </div>
  );
}

// ─── Access Denied screen ─────────────────────────────────────────────────────
function DeniedScreen({ email, onBack }: { email: string; onBack: () => void }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 to-white flex flex-col items-center justify-center px-4 text-center">
      <div className="w-20 h-20 rounded-3xl bg-red-100 flex items-center justify-center mb-6">
        <svg className="w-10 h-10 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
        </svg>
      </div>
      <h2 className="text-2xl font-bold text-gray-900 mb-2">Access Not Granted</h2>
      <p className="text-gray-500 text-sm mb-1">
        <span className="font-semibold text-gray-700">{email}</span> is not on the approved list.
      </p>
      <p className="text-gray-400 text-sm mb-8">Contact your manager to get access.</p>
      <button
        onClick={onBack}
        className="bg-gradient-to-r from-amber-500 to-yellow-500 text-white font-bold rounded-xl px-8 py-3 text-sm shadow-md shadow-amber-200"
      >
        ← Try a Different Email
      </button>
    </div>
  );
}

// ─── Shift form ───────────────────────────────────────────────────────────────
function ShiftForm({ employeeName, onSubmit, onLogout, lang, setLang }: {
  employeeName: string;
  onSubmit: (data: FormData, grandTotal: number, difference: number) => void;
  onLogout: () => void;
  lang: Lang; setLang: (l: Lang) => void;
}) {
  const [form, setForm] = useState<FormData>(EMPTY);

  const setFuel = useCallback((key: keyof Omit<FormData, "expenses" | "actualCash" | "pipa">, field: string, val: string) => {
    setForm(f => ({ ...f, [key]: { ...(f[key] as object), [field]: val } }));
  }, []);

  // Totals are the entered totalAmount directly
  const t92   = n(form.fuel92.totalAmount);
  const t95   = n(form.fuel95.totalAmount);
  const tPD   = n(form.premiumDiesel.totalAmount);
  // Liters are calculated: totalAmount / price
  const l92   = n(form.fuel92.price)   > 0 ? t92 / n(form.fuel92.price)   : 0;
  const l95   = n(form.fuel95.price)   > 0 ? t95 / n(form.fuel95.price)   : 0;
  const lPD   = n(form.premiumDiesel.price) > 0 ? tPD / n(form.premiumDiesel.price) : 0;

  const tPipa = form.pipa.reduce((s, item) => s + n(item.containers) * n(item.price), 0);
  const tD    = n(form.diesel.cash);

  const grandTotal  = t92 + t95 + tPD + tPipa + tD;
  const actualCash  = n(form.actualCash);
  const totalExp    = form.expenses.reduce((s, i) => s + n(i.amount), 0);
  const netExpected = grandTotal - totalExp;
  const difference  = actualCash - netExpected;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit(form, grandTotal, difference);
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-50 to-white">
      <div className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-amber-100 px-4 py-3 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-400 to-yellow-500 flex items-center justify-center shrink-0">
          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2M12 2a10 10 0 100 20A10 10 0 0012 2z" />
          </svg>
        </div>
        <div>
          <p className="text-xs text-amber-700 font-semibold uppercase tracking-widest">STM Daily</p>
          <p className="text-sm font-bold text-gray-900 capitalize">{employeeName}'s Shift Report</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <p className="text-xs text-gray-400">{new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}</p>
          <LangToggle lang={lang} setLang={setLang} />
          <button
            type="button"
            onClick={onLogout}
            className="text-xs text-amber-700/60 hover:text-amber-800 font-semibold border border-amber-200 hover:border-amber-300 rounded-lg px-2.5 py-1 transition-colors"
          >
            Switch User
          </button>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div>
          <h3 className="text-xs font-bold text-amber-700 uppercase tracking-widest mb-3 flex items-center gap-2">
            <span className="w-4 h-px bg-amber-300 block" />{t(lang, "fuelProducts")}<span className="flex-1 h-px bg-amber-100 block" />
          </h3>
          <div className="space-y-3">
            <ProductCard label="Fuel 92" badge="92" color="bg-gradient-to-r from-blue-500 to-blue-600"
              totalAmount={form.fuel92.totalAmount} price={form.fuel92.price} total={t92} liters={l92}
              onTotalAmount={v => setFuel("fuel92", "totalAmount", v)} onPrice={v => setFuel("fuel92", "price", v)} lang={lang} />
            <ProductCard label="Fuel 95" badge="95" color="bg-gradient-to-r from-green-500 to-emerald-600"
              totalAmount={form.fuel95.totalAmount} price={form.fuel95.price} total={t95} liters={l95}
              onTotalAmount={v => setFuel("fuel95", "totalAmount", v)} onPrice={v => setFuel("fuel95", "price", v)} lang={lang} />
            <ProductCard label="Premium Diesel" badge="PD" color="bg-gradient-to-r from-purple-500 to-violet-600"
              totalAmount={form.premiumDiesel.totalAmount} price={form.premiumDiesel.price} total={tPD} liters={lPD}
              onTotalAmount={v => setFuel("premiumDiesel", "totalAmount", v)} onPrice={v => setFuel("premiumDiesel", "price", v)} lang={lang} />
            <PipaPanel
              items={form.pipa}
              onChange={items => setForm(f => ({ ...f, pipa: items }))} lang={lang} />

            {/* Diesel — cash only */}
            <div className="bg-white rounded-2xl border border-amber-100 shadow-sm overflow-hidden">
              <div className="px-4 py-2.5 flex items-center gap-2 bg-gradient-to-r from-orange-500 to-red-500">
                <span className="text-xs font-bold text-white/90 uppercase tracking-widest">Diesel</span>
                <span className="ml-auto text-xs font-bold bg-white/20 text-white rounded-full px-2 py-0.5">D</span>
              </div>
              <div className="p-4 grid grid-cols-2 gap-3">
                <GoldInput label={t(lang, "cashAmount")} value={form.diesel.cash} onChange={v => setFuel("diesel", "cash", v)} prefix="K" />
                <GoldInput label="Price / L" value={form.diesel.price} onChange={v => setFuel("diesel", "price", v)} prefix="K" />
              </div>
              {tD > 0 && <div className="px-4 pb-3 -mt-1"><p className="text-xs text-amber-700 font-semibold text-right">{fmt(tD)} MMK cash</p></div>}
            </div>
          </div>
        </div>

        {/* Grand Total */}
        <div className="bg-gradient-to-r from-amber-400 to-yellow-500 rounded-2xl p-4 text-white shadow-md shadow-amber-200">
          <p className="text-xs font-bold uppercase tracking-widest opacity-80">{t(lang, "grandTotalLabel")}</p>
          <p className="text-3xl font-bold mt-1">{fmt(grandTotal)} <span className="text-sm font-medium opacity-80">MMK</span></p>
        </div>

        {/* Cash Summary */}
        <div className="bg-white rounded-2xl border border-amber-100 shadow-sm p-4 space-y-4">
          <h3 className="text-xs font-bold text-amber-700 uppercase tracking-widest">Cash Summary</h3>

          {/* Expenses — itemized */}
          <div>
            <p className="text-xs font-semibold text-amber-800/70 uppercase tracking-wider mb-2">{t(lang, "operationalExpenses")}</p>
            <ExpensesPanel items={form.expenses} onChange={items => setForm(f => ({ ...f, expenses: items }))} lang={lang} />
          </div>

          <div className="flex items-center justify-between bg-amber-50 rounded-xl px-4 py-2.5 border border-amber-100">
            <span className="text-xs font-semibold text-amber-700">Net Expected Cash</span>
            <span className="text-sm font-bold text-amber-800">{fmt(netExpected)} MMK</span>
          </div>
          <GoldInput label={t(lang, "actualCash")} value={form.actualCash} onChange={v => setForm(f => ({ ...f, actualCash: v }))} placeholder="0" prefix="K" />
          <div className={["flex items-center justify-between rounded-xl px-4 py-3 border",
            difference === 0 ? "bg-gray-50 border-gray-200" : difference > 0 ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"
          ].join(" ")}>
            <span className="text-xs font-bold uppercase tracking-wider text-gray-600">{t(lang, "difference")}</span>
            <span className={["text-base font-bold",
              difference === 0 ? "text-gray-500" : difference > 0 ? "text-green-600" : "text-red-600"
            ].join(" ")}>
              {form.actualCash ? fmtSigned(difference) : "—"}
            </span>
          </div>
        </div>

        <button type="submit"
          className="w-full bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-600 hover:to-yellow-600 text-white font-bold rounded-2xl py-4 text-base shadow-lg shadow-amber-200 transition-all active:scale-[0.98] mt-2">
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
  const t92   = n(form.fuel92.totalAmount);
  const t95   = n(form.fuel95.totalAmount);
  const tPD   = n(form.premiumDiesel.totalAmount);
  const l92   = n(form.fuel92.price)   > 0 ? t92 / n(form.fuel92.price)   : 0;
  const l95   = n(form.fuel95.price)   > 0 ? t95 / n(form.fuel95.price)   : 0;
  const lPD   = n(form.premiumDiesel.price) > 0 ? tPD / n(form.premiumDiesel.price) : 0;
  const tPipa = form.pipa.reduce((s, item) => s + n(item.containers) * n(item.price), 0);
  const tD    = n(form.diesel.cash);
  const totalExp   = form.expenses.reduce((s, i) => s + n(i.amount), 0);
  const actualCash = n(form.actualCash);

  const rows = [
    { label: "Fuel 92",        liters: l92,  price: form.fuel92.price,         total: t92,   color: "text-blue-600" },
    { label: "Fuel 95",        liters: l95,  price: form.fuel95.price,         total: t95,   color: "text-green-600" },
    { label: "Premium Diesel", liters: lPD,  price: form.premiumDiesel.price,  total: tPD,   color: "text-purple-600" },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-50 to-white">
      <div className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-amber-100 px-4 py-3 flex items-center gap-3">
        <button onClick={onBack} className="text-amber-600 text-sm font-semibold flex items-center gap-1 hover:text-amber-800 transition-colors">← Back</button>
        <p className="text-sm font-bold text-gray-900 mx-auto">Review Submission</p>
        <div className="w-14" />
      </div>
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div className="bg-white rounded-2xl border border-amber-100 p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
            <span className="text-lg font-bold text-amber-700">{employeeName[0].toUpperCase()}</span>
          </div>
          <div>
            <p className="font-bold text-gray-900 capitalize">{employeeName}</p>
            <p className="text-xs text-gray-400">{email} · {new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-amber-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-amber-50"><h3 className="text-xs font-bold text-amber-700 uppercase tracking-widest">Products</h3></div>
          <div className="divide-y divide-amber-50">
            {rows.map(r => r.total > 0 && (
              <div key={r.label} className="px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-800">{r.label}</p>
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
                    <p className="text-sm font-semibold text-gray-800">
                      Pipa · <span className="text-amber-600">{PIPA_PRODUCT_LABELS[item.product]}</span>
                    </p>
                    <p className="text-xs text-gray-400">
                      {containers} containers · {(containers * 215).toLocaleString()} L · {fmt(price)} MMK/pipa
                    </p>
                  </div>
                  <p className="text-sm font-bold text-amber-600">{fmt(total)} MMK</p>
                </div>
              );
            })}
            {tD > 0 && (
              <div className="px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-800">Diesel</p>
                  <p className="text-xs text-gray-400">Cash only · {fmt(n(form.diesel.price))} MMK/L</p>
                </div>
                <p className="text-sm font-bold text-orange-600">{fmt(tD)} MMK</p>
              </div>
            )}
          </div>
        </div>

        {/* Expenses breakdown */}
        {form.expenses.length > 0 && (
          <div className="bg-white rounded-2xl border border-amber-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-amber-50"><h3 className="text-xs font-bold text-amber-700 uppercase tracking-widest">Expenses</h3></div>
            <div className="divide-y divide-amber-50">
              {form.expenses.map((exp, idx) => (
                <div key={idx} className="px-4 py-3 flex justify-between text-sm">
                  <span className="text-gray-600">{exp.name}</span>
                  <span className="font-semibold text-amber-700">−{fmt(n(exp.amount))} MMK</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="bg-white rounded-2xl border border-amber-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-amber-50"><h3 className="text-xs font-bold text-amber-700 uppercase tracking-widest">Cash Summary</h3></div>
          <div className="divide-y divide-amber-50">
            <div className="px-4 py-3 flex justify-between text-sm"><span className="text-gray-500">{t(lang, "grandTotalShort")}</span><span className="font-bold text-gray-900">{fmt(grandTotal)} MMK</span></div>
            <div className="px-4 py-3 flex justify-between text-sm"><span className="text-gray-500">{t(lang, "totalExpenses")}</span><span className="font-semibold text-amber-700">−{fmt(totalExp)} MMK</span></div>
            <div className="px-4 py-3 flex justify-between text-sm"><span className="text-gray-500">{t(lang, "netExpected")}</span><span className="font-bold text-gray-900">{fmt(grandTotal - totalExp)} MMK</span></div>
            <div className="px-4 py-3 flex justify-between text-sm"><span className="text-gray-500">{t(lang, "actualCollected")}</span><span className="font-bold text-gray-900">{fmt(actualCash)} MMK</span></div>
            <div className={["px-4 py-3 flex justify-between text-sm font-bold", difference === 0 ? "bg-gray-50" : difference > 0 ? "bg-green-50" : "bg-red-50"].join(" ")}>
              <span className={difference >= 0 ? "text-green-700" : "text-red-700"}>{t(lang, "difference")}</span>
              <span className={difference >= 0 ? "text-green-700" : "text-red-700"}>{fmtSigned(difference)}</span>
            </div>
          </div>
        </div>

        <button onClick={onConfirm} disabled={submitting}
          className="w-full bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-600 hover:to-yellow-600 disabled:opacity-60 text-white font-bold rounded-2xl py-4 text-base shadow-lg shadow-amber-200 transition-all active:scale-[0.98]">
          {submitting ? "Submitting…" : "Confirm & Submit ✓"}
        </button>
        <button onClick={onBack} disabled={submitting}
          className="w-full text-amber-600 font-semibold py-2 text-sm hover:text-amber-800 transition-colors">
          ← Go back and edit
        </button>
      </div>
    </div>
  );
}

// ─── Success screen ───────────────────────────────────────────────────────────
function SuccessScreen({ employeeName, onNewShift }: { employeeName: string; onNewShift: () => void }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-yellow-50 to-white flex flex-col items-center justify-center px-4 text-center">
      <div className="relative mb-8">
        <div className="success-ring w-28 h-28 rounded-full bg-gradient-to-br from-amber-400 to-yellow-500 shadow-2xl shadow-amber-300 flex items-center justify-center">
          <svg className="w-14 h-14 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        {["top-0 right-0", "bottom-2 left-0", "top-4 -left-4", "-top-2 left-8"].map((pos, i) => (
          <div key={i} className={`absolute ${pos} w-3 h-3 bg-amber-400 rounded-full float-up float-up-${i + 1}`} style={{ animationDelay: `${i * 0.1 + 0.3}s` }} />
        ))}
      </div>
      <h1 className="text-3xl font-bold text-gray-900 mb-2 float-up float-up-1">Shift <span className="gold-shimmer">Submitted!</span></h1>
      <p className="text-gray-500 mb-1 float-up float-up-2 capitalize">Great work, <strong>{employeeName}</strong>.</p>
      <p className="text-sm text-gray-400 mb-8 float-up float-up-3">Your shift report has been recorded successfully.</p>
      <div className="float-up float-up-4 space-y-3 w-full max-w-xs">
        <button onClick={onNewShift}
          className="w-full bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-600 hover:to-yellow-600 text-white font-bold rounded-2xl py-3.5 shadow-lg shadow-amber-200 transition-all active:scale-[0.98]">
          Submit Another Shift
        </button>
        <p className="text-xs text-gray-400">STM Financial Systems · {new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</p>
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
  const [screen, setScreen] = useState<Screen>("login");
  const [employeeName, setEmployeeName] = useState("");
  const [email, setEmail] = useState("");
  const [formData, setFormData] = useState<FormData>(EMPTY);
  const [grandTotal, setGrandTotal] = useState(0);
  const [difference, setDifference] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [lang, setLang] = useState<Lang>(() => {
    const saved = localStorage.getItem(LANG_KEY);
    return (saved === "my" ? "my" : "en") as Lang;
  });

  // Restore saved session on first load
  useEffect(() => {
    const saved = loadSession();
    if (saved) {
      setEmployeeName(saved.name);
      setEmail(saved.mail);
      setScreen("form");
    }
  }, []);

  async function handleLogin(name: string, mail: string) {
    setEmployeeName(name);
    setEmail(mail);
    setScreen("checking");

    const { data, error } = await supabase
      .from("allowed_employees")
      .select("id")
      .eq("email", mail)
      .maybeSingle();

    if (error || !data) {
      setScreen("denied");
    } else {
      saveSession(name, mail);
      setScreen("form");
    }
  }

  function handleLogout() {
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
    setSubmitting(true);
    setSubmitError("");

    const t92   = n(formData.fuel92.totalAmount);
    const t95   = n(formData.fuel95.totalAmount);
    const tPD   = n(formData.premiumDiesel.totalAmount);
    const l92   = n(formData.fuel92.price)   > 0 ? t92 / n(formData.fuel92.price)   : 0;
    const l95   = n(formData.fuel95.price)   > 0 ? t95 / n(formData.fuel95.price)   : 0;
    const lPD   = n(formData.premiumDiesel.price) > 0 ? tPD / n(formData.premiumDiesel.price) : 0;
    const pipaItems = formData.pipa.map(item => ({
      product: item.product,
      containers: n(item.containers),
      price: n(item.price),
      total: n(item.containers) * n(item.price),
    })).filter(item => item.containers > 0 || item.price > 0);
    const tPipa = pipaItems.reduce((s, item) => s + item.total, 0);
    const totalPipaContainers = pipaItems.reduce((s, item) => s + item.containers, 0);
    const totalExp   = formData.expenses.reduce((s, i) => s + n(i.amount), 0);
    const actualCash = n(formData.actualCash);

    const payload: ShiftPayload = {
      employee_name: employeeName,
      employee_id: email,
      timestamp: new Date().toISOString(),
      fuel_data: {
        fuel_92_liters:        l92,
        fuel_92_price:         n(formData.fuel92.price),
        fuel_92_total:         t92,
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
        diesel_cash:           n(formData.diesel.cash),
        diesel_price:          n(formData.diesel.price),
      },
      total_expenses:  totalExp,
      expenses_breakdown: formData.expenses
        .map(e => ({ name: e.name.trim(), amount: n(e.amount) }))
        .filter(e => e.name.length > 0 || e.amount > 0),
      expected_total:  grandTotal,
      actual_cash:     actualCash,
      variance:        difference,
    };

    const { error } = await submitShift(payload);
    setSubmitting(false);

    if (error) {
      setSubmitError(error.message);
    } else {
      setScreen("success");
    }
  }

  function handleNewShift() {
    setFormData(EMPTY);
    setGrandTotal(0);
    setDifference(0);
    setScreen("form");
  }

  return (
    <>
      {screen === "login"    && <LoginScreen onLogin={handleLogin} lang={lang} setLang={setLang} />}
      {screen === "checking" && <CheckingScreen />}
      {screen === "denied"   && <DeniedScreen email={email} onBack={() => setScreen("login")} />}
      {screen === "form"     && <ShiftForm employeeName={employeeName} onSubmit={handleFormSubmit} onLogout={handleLogout} lang={lang} setLang={setLang} />}
      {screen === "confirm"  && (
        <>
          <ConfirmScreen
            employeeName={employeeName} email={email} form={formData}
            grandTotal={grandTotal} difference={difference}
            onConfirm={handleConfirm} onBack={() => setScreen("form")} submitting={submitting} lang={lang}
          />
          {submitError && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-red-600 text-white text-sm font-semibold rounded-xl px-5 py-3 shadow-xl z-50">
              ⚠ {submitError}
            </div>
          )}
        </>
      )}
      {screen === "success"  && <SuccessScreen employeeName={employeeName} onNewShift={handleNewShift} />}
    </>
  );
}
