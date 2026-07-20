import { useState, useCallback, useEffect, useRef } from "react";
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
type Screen = "login" | "checking" | "denied" | "mode-select" | "form" | "confirm" | "success" | "receipt" | "settings";

interface FuelRow { totalAmount: string; price: string; liters: string; }
interface DieselRow { cash: string; price: string; }
interface ExpenseItem { name: string; amount: string; profileId?: string; txnType?: "payment" | "debt"; }
type PipaProduct = "92" | "95" | "PD" | "D";
interface PipaItem { product: PipaProduct; containers: string; price: string; }
interface JellyCanItem { product: PipaProduct; pieces: string; liters: string; price: string; }
interface FormData {
  fuel92: FuelRow;
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
  fuelProducts:         { en: "Fuel Products",             my: "ဆီ အမျိုးအစား" },
  totalAmount:          { en: "Total Amount",              my: "ရောင်းရငွေ" },
  literPrice:           { en: "Liter Price",               my: "လီတာစျေးနှုန်း" },
  literSold:            { en: "Liters Sold",               my: "ရောင်းရလီတာ" },
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
  totalExpenses:        { en: "Total Expenses",            my: "စုစုပေါင်း ထွက်ငွေ" },
  netExpected:          { en: "Net Expected",              my: "ရှိရမည့်ငွေ" },
  grandTotalShort:      { en: "Grand Total",               my: "စုစုပေါင်းငွေပမာဏ" },
  actualCollected:      { en: "Actual Collected",          my: "ငွေသားပမာဏ" },
  additionalCashLabel:  { en: "Additional Cash",           my: "နောက်ထပ်ငွေ" },
  addCashEntry:         { en: "Add Entry",                 my: "ထည့်ရန်" },
  cashName:             { en: "Description",               my: "အကြောင်းအရာ" },
  totalAdditional:      { en: "Total Additional",          my: "စုစုပေါင်း နောက်ထပ်ငွေ" },
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
      className="flex items-center gap-1 bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] rounded-lg px-2 py-1 transition-colors"
    >
      <span className={`text-[11px] font-bold ${lang === "en" ? "text-white" : "text-gray-600"}`}>EN</span>
      <span className="text-gray-700 text-[10px]">|</span>
      <span className={`text-[11px] font-bold ${lang === "my" ? "text-white" : "text-gray-600"}`}>မြ</span>
    </button>
  );
}

const EMPTY: FormData = {
  fuel92:         { totalAmount: "", price: "", liters: "" },
  fuel95:         { totalAmount: "", price: "", liters: "" },
  premiumDiesel:  { totalAmount: "", price: "", liters: "" },
  pipa:           [],
  jellyCan:       [],
  diesel:         { cash: "", price: "" },
  expenses:       [],
  actualCash:     "",
  shiftDate:      "",
};

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
        <span className="ml-auto text-[10px] text-gray-600">Manual L entry</span>
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
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">ပါရှိသောလီတာ (L/can)</label>
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
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">Price / Can (K)</label>
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
      <div className="px-5 pb-3 grid grid-cols-2 gap-4">
        <GoldInput label={t(lang, "totalAmount")} value={totalAmount} onChange={onTotalAmount} prefix="K" />
        <GoldInput label={t(lang, "literPrice")} value={price} onChange={onPrice} prefix="K" />
      </div>
      <div className="px-5 pb-5">
        <GoldInput label={t(lang, "literSold")} value={liters} onChange={onLiters} />
      </div>
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
    const { data } = await supabase
      .from("debt_profiles")
      .select("id, name, relation")
      .ilike("name", `%${val.trim()}%`)
      .limit(6);
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
      <div className="flex gap-2">
        {/* Name / search combobox */}
        <div className="flex-1 flex flex-col gap-1.5 relative" ref={wrapRef}>
          <label className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">{t(lang, "expenseName")}</label>
          <div className="relative">
            <input
              type="text"
              value={name}
              onChange={e => handleNameChange(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addItem()}
              onFocus={() => { if (hits.length > 0) setShowDrop(true); }}
              placeholder="Search profile or free-type…"
              className={`w-full rounded-xl border px-3 py-3 text-sm font-medium outline-none bg-[#0d1117] text-white placeholder:text-gray-700 transition-colors ${
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

        {/* Amount */}
        <div className="w-32 flex flex-col gap-1.5">
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
          <label className="text-[11px] font-bold text-transparent uppercase tracking-widest select-none">Add</label>
          <button
            type="button"
            onClick={addItem}
            className="h-[50px] px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm transition-all active:scale-95"
          >
            + Add
          </button>
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
                  className="w-6 h-6 flex items-center justify-center rounded-full bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors text-xs font-bold"
                >
                  ✕
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

      <form onSubmit={handleSubmit} className="w-full max-w-sm bg-[#161b22] rounded-2xl border border-[#30363d] p-8">
        <h2 className="text-lg font-bold text-white mb-1">{t(lang, "signInTitle")}</h2>
        <p className="text-sm text-gray-500 mb-6">Enter your work email to start your shift report.</p>

        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">{t(lang, "workEmail")}</label>
        <input
          type="email"
          value={email}
          onChange={e => { setEmail(e.target.value); setError(""); }}
          placeholder="you@gmail.com"
          className="w-full bg-[#0d1117] border border-[#30363d] rounded-xl px-4 py-3 text-sm font-medium text-white focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all placeholder:text-gray-700"
          autoFocus
          required
        />
        {error && <p className="text-xs text-red-400 mt-2">{error}</p>}

        <button
          type="submit"
          className="mt-5 w-full bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl py-3 text-sm transition-all active:scale-[0.98]"
        >
          Continue →
        </button>
      </form>
      <p className="text-xs text-gray-700 mt-6">STM Financial Systems · Confidential</p>
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
      <h2 className="text-2xl font-bold text-white mb-2">Access Not Granted</h2>
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
function ShiftForm({ employeeName, onSubmit, onLogout, onBack, lang, setLang }: {
  employeeName: string;
  onSubmit: (data: FormData, grandTotal: number, difference: number) => void;
  onLogout: () => void;
  onBack: () => void;
  lang: Lang; setLang: (l: Lang) => void;
}) {
  const [form, setForm] = useState<FormData>(() => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const localDt = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
    return { ...EMPTY, shiftDate: localDt };
  });

  // Helper to format auto-calculated numbers nicely (no trailing zeros)
  function autoNum(v: number): string {
    if (v === 0) return "";
    return parseFloat(v.toFixed(6)).toString();
  }

  const setFuelField = useCallback((
    key: "fuel92" | "fuel95" | "premiumDiesel",
    field: "totalAmount" | "price" | "liters",
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
        if (n(row.liters) > 0) {
          row.totalAmount = autoNum(n(row.liters) * n(val));
        } else if (n(row.totalAmount) > 0) {
          row.liters = autoNum(n(row.totalAmount) / n(val));
        }
      }
      return { ...f, [key]: row };
    });
  }, []);

  // Totals are the entered totalAmount directly
  const t92   = n(form.fuel92.totalAmount);
  const t95   = n(form.fuel95.totalAmount);
  const tPD   = n(form.premiumDiesel.totalAmount);
  // Liters: use the stored (entered or auto-calculated) value
  const l92   = n(form.fuel92.liters);
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
  const netExpected     = grandTotal - totalDeductions + totalIncome;
  const difference      = actualCash - netExpected;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit(form, grandTotal, difference);
  }

  return (
    <div className="min-h-screen bg-[#0f111a]">
      <div className="sticky top-0 z-10 bg-[#0f111a]/95 backdrop-blur border-b border-[#30363d] px-4 py-3 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-blue-600/20 flex items-center justify-center shrink-0">
          <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2M12 2a10 10 0 100 20A10 10 0 0012 2z" />
          </svg>
        </div>
        <div>
          <p className="text-xs text-gray-500 font-semibold uppercase tracking-widest">STM Daily</p>
          <p className="text-sm font-bold text-white capitalize">{employeeName}'s Shift Report</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <input
            type="datetime-local"
            value={form.shiftDate}
            onChange={e => setForm(f => ({ ...f, shiftDate: e.target.value }))}
            className="text-xs text-gray-400 bg-[#161b22] border border-[#30363d] hover:border-gray-500 focus:border-blue-500 focus:outline-none rounded-lg px-2 py-1 cursor-pointer"
          />
          <LangToggle lang={lang} setLang={setLang} />
          <button
            type="button"
            onClick={onBack}
            className="text-xs text-gray-500 hover:text-white font-semibold border border-[#30363d] hover:border-gray-500 rounded-lg px-2.5 py-1 transition-colors"
          >
            ← Modes
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="text-xs text-gray-500 hover:text-white font-semibold border border-[#30363d] hover:border-gray-500 rounded-lg px-2.5 py-1 transition-colors"
          >
            Switch User
          </button>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div>
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3 flex items-center gap-2">
            <span className="flex-1 h-px bg-[#30363d] block" />{t(lang, "fuelProducts")}<span className="flex-1 h-px bg-[#30363d] block" />
          </h3>
          {/* Fuel rows — full-width vertical stack */}
          <div className="space-y-3">
            <ProductCard label="Fuel 92" badge="92" accentText="text-blue-400" accentBorder="border-l-blue-500"
              totalAmount={form.fuel92.totalAmount} price={form.fuel92.price} liters={form.fuel92.liters} total={t92}
              onTotalAmount={v => setFuelField("fuel92", "totalAmount", v)} onPrice={v => setFuelField("fuel92", "price", v)} onLiters={v => setFuelField("fuel92", "liters", v)} lang={lang} />
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

          <div className="flex items-center justify-between bg-[#1c2433] rounded-xl px-4 py-2.5 border border-[#30363d]">
            <span className="text-xs font-semibold text-gray-400">Net Expected Cash</span>
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
  const t92   = n(form.fuel92.totalAmount);
  const t95   = n(form.fuel95.totalAmount);
  const tPD   = n(form.premiumDiesel.totalAmount);
  const l92   = n(form.fuel92.liters)        || (n(form.fuel92.price)        > 0 ? t92 / n(form.fuel92.price)        : 0);
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
    { label: "Fuel 92",        liters: l92,  price: form.fuel92.price,         total: t92,   color: "text-blue-400" },
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
        <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-4 flex items-center gap-3">
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
            <div className="px-4 py-3 flex justify-between text-sm"><span className="text-gray-500">{t(lang, "netExpected")}</span><span className="font-bold text-white tabular-nums">{fmt(grandTotal - totalDeductions + totalIncome)} MMK</span></div>
            <div className="px-4 py-3 flex justify-between text-sm"><span className="text-gray-500">{t(lang, "actualCollected")}</span><span className="font-bold text-white tabular-nums">{fmt(actualCash)} MMK</span></div>
            <div className={["px-4 py-3 flex justify-between text-sm font-bold", difference === 0 ? "bg-[#1c2433]" : difference > 0 ? "bg-emerald-500/10" : "bg-red-500/10"].join(" ")}>
              <span className={difference >= 0 ? "text-emerald-400" : "text-red-400"}>{t(lang, "difference")}</span>
              <span className={["tabular-nums", difference >= 0 ? "text-emerald-400" : "text-red-400"].join(" ")}>{fmtSigned(difference)}</span>
            </div>
          </div>
        </div>

        <button onClick={onConfirm} disabled={submitting}
          className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white font-bold rounded-2xl py-4 text-base transition-all active:scale-[0.98]">
          {submitting ? "Submitting…" : "Confirm & Submit ✓"}
        </button>
        <button onClick={onBack} disabled={submitting}
          className="w-full text-gray-500 font-semibold py-2 text-sm hover:text-white transition-colors">
          ← Go back and edit
        </button>
      </div>
    </div>
  );
}

// ─── Success screen ───────────────────────────────────────────────────────────
function SuccessScreen({ employeeName, onNewShift }: { employeeName: string; onNewShift: () => void }) {
  return (
    <div className="min-h-screen bg-[#0f111a] flex flex-col items-center justify-center px-4 text-center">
      <div className="relative mb-8">
        <div className="success-ring w-28 h-28 rounded-full bg-blue-600/20 border-2 border-blue-500/30 flex items-center justify-center">
          <svg className="w-14 h-14 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        {["top-0 right-0", "bottom-2 left-0", "top-4 -left-4", "-top-2 left-8"].map((pos, i) => (
          <div key={i} className={`absolute ${pos} w-3 h-3 bg-blue-400/60 rounded-full float-up float-up-${i + 1}`} style={{ animationDelay: `${i * 0.1 + 0.3}s` }} />
        ))}
      </div>
      <h1 className="text-3xl font-bold text-white mb-2 float-up float-up-1">Shift <span className="text-blue-400">Submitted!</span></h1>
      <p className="text-gray-400 mb-1 float-up float-up-2 capitalize">Great work, <strong className="text-white">{employeeName}</strong>.</p>
      <p className="text-sm text-gray-400 mb-8 float-up float-up-3">Your shift report has been recorded successfully.</p>
      <div className="float-up float-up-4 space-y-3 w-full max-w-xs">
        <button onClick={onNewShift}
          className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-2xl py-3.5 transition-all active:scale-[0.98]">
          Submit Another Shift
        </button>
        <p className="text-xs text-gray-400">STM Financial Systems · {new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</p>
      </div>
    </div>
  );
}

// ─── App Config (localStorage) ────────────────────────────────────────────────
const CONFIG_KEY = "stm_app_config";
interface AppConfig { price92: string; pricePD: string; price95: string; priceHSD: string; stationPhone: string; receiptMotto: string; }
const DEFAULT_CONFIG: AppConfig = { price92: "1200", pricePD: "1400", price95: "1350", priceHSD: "1100", stationPhone: "09-3339777", receiptMotto: "Thank You For Your Purchase!" };
function loadConfig(): AppConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch { return { ...DEFAULT_CONFIG }; }
}
function saveConfig(cfg: AppConfig) { localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg)); }

// ─── Mode Select Screen ───────────────────────────────────────────────────────
function ModeSelectScreen({ employeeName, onShift, onReceipt, onSettings, onLogout, lang, setLang }: {
  employeeName: string; onShift: () => void; onReceipt: () => void;
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
            title="App Settings">
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
          <h2 className="text-2xl font-bold text-white">Select Mode</h2>
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

        <button type="button" onClick={onReceipt}
          className="w-full bg-[#161b22] border-2 border-[#30363d] hover:border-emerald-500/60 hover:bg-emerald-600/5 rounded-2xl p-6 text-left transition-all active:scale-[0.98] group">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-600/20 flex items-center justify-center shrink-0 group-hover:bg-emerald-600/30 transition-colors">
              <svg className="w-6 h-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>
              <p className="text-base font-bold text-white">Issue Customer Receipt</p>
              <p className="text-sm text-gray-500 mt-0.5">Generate a digital receipt for an individual pump transaction</p>
            </div>
          </div>
          <div className="mt-4 flex items-center text-xs font-semibold text-emerald-400">
            Issue receipt
            <svg className="w-4 h-4 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
          </div>
        </button>
      </div>
    </div>
  );
}

// ─── App Settings Screen ───────────────────────────────────────────────────────
function AppSettingsScreen({ onBack }: { onBack: () => void }) {
  const [cfg, setCfg] = useState<AppConfig>(loadConfig);
  const [saved, setSaved] = useState(false);

  function handleSave() { saveConfig(cfg); setSaved(true); setTimeout(() => setSaved(false), 2000); }

  const fieldCls = "w-full bg-[#0d1117] border border-[#30363d] rounded-xl px-4 py-3 text-sm font-medium text-white focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all placeholder:text-gray-700";
  const labelCls = "block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5";

  function PriceField({ label, field, placeholder }: { label: string; field: keyof AppConfig; placeholder: string }) {
    return (
      <div>
        <label className={labelCls}>{label}</label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600 text-sm font-semibold select-none">K</span>
          <input type="number" value={cfg[field] as string}
            onChange={e => setCfg(c => ({ ...c, [field]: e.target.value }))}
            placeholder={placeholder} className={"pl-8 " + fieldCls} />
        </div>
      </div>
    );
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
          <PriceField label="92 RON" field="price92" placeholder="1200" />
          <PriceField label="PD (Premium Diesel)" field="pricePD" placeholder="1400" />
          <PriceField label="95 RON" field="price95" placeholder="1350" />
          <PriceField label="HSD (Diesel)" field="priceHSD" placeholder="1100" />
          <p className="text-xs text-gray-600">Auto-filled in the Customer Receipt form per product</p>
        </div>
        <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-5 space-y-4">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">Receipt Footer</p>
          <div>
            <label className={labelCls}>Station Phone Number</label>
            <input type="text" value={cfg.stationPhone}
              onChange={e => setCfg(c => ({ ...c, stationPhone: e.target.value }))}
              placeholder="09-3339777" className={fieldCls} />
          </div>
          <div>
            <label className={labelCls}>Receipt Motto</label>
            <input type="text" value={cfg.receiptMotto}
              onChange={e => setCfg(c => ({ ...c, receiptMotto: e.target.value }))}
              placeholder="Thank You For Your Purchase!" className={fieldCls} />
          </div>
        </div>
        <button type="button" onClick={handleSave}
          className={`w-full font-bold rounded-2xl py-4 text-base transition-all active:scale-[0.98] ${saved ? "bg-emerald-600 text-white" : "bg-blue-600 hover:bg-blue-500 text-white"}`}>
          {saved ? "✓ Saved!" : "Save Changes"}
        </button>
      </div>
    </div>
  );
}

// ─── Customer Receipt Screen ───────────────────────────────────────────────────
type PaymentStatus = "paid" | "debt";
type PaymentMethod = "Cash" | "K Pay" | "MMQR";
type CalcMode = "liters" | "amount";
type ProductType = "92 RON" | "PD" | "95" | "HSD";

const PRODUCT_LABELS: Record<ProductType, string> = {
  "92 RON": "92 RON", "PD": "PD (Premium Diesel)", "95": "95 RON", "HSD": "HSD (Diesel)",
};
const PRODUCT_PRICE_KEYS: Record<ProductType, keyof AppConfig> = {
  "92 RON": "price92", "PD": "pricePD", "95": "price95", "HSD": "priceHSD",
};

interface CartItem { id: number; product: ProductType; pricePerLiter: string; calcMode: CalcMode; litersInput: string; amountInput: string; }
interface ReceiptLine { product: ProductType; pricePerLiter: number; liters: number; amount: number; }
interface GeneratedReceipt {
  staffName: string; customerName: string; payStatus: PaymentStatus; payMethod: PaymentMethod;
  items: ReceiptLine[]; grandTotal: number;
  stationPhone: string; receiptMotto: string; receiptNo: string; timestamp: string;
}

function computeRow(item: CartItem): { liters: number; amount: number } {
  const price = parseFloat(item.pricePerLiter) || 0;
  if (item.calcMode === "liters") {
    const liters = parseFloat(item.litersInput) || 0;
    return { liters, amount: liters * price };
  }
  const amount = parseFloat(item.amountInput) || 0;
  return { liters: price > 0 ? amount / price : 0, amount };
}

let _nextId = 1;

function CustomerReceiptScreen({ employeeName, onBack }: { employeeName: string; onBack: () => void }) {
  const cfg0 = loadConfig();
  const [staffName, setStaffName] = useState(employeeName);
  const [customerName, setCustomerName] = useState("");
  const [payStatus, setPayStatus] = useState<PaymentStatus>("paid");
  const [payMethod, setPayMethod] = useState<PaymentMethod>("Cash");
  const [cart, setCart] = useState<CartItem[]>([
    { id: _nextId++, product: "92 RON", pricePerLiter: cfg0.price92, calcMode: "liters", litersInput: "", amountInput: "" },
  ]);
  const [receipt, setReceipt] = useState<GeneratedReceipt | null>(null);

  function fmtL(v: number) { return v.toLocaleString("en-US", { maximumFractionDigits: 3 }); }
  function fmtK(v: number) { return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(v)); }

  function addRow() {
    if (cart.length >= 4) return;
    const cfg = loadConfig();
    const product: ProductType = "92 RON";
    setCart(c => [...c, { id: _nextId++, product, pricePerLiter: cfg[PRODUCT_PRICE_KEYS[product]] as string, calcMode: "liters", litersInput: "", amountInput: "" }]);
  }

  function removeRow(id: number) { setCart(c => c.filter(r => r.id !== id)); }

  function updateRow(id: number, patch: Partial<CartItem>) {
    setCart(c => c.map(r => {
      if (r.id !== id) return r;
      const updated = { ...r, ...patch };
      if (patch.product) {
        const cfg = loadConfig();
        updated.pricePerLiter = cfg[PRODUCT_PRICE_KEYS[patch.product as ProductType]] as string;
      }
      return updated;
    }));
  }

  function handleGenerate() {
    const lines: ReceiptLine[] = cart.map(item => {
      const { liters, amount } = computeRow(item);
      return { product: item.product, pricePerLiter: parseFloat(item.pricePerLiter) || 0, liters, amount };
    }).filter(l => l.liters > 0 && l.pricePerLiter > 0);
    if (lines.length === 0) return;
    const grandTotal = lines.reduce((s, l) => s + l.amount, 0);
    const cfg = loadConfig();
    const d = new Date();
    const dateStr = d.toISOString().slice(0, 10).replace(/-/g, "");
    setReceipt({
      staffName, customerName, payStatus, payMethod, items: lines, grandTotal,
      stationPhone: cfg.stationPhone || "09-3339777",
      receiptMotto: cfg.receiptMotto || "Thank You For Your Purchase!",
      receiptNo: `RCP-${dateStr}-${Math.floor(Math.random() * 9000) + 1000}`,
      timestamp: d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }),
    });
  }

  const fieldCls = "w-full bg-[#0d1117] border border-[#30363d] rounded-xl px-3 py-2.5 text-sm font-medium text-white focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all placeholder:text-gray-700";
  const labelCls = "block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5";

  const canGenerate = cart.some(item => {
    const { liters } = computeRow(item);
    return liters > 0 && (parseFloat(item.pricePerLiter) || 0) > 0;
  });

  if (receipt) {
    return (
      <div className="min-h-screen bg-[#0f111a]">
        {/* Action bar — hidden on print */}
        <div className="sticky top-0 z-10 bg-[#0f111a]/95 backdrop-blur border-b border-[#30363d] px-4 py-3 flex items-center gap-2 print:hidden">
          <button onClick={() => setReceipt(null)} className="text-gray-400 hover:text-white text-sm font-semibold flex items-center gap-1 transition-colors">
            ← New Receipt
          </button>
          <p className="text-sm font-bold text-white mx-auto">Receipt Generated</p>
          <button onClick={() => window.print()}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            Print
          </button>
          <button onClick={onBack} className="text-xs text-gray-500 hover:text-white font-semibold border border-[#30363d] hover:border-gray-500 rounded-lg px-2.5 py-1.5 transition-colors">
            Switch Mode
          </button>
        </div>

        {/* Receipt — this is what gets printed */}
        <div className="max-w-sm mx-auto px-4 py-6">
          <div className="receipt-printable bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-lg font-mono">
            {/* Station header */}
            <div className="px-6 pt-5 pb-4 text-center border-b border-dashed border-gray-300">
              <p className="text-base font-black text-gray-900 leading-tight">Shwe Thzain Moe Fuel Station</p>
              <p className="text-xs text-gray-500 mt-0.5">Customer Receipt</p>
            </div>

            {/* Meta */}
            <div className="px-5 py-4 space-y-1.5 border-b border-dashed border-gray-300 text-xs">
              <div className="flex justify-between">
                <span className="text-gray-500">Receipt No.</span>
                <span className="font-bold text-gray-800">{receipt.receiptNo}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Date &amp; Time</span>
                <span className="text-gray-800">{receipt.timestamp}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Staff</span>
                <span className="font-semibold text-gray-800 capitalize">{receipt.staffName || "—"}</span>
              </div>
              {receipt.customerName && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Customer</span>
                  <span className="font-semibold text-gray-800">{receipt.customerName}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-500">Payment</span>
                <span className="font-semibold text-gray-800">
                  {receipt.payStatus === "paid" ? `PAID · ${receipt.payMethod}` : "DEBT / CREDIT"}
                </span>
              </div>
            </div>

            {/* Itemized table */}
            <div className="px-5 py-3 border-b border-dashed border-gray-300">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Items</p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-100">
                    <th className="text-left font-semibold pb-1.5">Product</th>
                    <th className="text-right font-semibold pb-1.5">Price/L</th>
                    <th className="text-right font-semibold pb-1.5">Liters</th>
                    <th className="text-right font-semibold pb-1.5">Subtotal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {receipt.items.map((line, i) => (
                    <tr key={i}>
                      <td className="py-1.5 font-semibold text-gray-800">{line.product}</td>
                      <td className="py-1.5 text-right text-gray-600">{fmtK(line.pricePerLiter)}</td>
                      <td className="py-1.5 text-right text-gray-600">{fmtL(line.liters)}</td>
                      <td className="py-1.5 text-right font-bold text-gray-900">{fmtK(line.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Grand total */}
            <div className="px-5 py-4 border-b border-dashed border-gray-300">
              <div className="flex justify-between items-center">
                <span className="text-sm font-black text-gray-900">GRAND TOTAL</span>
                <span className="text-base font-black text-gray-900">{fmtK(receipt.grandTotal)} MMK</span>
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-4 text-center text-xs space-y-1">
              <p className="text-gray-500">📞 {receipt.stationPhone}</p>
              <p className="font-semibold text-gray-700">{receipt.receiptMotto}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f111a]">
      <div className="sticky top-0 z-10 bg-[#0f111a]/95 backdrop-blur border-b border-[#30363d] px-4 py-3 flex items-center">
        <button onClick={onBack} className="text-gray-400 hover:text-white text-sm font-semibold flex items-center gap-1 transition-colors">← Switch Mode</button>
        <p className="text-sm font-bold text-white mx-auto">Issue Customer Receipt</p>
        <div className="w-28" />
      </div>
      <div className="max-w-sm mx-auto px-4 py-6 space-y-4">

        {/* Transaction info */}
        <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-5 space-y-4">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">Transaction Info</p>
          <div>
            <label className={labelCls}>Employee Name</label>
            <input type="text" value={staffName} onChange={e => setStaffName(e.target.value)}
              placeholder="Your name" className={fieldCls} />
          </div>
          <div>
            <label className={labelCls}>Customer Name <span className="text-gray-600 normal-case font-normal">(optional)</span></label>
            <input type="text" value={customerName} onChange={e => setCustomerName(e.target.value)}
              placeholder="Leave blank if not needed" className={fieldCls} />
          </div>
        </div>

        {/* Payment */}
        <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-5 space-y-4">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">Payment</p>
          <div className="flex gap-2">
            {(["paid", "debt"] as PaymentStatus[]).map(s => (
              <button key={s} type="button" onClick={() => setPayStatus(s)}
                className={`flex-1 py-2.5 rounded-xl text-sm font-bold border transition-all ${
                  payStatus === s
                    ? s === "paid" ? "bg-emerald-500 text-white border-emerald-500" : "bg-red-500 text-white border-red-500"
                    : "bg-transparent text-gray-500 border-[#30363d] hover:text-gray-300"
                }`}>
                {s === "paid" ? "✓ Paid" : "↑ Debt"}
              </button>
            ))}
          </div>
          {payStatus === "paid" && (
            <div className="flex gap-2">
              {(["Cash", "K Pay", "MMQR"] as PaymentMethod[]).map(m => (
                <button key={m} type="button" onClick={() => setPayMethod(m)}
                  className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${
                    payMethod === m ? "bg-blue-600 text-white border-blue-600" : "bg-transparent text-gray-500 border-[#30363d] hover:text-gray-300"
                  }`}>
                  {m}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Products */}
        <div className="bg-[#161b22] border border-[#30363d] rounded-2xl overflow-hidden">
          <div className="px-5 py-3 border-b border-[#30363d] flex items-center justify-between">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">Products</p>
            <span className="text-[10px] text-gray-600">{cart.length}/4 items</span>
          </div>

          {cart.map((item, idx) => {
            const { liters, amount } = computeRow(item);
            const price = parseFloat(item.pricePerLiter) || 0;
            return (
              <div key={item.id} className={`px-4 py-4 space-y-3 ${idx > 0 ? "border-t border-[#30363d]" : ""}`}>
                {/* Row header */}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-gray-500 uppercase">Item {idx + 1}</span>
                  {cart.length > 1 && (
                    <button type="button" onClick={() => removeRow(item.id)}
                      className="ml-auto text-gray-600 hover:text-red-400 transition-colors p-0.5">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </div>

                {/* Product type */}
                <div>
                  <label className={labelCls}>Product Type</label>
                  <select value={item.product}
                    onChange={e => updateRow(item.id, { product: e.target.value as ProductType })}
                    className={fieldCls + " bg-[#0d1117]"}>
                    {(Object.keys(PRODUCT_LABELS) as ProductType[]).map(p => (
                      <option key={p} value={p}>{PRODUCT_LABELS[p]}</option>
                    ))}
                  </select>
                </div>

                {/* Price per liter */}
                <div>
                  <label className={labelCls}>Price Per Liter (MMK)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600 text-sm font-semibold select-none">K</span>
                    <input type="number" value={item.pricePerLiter}
                      onChange={e => updateRow(item.id, { pricePerLiter: e.target.value })}
                      placeholder="0" className={"pl-8 " + fieldCls} />
                  </div>
                </div>

                {/* Calc mode toggle + input */}
                <div>
                  <div className="flex gap-2 mb-2">
                    {(["liters", "amount"] as CalcMode[]).map(m => (
                      <button key={m} type="button" onClick={() => updateRow(item.id, { calcMode: m })}
                        className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold border transition-all ${
                          item.calcMode === m ? "bg-blue-600 text-white border-blue-600" : "bg-transparent text-gray-500 border-[#30363d]"
                        }`}>
                        {m === "liters" ? "By Liters" : "By Amount"}
                      </button>
                    ))}
                  </div>
                  {item.calcMode === "liters" ? (
                    <>
                      <input type="number" value={item.litersInput}
                        onChange={e => updateRow(item.id, { litersInput: e.target.value })}
                        placeholder="0.000 L" className={fieldCls} />
                      {liters > 0 && price > 0 && (
                        <p className="text-xs font-bold text-emerald-400 mt-1.5">→ {new Intl.NumberFormat("en-US").format(Math.round(amount))} MMK</p>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600 text-sm font-semibold select-none">K</span>
                        <input type="number" value={item.amountInput}
                          onChange={e => updateRow(item.id, { amountInput: e.target.value })}
                          placeholder="0" className={"pl-8 " + fieldCls} />
                      </div>
                      {amount > 0 && price > 0 && (
                        <p className="text-xs font-bold text-emerald-400 mt-1.5">→ {liters.toLocaleString("en-US", { maximumFractionDigits: 3 })} L</p>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}

          {/* Add product button */}
          <div className="px-4 py-3 border-t border-[#30363d]">
            <button type="button" onClick={addRow} disabled={cart.length >= 4}
              className="flex items-center gap-1.5 text-xs font-bold text-emerald-400 hover:text-emerald-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Add Product {cart.length >= 4 ? "(max 4)" : ""}
            </button>
          </div>
        </div>

        <button type="button" onClick={handleGenerate} disabled={!canGenerate}
          className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-2xl py-4 text-base transition-all active:scale-[0.98]">
          Generate Receipt →
        </button>
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
      setScreen("mode-select");
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
      setScreen("mode-select");
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
    const l92   = n(formData.fuel92.liters)   > 0 ? n(formData.fuel92.liters)   : (n(formData.fuel92.price)   > 0 ? t92 / n(formData.fuel92.price)   : 0);
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

    const totalDeductions = formData.expenses.reduce((s, i) => s + (i.txnType !== "payment" ? n(i.amount) : 0), 0);
    const totalIncome     = formData.expenses.reduce((s, i) => s + (i.txnType === "payment"  ? n(i.amount) : 0), 0);
    const totalExp        = totalDeductions - totalIncome; // net effect on expected cash
    const actualCash      = n(formData.actualCash);

    const payload: ShiftPayload = {
      employee_name: employeeName,
      employee_id: email,
      timestamp: formData.shiftDate ? new Date(formData.shiftDate).toISOString() : new Date().toISOString(),
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
        jelly_can_items:       jellyCanItems,
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

    if (!error) {
      // Push debt transactions for any linked expenses
      const linkedExpenses = formData.expenses.filter(e => e.profileId && n(e.amount) > 0);
      for (const expense of linkedExpenses) {
        const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
        const txnNum = `TXN-${d}-${Math.floor(Math.random() * 90000) + 10000}`;
        const paymentAmt = expense.txnType === "debt" ? n(expense.amount) : -n(expense.amount);

        await supabase.from("debt_transactions").insert({
          profile_id: expense.profileId,
          amount: paymentAmt,
          date: new Date().toISOString().slice(0, 10),
          note: `Payment via Daily Shift — ${employeeName}`,
          transaction_number: txnNum,
          source: "daily_app",
        });

        const { data: prof } = await supabase
          .from("debt_profiles")
          .select("current_balance, score")
          .eq("id", expense.profileId)
          .single();

        if (prof) {
          const newBalance = prof.current_balance + paymentAmt;
          const newScore = Math.min(100, (prof.score ?? 50) + 5);
          await supabase.from("debt_profiles").update({
            current_balance: newBalance,
            score: newScore,
            last_payment_at: new Date().toISOString(),
          }).eq("id", expense.profileId);
        }
      }
    }

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
    setScreen("mode-select");
  }

  return (
    <>
      {screen === "login"       && <LoginScreen onLogin={handleLogin} lang={lang} setLang={setLang} />}
      {screen === "checking"    && <CheckingScreen />}
      {screen === "denied"      && <DeniedScreen email={email} onBack={() => setScreen("login")} />}
      {screen === "mode-select" && (
        <ModeSelectScreen
          employeeName={employeeName}
          onShift={() => setScreen("form")}
          onReceipt={() => setScreen("receipt")}
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
              ⚠ {submitError}
            </div>
          )}
        </>
      )}
      {screen === "success"  && <SuccessScreen employeeName={employeeName} onNewShift={handleNewShift} />}
      {screen === "receipt"  && <CustomerReceiptScreen employeeName={employeeName} onBack={() => setScreen("mode-select")} />}
      {screen === "settings" && <AppSettingsScreen onBack={() => setScreen("mode-select")} />}
    </>
  );
}
