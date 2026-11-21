import { useState, useEffect, useMemo } from "react";
import {
  supabase, DebtProfile, DebtTransaction, DEBT_TABLES, RELATIONS, DebtRelation,
  NO_SCORE_RELATIONS,
  generateTxnNumber, repaymentSummary, fmtPercent, mmkFmt, formatPhone,
  getDisplayPhones, combineDateWithCurrentTime,
} from "@/lib/debt-supabase";
import { sortTransactionsChronological } from "@/lib/ledger";
import { debtPayoff } from "@/lib/debt-payoff";
import { sendCustomerStatement } from "@/lib/ledger-statement";
import { relationLabel, useDebtLang, useDebtT } from "@/lib/debt-i18n";
import DebtLangToggle from "@/components/debt-lang-toggle";
import { cacheDebtTransactions, getCachedDebtTransactions, useOnlineStatus } from "@/lib/offlineCache";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import {
  X, Plus, Trash2, Clock, User, Phone, CreditCard,
  AlertTriangle, CheckCircle, Loader2, Calendar, Pencil, ShieldAlert, BadgeAlert,
  Bookmark, MessageSquarePlus, TrendingDown, TrendingUp, WifiOff, Share2,
} from "lucide-react";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";
const LITERS_PER_GALLON = 4.54609;

async function triggerAlertCheck(profileId: string) {
  try {
    await fetch(`${API_BASE}/api/alert/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile_id: profileId }),
    });
  } catch {
    // background — silent
  }
}

type Props = {
  profile: DebtProfile;
  onClose: () => void;
  onUpdated: () => void;
  onProfileChange: (p: DebtProfile) => void;
};

/** Donut of how much of the debt has been repaid, with the total borrowed under it. */
function RepaymentChart({ amounts, balance }: { amounts: number[]; balance: number }) {
  const t = useDebtT();
  const r = repaymentSummary(amounts, balance);
  if (r.borrowed <= 0 && r.repaid <= 0) {
    return (
      <div className="bg-slate-50 border border-slate-100 rounded-xl p-4">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{t("repaymentProgress")}</p>
        <p className="text-sm text-slate-500 mt-2">{t("noDebtYet")}</p>
      </div>
    );
  }
  const done = r.remaining <= 0;
  const pct = fmtPercent(r.percent, r.remaining);
  const data = [
    { name: "repaid", value: Math.min(r.repaid, r.borrowed || r.repaid), color: "#10b981" },
    { name: "owed", value: r.remaining, color: "#ef4444" },
  ].filter(d => d.value > 0);
  return (
    <div className="bg-slate-50 border border-slate-100 rounded-xl p-4">
      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">{t("repaymentProgress")}</p>
      <div className="flex flex-col items-center">
        <div className="relative w-36 h-36" role="img" aria-label={t("ofTheDebtRepaid", { p: pct })}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" innerRadius={48} outerRadius={68} startAngle={90} endAngle={-270}
                paddingAngle={data.length > 1 ? 2 : 0} stroke="none" isAnimationActive={false}>
                {data.map(d => <Cell key={d.name} fill={d.color} />)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className={`text-2xl font-bold tabular-nums leading-none ${done ? "text-emerald-600" : "text-slate-900"}`}>{pct}</span>
            <span className="text-[11px] font-semibold text-slate-500 mt-1">{t("repaidWord")}</span>
          </div>
        </div>
        <p className="mt-2 text-sm text-slate-500">
          {t("total")} <span className="font-bold text-slate-900 tabular-nums">{mmkFmt(r.borrowed)}</span>
        </p>
        {r.overpaid > 0 && (
          <p className="text-xs text-pale-gold-foreground font-medium mt-1">{t("overpaidBy", { a: mmkFmt(r.overpaid) })}</p>
        )}
      </div>
    </div>
  );
}

function fmtDate(d: string) {
  if (!d) return "—";
  // Append local noon to prevent UTC-midnight timezone shift on date-only strings
  const safeStr = /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T12:00:00` : d;
  return new Date(safeStr).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}
function fmtDateTime(d: string) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-GB", {
    timeZone: "Asia/Yangon",
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
}

const inputCls = "w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-300/50 placeholder:text-slate-400";
const labelCls = "block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5";

export default function DebtProfileDetail({ profile, onClose, onUpdated, onProfileChange }: Props) {
  const t = useDebtT();
  const lang = useDebtLang();
  const [transactions, setTransactions] = useState<DebtTransaction[]>([]);
  const [loadingTxn, setLoadingTxn] = useState(true);

  // Balance immediately after each transaction, read chronologically — independent of the
  // table's own (newest-first) display order.
  const runningBalances = useMemo(() => {
    const map = new Map<string, number>();
    let running = 0;
    for (const t of sortTransactionsChronological(transactions)) {
      running += t.amount;
      map.set(t.id, running);
    }
    return map;
  }, [transactions]);

  // Payments pay off the oldest debt first; fully paid debt entries are crossed out.
  const payoff = useMemo(() => debtPayoff(transactions, profile.current_balance), [transactions, profile.current_balance]);

  function describe(txn: DebtTransaction): string {
    if (txn.note && txn.note.trim()) return txn.note.trim();
    if (txn.product_type && txn.liters) return `${txn.product_type} — ${txn.liters.toFixed(2)} L`;
    return txn.amount < 0 ? t("payment") : t("debtEntry");
  }

  const [txnAmount, setTxnAmount] = useState("");
  const [txnDate, setTxnDate] = useState(new Date().toISOString().slice(0, 10));
  const [txnNote, setTxnNote] = useState("");
  const [txnType, setTxnType] = useState<"payment" | "debt">("payment");
  const [submitting, setSubmitting] = useState(false);
  const [txnError, setTxnError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingHighlight, setTogglingHighlight] = useState<string | null>(null);
  const [remarkEditingId, setRemarkEditingId] = useState<string | null>(null);
  const [remarkDraft, setRemarkDraft] = useState("");

  // Fuel fields — only shown for non-Family/Own relations on debt entries
  const [fuelProduct, setFuelProduct] = useState<"92 RON" | "PD" | "95" | "HSD">("92 RON");
  const [fuelLitersInput, setFuelLitersInput] = useState("");
  const [fuelGallonsInput, setFuelGallonsInput] = useState("");
  const [fuelAmountInput, setFuelAmountInput] = useState("");
  const [fuelPriceInput, setFuelPriceInput] = useState("");
  const [fuelLastSource, setFuelLastSource] = useState<'total' | 'liters' | null>(null);

  const showFuelFields = !NO_SCORE_RELATIONS.has(profile.relation) && txnType === "debt";
  const fuelAmountNum = parseFloat(fuelAmountInput) || 0;
  const fuelLitersNum = parseFloat(fuelLitersInput) || 0;
  const fuelPriceNum  = parseFloat(fuelPriceInput)  || 0;

  function handleFuelLitersChange(val: string) {
    setFuelLitersInput(val);
    setFuelLastSource('liters');
    const liters = parseFloat(val);
    if (liters > 0) {
      setFuelGallonsInput((liters / LITERS_PER_GALLON).toFixed(4));
    } else if (val === "") {
      setFuelGallonsInput("");
    }
  }
  function handleFuelGallonsChange(val: string) {
    setFuelGallonsInput(val);
    setFuelLastSource('liters');
    const gallons = parseFloat(val);
    if (gallons > 0) {
      setFuelLitersInput((gallons * LITERS_PER_GALLON).toFixed(4));
    } else if (val === "") {
      setFuelLitersInput("");
    }
  }
  function handleFuelAmountChange(val: string) {
    setFuelAmountInput(val);
    setFuelLastSource('total');
  }
  function handleFuelPriceChange(val: string) {
    setFuelPriceInput(val);
    const price = parseFloat(val);
    if (price > 0) {
      if (fuelLastSource === 'total') {
        // User typed total first — preserve total, recalculate liters
        const amount = parseFloat(fuelAmountInput);
        if (amount > 0) {
          const calcLiters = amount / price;
          setFuelLitersInput(calcLiters.toFixed(3));
          setFuelGallonsInput((calcLiters / LITERS_PER_GALLON).toFixed(4));
        }
      } else {
        // User typed liters first (or no source yet) — preserve liters, recalculate total
        const liters = parseFloat(fuelLitersInput);
        if (liters > 0) {
          setFuelAmountInput((liters * price).toFixed(0));
        } else {
          // Fallback: no liters entered yet, derive from total if present
          const amount = parseFloat(fuelAmountInput);
          if (amount > 0) {
            const calcLiters = amount / price;
            setFuelLitersInput(calcLiters.toFixed(3));
            setFuelGallonsInput((calcLiters / LITERS_PER_GALLON).toFixed(4));
          }
        }
      }
    }
  }

  // ── Edit Transaction state ──────────────────────────────────────────────
  const [editingTxn, setEditingTxn] = useState<DebtTransaction | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editProduct, setEditProduct] = useState<"92 RON" | "PD" | "95" | "HSD">("92 RON");
  const [editLiters, setEditLiters] = useState("");
  const [editGallons, setEditGallons] = useState("");
  const [editPriceInput, setEditPriceInput] = useState("");
  const [editLastSource, setEditLastSource] = useState<'total' | 'liters' | null>(null);
  const [editTxnSaving, setEditTxnSaving] = useState(false);
  const [editTxnError, setEditTxnError] = useState("");

  const showEditFuelFields = editingTxn != null && !NO_SCORE_RELATIONS.has(profile.relation) && editingTxn.amount > 0;
  const editAmountNum = parseFloat(editAmount) || 0;
  const editLitersNum = parseFloat(editLiters) || 0;
  const editPriceNum  = parseFloat(editPriceInput) || 0;

  function handleEditLitersChange(val: string) {
    setEditLiters(val);
    setEditLastSource('liters');
    const liters = parseFloat(val);
    if (liters > 0) {
      setEditGallons((liters / LITERS_PER_GALLON).toFixed(4));
    } else if (val === "") {
      setEditGallons("");
    }
  }
  function handleEditGallonsChange(val: string) {
    setEditGallons(val);
    setEditLastSource('liters');
    const gallons = parseFloat(val);
    if (gallons > 0) {
      setEditLiters((gallons * LITERS_PER_GALLON).toFixed(4));
    } else if (val === "") {
      setEditLiters("");
    }
  }
  function handleEditAmountChange(val: string) {
    setEditAmount(val);
    setEditLastSource('total');
  }
  function handleEditPriceChange(val: string) {
    setEditPriceInput(val);
    const price = parseFloat(val);
    if (price > 0) {
      if (editLastSource === 'total') {
        // User typed total first — preserve total, recalculate liters
        const amount = parseFloat(editAmount);
        if (amount > 0) {
          const calcLiters = amount / price;
          setEditLiters(calcLiters.toFixed(3));
          setEditGallons((calcLiters / LITERS_PER_GALLON).toFixed(4));
        }
      } else {
        // User typed liters first (or no source yet) — preserve liters, recalculate total
        const liters = parseFloat(editLiters);
        if (liters > 0) {
          setEditAmount((liters * price).toFixed(0));
        } else {
          // Fallback: no liters entered yet, derive from total if present
          const amount = parseFloat(editAmount);
          if (amount > 0) {
            const calcLiters = amount / price;
            setEditLiters(calcLiters.toFixed(3));
            setEditGallons((calcLiters / LITERS_PER_GALLON).toFixed(4));
          }
        }
      }
    }
  }

  function openEditTxn(txn: DebtTransaction) {
    setEditingTxn(txn);
    setEditAmount(String(Math.abs(txn.amount)));
    setEditDate(txn.date ? txn.date.slice(0, 10) : new Date().toISOString().slice(0, 10));
    setEditNote(txn.note ?? "");
    setEditProduct((txn.product_type as "92 RON" | "PD" | "95" | "HSD") ?? "92 RON");
    setEditLiters(txn.liters != null ? String(txn.liters) : "");
    setEditGallons(txn.liters != null ? (txn.liters / LITERS_PER_GALLON).toFixed(4) : "");
    setEditPriceInput(txn.price_per_liter != null ? String(txn.price_per_liter) : "");
    setEditLastSource(null);
    setEditTxnError("");
  }

  async function handleSaveEditTxn(e: React.FormEvent) {
    e.preventDefault();
    if (!editingTxn) return;
    setEditTxnError("");
    if (editAmountNum <= 0) { setEditTxnError(t("enterAmount")); return; }

    // Timezone-safe timestamp: user's chosen date + exact local time at save
    const [yr, mo, dy] = editDate.split("-").map(Number);
    const ts = new Date(yr, mo - 1, dy);
    const now = new Date();
    ts.setHours(now.getHours());
    ts.setMinutes(now.getMinutes());
    ts.setSeconds(now.getSeconds());
    ts.setMilliseconds(0);
    const newTimestamp = ts.toISOString();

    const isDebt = editingTxn.amount > 0;
    const finalAmount = isDebt ? editAmountNum : -editAmountNum;
    const balanceDelta = finalAmount - editingTxn.amount;
    const newBalance = profile.current_balance + balanceDelta;

    setEditTxnSaving(true);
    const { error: updateErr } = await supabase.from(DEBT_TABLES.TRANSACTIONS).update({
      amount: finalAmount,
      date: newTimestamp,
      note: editNote.trim() || null,
      product_type: showEditFuelFields ? editProduct : null,
      price_per_liter: showEditFuelFields && editPriceNum > 0 ? editPriceNum : null,
      liters: showEditFuelFields && editLitersNum > 0 ? editLitersNum : null,
      gallons: showEditFuelFields && editLitersNum > 0 ? editLitersNum / LITERS_PER_GALLON : null,
    }).eq("id", editingTxn.id);

    if (updateErr) { setEditTxnError(updateErr.message); setEditTxnSaving(false); return; }

    await supabase.from(DEBT_TABLES.PROFILES).update({ current_balance: newBalance }).eq("id", profile.id);

    setEditTxnSaving(false);
    setEditingTxn(null);
    fetchTransactions();
    onProfileChange({ ...profile, current_balance: newBalance });
  }

  const [showEdit, setShowEdit] = useState(false);
  const [editName, setEditName] = useState("");
  const [editAge, setEditAge] = useState("");
  const [editRelation, setEditRelation] = useState<DebtRelation>(profile.relation);
  const [editPhones, setEditPhones] = useState<string[]>([""]);
  const [editCreditLimit, setEditCreditLimit] = useState("");
  const [editPaymentDueDate, setEditPaymentDueDate] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

  async function fetchTransactions() {
    const { data, error } = await supabase
      .from(DEBT_TABLES.TRANSACTIONS)
      .select("*")
      .eq("profile_id", profile.id)
      .order("date", { ascending: false });
    if (data) {
      setTransactions(data as DebtTransaction[]);
      cacheDebtTransactions(profile.id, data as DebtTransaction[]);
    } else if (error) {
      // Offline or request failed — fall back to whatever was last cached for this profile.
      setTransactions(getCachedDebtTransactions(profile.id));
    }
  }

  const isOnline = useOnlineStatus(fetchTransactions);

  useEffect(() => {
    setLoadingTxn(true);
    fetchTransactions().finally(() => setLoadingTxn(false));
  }, [profile.id]);

  async function handleAddTransaction(e: React.FormEvent) {
    e.preventDefault();
    setTxnError("");

    // ── Build a timezone-safe timestamp from the user's chosen date + current local time ──
    // Parse picker value as LOCAL integers to avoid UTC-midnight shift.
    const [year, month, day] = txnDate.split("-").map(Number);
    const finalTimestamp = new Date(year, month - 1, day); // local midnight
    const now = new Date();
    finalTimestamp.setHours(now.getHours());
    finalTimestamp.setMinutes(now.getMinutes());
    finalTimestamp.setSeconds(now.getSeconds());
    finalTimestamp.setMilliseconds(0);
    const txnTimestamp = finalTimestamp.toISOString(); // UTC equivalent of local time

    let amt: number;
    if (showFuelFields) {
      amt = fuelAmountNum;
      if (amt <= 0) {
        setTxnError(t("enterTotal"));
        return;
      }
    } else {
      amt = parseFloat(txnAmount);
      if (!amt || isNaN(amt) || amt <= 0) { setTxnError(t("enterAmount")); return; }
    }

    setSubmitting(true);

    const finalAmount = txnType === "payment" ? -amt : amt;
    const newBalance = profile.current_balance + finalAmount;
    const txnNum = generateTxnNumber();

    const { error: txnErr } = await supabase.from(DEBT_TABLES.TRANSACTIONS).insert({
      profile_id: profile.id,
      amount: finalAmount,
      date: txnTimestamp,
      note: txnNote.trim() || null,
      transaction_number: txnNum,
      source: "manual",
      product_type: showFuelFields ? fuelProduct : null,
      price_per_liter: showFuelFields && fuelPriceNum > 0 ? fuelPriceNum : null,
      liters: showFuelFields && fuelLitersNum > 0 ? fuelLitersNum : null,
      gallons: showFuelFields && fuelLitersNum > 0 ? fuelLitersNum / LITERS_PER_GALLON : null,
    });

    if (txnErr) { setTxnError(txnErr.message); setSubmitting(false); return; }

    const allTxns = [...transactions, {
      id: "", profile_id: profile.id, amount: finalAmount, date: txnTimestamp,
      note: txnNote, transaction_number: txnNum, source: "manual" as const,
      product_type: showFuelFields ? fuelProduct : null,
      price_per_liter: showFuelFields && fuelPriceNum > 0 ? fuelPriceNum : null,
      liters: showFuelFields && fuelLitersNum > 0 ? fuelLitersNum : null,
      gallons: showFuelFields && fuelLitersNum > 0 ? fuelLitersNum / LITERS_PER_GALLON : null,
      highlighted: false,
      created_at: new Date().toISOString(),
    }];
    const lastPayAt = txnType === "payment" ? new Date().toISOString() : profile.last_payment_at;

    await supabase.from(DEBT_TABLES.PROFILES).update({
      current_balance: newBalance,
      last_payment_at: lastPayAt,
    }).eq("id", profile.id);

    setTxnAmount("");
    setTxnNote("");
    setTxnType("payment");
    setFuelLitersInput("");
    setFuelGallonsInput("");
    setFuelAmountInput("");
    setFuelPriceInput("");
    setFuelLastSource(null);
    setSubmitting(false);

    const updated: DebtProfile = { ...profile, current_balance: newBalance, last_payment_at: lastPayAt ?? profile.last_payment_at };
    onProfileChange(updated);
    await fetchTransactions();

    triggerAlertCheck(profile.id);
  }

  async function handleDeleteTransaction(txn: DebtTransaction) {
    if (!window.confirm(t("confirmDeleteTxn", { n: txn.transaction_number }))) return;
    setDeletingId(txn.id);
    const newBalance = profile.current_balance - txn.amount;
    const { error } = await supabase.from(DEBT_TABLES.TRANSACTIONS).delete().eq("id", txn.id);
    if (error) { setDeletingId(null); return; }
    const remainingTxns = transactions.filter(t => t.id !== txn.id);
    const payments = remainingTxns.filter(t => t.amount < 0);
    const lastPay = payments.length > 0
      ? payments.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0].created_at
      : null;
    await supabase.from(DEBT_TABLES.PROFILES).update({ current_balance: newBalance, last_payment_at: lastPay }).eq("id", profile.id);
    const updated: DebtProfile = { ...profile, current_balance: newBalance, last_payment_at: lastPay };
    onProfileChange(updated);
    setDeletingId(null);
    await fetchTransactions();
  }

  async function handleToggleHighlight(txn: DebtTransaction) {
    setTogglingHighlight(txn.id);
    const newVal = !txn.highlighted;
    await supabase.from(DEBT_TABLES.TRANSACTIONS).update({ highlighted: newVal }).eq("id", txn.id);
    setTransactions(prev => prev.map(t => t.id === txn.id ? { ...t, highlighted: newVal } : t));
    setTogglingHighlight(null);
  }

  async function handleSaveRemark(txn: DebtTransaction) {
    const note = remarkDraft.trim() || null;
    await supabase.from(DEBT_TABLES.TRANSACTIONS).update({ note }).eq("id", txn.id);
    setTransactions(prev => prev.map(t => t.id === txn.id ? { ...t, note } : t));
    setRemarkEditingId(null);
  }

  function openEdit() {
    setEditName(profile.name);
    setEditAge(profile.age != null ? String(profile.age) : "");
    setEditRelation(profile.relation);
    const phones = getDisplayPhones(profile);
    setEditPhones(phones.length > 0 ? [...phones] : [""]);
    setEditCreditLimit(profile.credit_limit != null ? String(profile.credit_limit) : "");
    setEditPaymentDueDate(profile.payment_due_date ?? "");
    setEditError("");
    setShowEdit(true);
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editName.trim()) { setEditError(t("nameRequired")); return; }
    setEditSaving(true);
    setEditError("");

    const phones = editPhones.map(p => p.trim()).filter(Boolean);
    const newCreditLimit = editCreditLimit ? parseFloat(editCreditLimit) : null;
    const newDueDate = editPaymentDueDate || null;

    const updates: Partial<DebtProfile & { credit_alert_fired?: boolean; overdue_alert_fired?: boolean }> = {
      name: editName.trim(),
      age: editAge ? parseInt(editAge, 10) : null,
      relation: editRelation,
      phone_numbers: phones,
      phone_number: phones[0] || null,
      credit_limit: newCreditLimit,
      payment_due_date: newDueDate,
    };

    if (newCreditLimit != null && profile.current_balance <= newCreditLimit) {
      updates.credit_alert_fired = false;
    }
    if (newDueDate !== profile.payment_due_date) {
      updates.overdue_alert_fired = false;
    }

    const { error } = await supabase.from(DEBT_TABLES.PROFILES).update(updates).eq("id", profile.id);
    setEditSaving(false);
    if (error) { setEditError(error.message); return; }

    const updated: DebtProfile = { ...profile, ...updates } as DebtProfile;
    onProfileChange(updated);
    setShowEdit(false);
    onUpdated();
  }

  function addPhone() {
    if (editPhones.length < 3) setEditPhones(prev => [...prev, ""]);
  }
  function removePhone(idx: number) {
    setEditPhones(prev => prev.filter((_, i) => i !== idx));
  }
  function updatePhone(idx: number, val: string) {
    setEditPhones(prev => prev.map((p, i) => i === idx ? formatPhone(val) : p));
  }

  const isCleared = profile.current_balance <= 0;
  const today = new Date().toISOString().slice(0, 10);
  const isOverCreditLimit = profile.credit_limit != null && profile.current_balance > profile.credit_limit;
  const isPastDueDate = profile.payment_due_date != null && today > profile.payment_due_date && profile.current_balance > 0;
  const displayPhones = getDisplayPhones(profile);

  // Shared by the phone card list and the md+ table so both behave identically.
  // Plain render functions (not components) so the remark <input> keeps focus.
  function renderDescription(txn: DebtTransaction) {
    const isPayment = txn.amount < 0;
    const hasProductType = !isPayment && !!txn.product_type;
    const hasVolume = txn.liters != null && txn.liters > 0;
    if (remarkEditingId === txn.id) {
      return (
        <div className="flex items-center gap-1.5">
          <input
            autoFocus
            type="text"
            value={remarkDraft}
            onChange={e => setRemarkDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") handleSaveRemark(txn);
              if (e.key === "Escape") setRemarkEditingId(null);
            }}
            placeholder={t("addRemarkPh")}
            className="flex-1 min-w-0 bg-slate-100 border border-slate-200 text-slate-900 text-xs rounded-lg px-2.5 py-1 focus:outline-none focus:ring-1 focus:ring-amber-500/50 placeholder:text-slate-500"
          />
          <button
            onClick={() => handleSaveRemark(txn)}
            className="text-xs text-pale-gold-foreground hover:opacity-80 font-semibold px-2 py-1 rounded-lg hover:bg-pale-gold transition-all">
            {t("save")}
          </button>
          <button
            onClick={() => setRemarkEditingId(null)}
            aria-label={t("cancelRemark")}
            className="text-xs text-slate-400 hover:text-slate-700 px-1.5 py-1 rounded-lg hover:bg-slate-100 transition-all">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      );
    }
    return (
      <>
        <p className="text-slate-900 text-sm">{describe(txn)}</p>
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          {hasProductType && (
            <span className="text-[10px] font-bold text-pale-blue-foreground bg-pale-blue px-1.5 py-0.5 rounded">
              {txn.product_type}
            </span>
          )}
          {hasProductType && (hasVolume ? (
            <span className="text-[10px] text-slate-400">
              {txn.liters!.toLocaleString("en-US", { maximumFractionDigits: 3 })} L
              {txn.price_per_liter != null && (
                <> @ {new Intl.NumberFormat("en-US").format(txn.price_per_liter)}/L</>
              )}
            </span>
          ) : (
            <span className="text-[10px] text-slate-500 italic">{t("flatAmount")}</span>
          ))}
          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${txn.source === "daily_app" ? "text-pale-gold-foreground border-amber-100 bg-pale-gold" : "text-slate-500 border-slate-100"}`}>
            {txn.source === "daily_app" ? t("dailyApp") : t("manual")}
          </span>
          {txn.note ? (
            <button
              onClick={() => { setRemarkEditingId(txn.id); setRemarkDraft(txn.note ?? ""); }}
              title={t("editRemark")}
              className="flex items-center gap-0.5 text-[10px] text-pale-gold-foreground/80 hover:text-pale-gold-foreground transition-colors">
              <Pencil className="w-2.5 h-2.5" /> {t("editRemark")}
            </button>
          ) : (
            <button
              onClick={() => { setRemarkEditingId(txn.id); setRemarkDraft(""); }}
              className="flex items-center gap-0.5 text-[10px] text-slate-300 hover:text-slate-500 transition-colors">
              <MessageSquarePlus className="w-3 h-3" /> {t("remarkBtn")}
            </button>
          )}
        </div>
      </>
    );
  }

  // `touch` = phone card: larger tap targets (32px) than the desktop table (26px).
  function renderActions(txn: DebtTransaction, touch: boolean) {
    const isHighlighted = !!txn.highlighted;
    const pad = touch ? "p-2" : "p-1.5";
    const icon = touch ? "w-4 h-4" : "w-3.5 h-3.5";
    const idle = touch ? "text-slate-400" : "text-slate-300"; // no hover feedback on touch, so start darker
    return (
      <div className="flex items-center justify-end gap-1 shrink-0">
        <button
          type="button"
          onClick={() => handleToggleHighlight(txn)}
          disabled={togglingHighlight === txn.id}
          title={isHighlighted ? t("removeHighlight") : t("highlight")}
          aria-label={isHighlighted ? t("removeHighlight") : t("highlight")}
          className={`${pad} rounded-lg transition-all ${
            isHighlighted
              ? "text-pale-gold-foreground bg-pale-gold"
              : `${idle} hover:text-pale-gold-foreground hover:bg-pale-gold`
          }`}>
          {togglingHighlight === txn.id
            ? <Loader2 className={`${icon} animate-spin`} />
            : <Bookmark className={icon} fill={isHighlighted ? "currentColor" : "none"} />}
        </button>
        <button type="button" onClick={() => openEditTxn(txn)} title={t("editTxn")} aria-label={t("editTxn")}
          className={`${idle} hover:text-pale-blue-foreground hover:bg-pale-blue ${pad} rounded-lg transition-all`}>
          <Pencil className={icon} />
        </button>
        <button onClick={() => handleDeleteTransaction(txn)} disabled={deletingId === txn.id} title={t("deleteTxn")} aria-label={t("deleteTxn")}
          className={`${idle} hover:text-pale-red-foreground hover:bg-pale-red ${pad} rounded-lg transition-all`}>
          {deletingId === txn.id ? <Loader2 className={`${icon} animate-spin`} /> : <Trash2 className={icon} />}
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div className="relative w-full max-w-[520px] bg-white border-l border-slate-100 h-full overflow-y-auto shadow">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-start justify-between z-10">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-full bg-slate-100 flex items-center justify-center text-slate-200 font-bold text-lg">
              {profile.name[0].toUpperCase()}
            </div>
            <div>
              <h2 className="text-slate-900 font-bold text-base leading-tight">{profile.name}</h2>
              <p className="text-slate-500 text-xs">{t("createdOn", { relation: relationLabel(profile.relation, lang), date: fmtDate(profile.created_at) })}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <DebtLangToggle />
            {/* One tap: the whole statement as a PDF, straight to the share sheet (synchronous — sharing needs the tap). */}
            <button
              onClick={() => {
                try {
                  const today = new Date().toLocaleDateString("en-CA");   // local yyyy-mm-dd (UTC is still yesterday before 06:30 in Yangon)
                  sendCustomerStatement({
                    lang, name: profile.name, phones: displayPhones, transactions,
                    currentBalance: profile.current_balance, from: profile.date || null, to: today,
                  });
                } catch {
                  window.alert(t("pdfFailed"));
                }
              }}
              disabled={loadingTxn}
              title={t("sendStatement")} aria-label={t("sendStatement")}
              className="text-emerald-600 hover:text-emerald-700 p-1.5 rounded-lg hover:bg-emerald-50 disabled:opacity-40 transition-colors">
              <Share2 className="w-4 h-4" />
            </button>
            <button onClick={openEdit} title={t("editProfile")} aria-label={t("editProfile")}
              className="text-slate-400 hover:text-slate-900 p-1.5 rounded-lg hover:bg-slate-100 transition-colors">
              <Pencil className="w-4 h-4" />
            </button>
            <button onClick={onClose} aria-label={t("closePanel")}
              className="text-slate-500 hover:text-slate-900 p-1.5 rounded-lg hover:bg-slate-100 transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {!isOnline && (
            <div className="flex items-center gap-2 bg-pale-gold border border-amber-100 rounded-xl px-4 py-2.5 text-sm text-pale-gold-foreground font-medium">
              <WifiOff className="w-4 h-4 shrink-0" />
              {t("offlineDetail")}
            </div>
          )}

          {/* Status banners */}
          {isCleared && (
            <div className="flex items-center gap-3 bg-pale-green border border-emerald-100 rounded-xl px-4 py-3">
              <CheckCircle className="w-5 h-5 text-pale-green-foreground shrink-0" />
              <p className="text-pale-green-foreground font-semibold text-sm">{t("debtCleared")}</p>
            </div>
          )}

          {/* Violation alerts */}
          {(isOverCreditLimit || isPastDueDate) && (
            <div className="space-y-2">
              {isOverCreditLimit && (
                <div className="flex items-start gap-3 bg-pale-gold border border-amber-100 rounded-xl px-4 py-3">
                  <BadgeAlert className="w-5 h-5 text-pale-gold-foreground shrink-0 mt-0.5" />
                  <div>
                    <p className="text-pale-gold-foreground font-semibold text-sm">{t("creditExceeded")}</p>
                    <p className="text-pale-gold-foreground/80 text-xs mt-0.5">
                      {t("creditExceededBody", { b: mmkFmt(profile.current_balance), l: mmkFmt(profile.credit_limit) })}
                    </p>
                  </div>
                </div>
              )}
              {isPastDueDate && (
                <div className="flex items-start gap-3 bg-pale-red border border-red-100 rounded-xl px-4 py-3">
                  <ShieldAlert className="w-5 h-5 text-pale-red-foreground shrink-0 mt-0.5" />
                  <div>
                    <p className="text-pale-red-foreground font-semibold text-sm">{t("overdue")}</p>
                    <p className="text-pale-red-foreground/80 text-xs mt-0.5">{t("overdueBody", { d: fmtDate(profile.payment_due_date!) })}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Profile info */}
          <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 space-y-2.5">
            <div className="flex justify-between text-sm">
              <span className="text-slate-400 flex items-center gap-1.5"><User className="w-3 h-3" /> {t("name")}</span>
              <span className="text-slate-900 font-semibold">{profile.name}</span>
            </div>
            {profile.age != null && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">{t("age")}</span>
                <span className="text-slate-900 font-medium">{profile.age}</span>
              </div>
            )}
            {displayPhones.length > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-400 flex items-center gap-1.5"><Phone className="w-3 h-3" /> {t("phone")}</span>
                <div className="text-right space-y-0.5">
                  {displayPhones.map((ph, i) => (
                    <p key={i} className="text-slate-900 font-medium">{ph}{i === 0 && displayPhones.length > 1 ? t("primarySuffix") : ""}</p>
                  ))}
                </div>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-slate-400 flex items-center gap-1.5"><CreditCard className="w-3 h-3" /> {t("currentBalance")}</span>
              <span className={`font-bold tabular-nums flex items-center gap-1 ${isCleared ? "text-pale-green-foreground" : "text-pale-red-foreground"}`}>
                {isCleared ? <><CheckCircle className="w-3.5 h-3.5" /> {t("cleared")}</> : mmkFmt(profile.current_balance)}
              </span>
            </div>
            {profile.total_debt != null && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">{t("originalDebt")}</span>
                <span className="text-slate-700 tabular-nums">{mmkFmt(profile.total_debt)}</span>
              </div>
            )}
            {profile.credit_limit != null && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">{t("creditLimit")}</span>
                <span className={`font-semibold tabular-nums ${isOverCreditLimit ? "text-pale-gold-foreground" : "text-slate-700"}`}>
                  {mmkFmt(profile.credit_limit)}
                </span>
              </div>
            )}
            {profile.payment_due_date && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-400 flex items-center gap-1.5"><Calendar className="w-3 h-3" /> {t("paymentDue")}</span>
                <span className={`font-semibold ${isPastDueDate ? "text-pale-red-foreground" : "text-slate-700"}`}>
                  {fmtDate(profile.payment_due_date)}
                </span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-slate-400 flex items-center gap-1.5"><Clock className="w-3 h-3" /> {t("lastPayment")}</span>
              <span className="text-slate-700">{profile.last_payment_at ? fmtDate(profile.last_payment_at) : t("noPaymentsYet")}</span>
            </div>
          </div>

          {/* How much of the debt has been repaid */}
          {loadingTxn ? (
            <div className="bg-slate-50 border border-slate-100 rounded-xl h-40 animate-pulse" aria-hidden="true" />
          ) : (
            <RepaymentChart amounts={transactions.map(t => t.amount)} balance={profile.current_balance} />
          )}

          {/* Add Transaction */}
          <div className="bg-slate-50 border border-slate-100 rounded-xl p-4">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">{t("recordTransaction")}</p>
            <form onSubmit={handleAddTransaction} className="space-y-3">
              {/* Type toggle */}
              <div className="flex gap-2">
                <button type="button" onClick={() => setTxnType("payment")}
                  className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all flex items-center justify-center gap-1 ${txnType === "payment" ? "bg-pale-green border-emerald-200 text-pale-green-foreground" : "bg-white border-slate-100 text-slate-500 hover:text-slate-700"}`}>
                  <TrendingDown className="w-3.5 h-3.5 shrink-0" /> {t("paymentReduces")}
                </button>
                <button type="button" onClick={() => setTxnType("debt")}
                  className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all flex items-center justify-center gap-1 ${txnType === "debt" ? "bg-pale-red border-red-200 text-pale-red-foreground" : "bg-white border-slate-100 text-slate-500 hover:text-slate-700"}`}>
                  <TrendingUp className="w-3.5 h-3.5 shrink-0" /> {t("newDebtAdds")}
                </button>
              </div>

              {/* ── Fuel fields: only for non-Family/Own debt entries ── */}
              {showFuelFields ? (
                <>
                  {/* Product type */}
                  <div>
                    <label className="text-xs text-slate-500 font-semibold uppercase tracking-wider block mb-1">{t("productType")}</label>
                    <select value={fuelProduct} onChange={e => setFuelProduct(e.target.value as typeof fuelProduct)}
                      className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300/50">
                      <option value="92 RON">92 RON</option>
                      <option value="PD">{t("productPD")}</option>
                      <option value="95">95 RON</option>
                      <option value="HSD">{t("productHSD")}</option>
                    </select>
                  </div>

                  {/* Total Amount */}
                  <div>
                    <label className="text-xs text-slate-500 font-semibold uppercase tracking-wider block mb-1">{t("totalAmountMMK")}</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">K</span>
                      <input type="text" inputMode="decimal" value={fuelAmountInput} onChange={e => handleFuelAmountChange(e.target.value)}
                        placeholder="0"
                        className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-xl pl-7 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300/50 placeholder:text-slate-400" />
                    </div>
                  </div>

                  {/* Liters & Gallons — cross-calculating */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-slate-500 font-semibold uppercase tracking-wider block mb-1">{t("liters")}</label>
                      <input type="text" inputMode="decimal" value={fuelLitersInput}
                        onChange={e => handleFuelLitersChange(e.target.value)}
                        placeholder="0.000"
                        className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300/50 placeholder:text-slate-400" />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500 font-semibold uppercase tracking-wider block mb-1">{t("gallons")}</label>
                      <input type="text" inputMode="decimal" value={fuelGallonsInput}
                        onChange={e => handleFuelGallonsChange(e.target.value)}
                        placeholder="0.0000"
                        className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300/50 placeholder:text-slate-400" />
                    </div>
                  </div>

                  {/* Price Per Liter — user-entered, optional */}
                  <div>
                    <label className="text-xs text-slate-500 font-semibold uppercase tracking-wider block mb-1">
                      {t("pricePerLiter")}
                      <span className="ml-1.5 normal-case font-normal text-slate-600">{t("optional")}</span>
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">K</span>
                      <input type="text" inputMode="decimal" value={fuelPriceInput}
                        onChange={e => handleFuelPriceChange(e.target.value)}
                        placeholder={t("egPrice")}
                        className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-xl pl-7 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300/50 placeholder:text-slate-400" />
                    </div>
                  </div>
                </>
              ) : (
                /* ── Simple amount field: payments OR Family/Own debts ── */
                <div className="grid grid-cols-2 gap-3">
                  <div className="min-w-0">
                    <label className="text-xs text-slate-500 font-semibold uppercase tracking-wider block mb-1">{t("amount")}</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">K</span>
                      <input type="number" value={txnAmount} onChange={e => setTxnAmount(e.target.value)}
                        placeholder="0" min="0"
                        className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-xl pl-7 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300/50 placeholder:text-slate-400"
                        required />
                    </div>
                  </div>
                  <div className="min-w-0">
                    <label className="text-xs text-slate-500 font-semibold uppercase tracking-wider block mb-1">{t("date")}</label>
                    <input type="date" value={txnDate} onChange={e => setTxnDate(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300/50" />
                  </div>
                </div>
              )}

              {/* Date — shown below fuel fields */}
              {showFuelFields && (
                <div>
                  <label className="text-xs text-slate-500 font-semibold uppercase tracking-wider block mb-1">{t("date")}</label>
                  <input type="date" value={txnDate} onChange={e => setTxnDate(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300/50" />
                </div>
              )}

              {/* Remarks / note */}
              <div>
                <label className="text-xs text-slate-500 font-semibold uppercase tracking-wider block mb-1">
                  {showFuelFields ? t("remarks") : t("note")} <span className="normal-case font-normal">{t("optional")}</span>
                </label>
                <input type="text" value={txnNote} onChange={e => setTxnNote(e.target.value)}
                  placeholder={showFuelFields ? t("remarksPh") : t("notePh")}
                  className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300/50 placeholder:text-slate-400" />
              </div>

              {txnError && (
                <p className="text-xs text-red-500 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {txnError}</p>
              )}
              <button type="submit" disabled={submitting}
                className={`w-full py-2.5 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 ${txnType === "payment" ? "bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50" : "bg-red-700 hover:bg-red-600 text-white disabled:opacity-50"}`}>
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                {submitting ? t("saving") : txnType === "payment" ? t("recordPayment") : t("addDebt")}
              </button>
            </form>
          </div>

          {/* Transaction History */}
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
              <Clock className="w-3.5 h-3.5" /> {t("txnHistory")}
            </p>
            {loadingTxn ? (
              <div className="py-8 text-center"><Loader2 className="w-6 h-6 text-blue-500/50 animate-spin mx-auto" /></div>
            ) : transactions.length === 0 ? (
              <div className="bg-slate-50 border border-slate-100 rounded-xl p-6 text-center">
                <p className="text-slate-500 text-sm">{t("noTxns")}</p>
              </div>
            ) : (
              <>
                {/* Phones: one card per transaction, so date, amount, balance and
                    actions are all visible without scrolling sideways. */}
                <div className="md:hidden bg-slate-50 border border-slate-100 rounded-xl overflow-hidden divide-y divide-slate-100">
                  {transactions.map(txn => {
                    const isPayment = txn.amount < 0;
                    const isHighlighted = !!txn.highlighted;
                    const balance = runningBalances.get(txn.id) ?? 0;
                    const po = payoff.get(txn.id);
                    return (
                      <div key={txn.id} className={`px-4 py-3 ${isHighlighted ? "bg-amber-400/[0.05] border-l-[3px] border-amber-400" : ""}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-slate-600 text-xs">{fmtDateTime(txn.date)}</p>
                            <p className="text-slate-500 text-[10px] font-mono mt-0.5 break-all">{txn.transaction_number}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className={`text-sm font-bold tabular-nums whitespace-nowrap ${isPayment ? "text-pale-green-foreground" : po?.paidOff ? "text-slate-400 line-through decoration-2" : "text-pale-red-foreground"}`}>
                              {isPayment ? "−" : "+"}{mmkFmt(Math.abs(txn.amount))}
                            </p>
                            {po?.paidOff ? (
                              <p className="text-[10px] font-bold text-emerald-600 mt-0.5 flex items-center justify-end gap-0.5">
                                <CheckCircle className="w-3 h-3" /> {t("paidOff")}
                              </p>
                            ) : po?.partly ? (
                              <p className="text-[10px] font-semibold text-pale-red-foreground mt-0.5 whitespace-nowrap">{t("leftAmt", { a: mmkFmt(po.left) })}</p>
                            ) : (
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mt-0.5">
                                {isPayment ? t("creditLabel") : t("debitLabel")}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className={`mt-2 break-words ${po?.paidOff ? "opacity-60" : ""}`}>{renderDescription(txn)}</div>
                        <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                          <p className="text-xs text-slate-500">
                            {t("balance")}{" "}
                            <span className={`font-semibold tabular-nums whitespace-nowrap ${balance > 0 ? "text-pale-red-foreground" : "text-pale-green-foreground"}`}>
                              {mmkFmt(balance)}
                            </span>
                          </p>
                          {renderActions(txn, true)}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* md+: the full ledger table. */}
                <div className="hidden md:block bg-slate-50 border border-slate-100 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-sm border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-100">
                        <th className="px-4 py-2.5 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">{t("date")}</th>
                        <th className="px-4 py-2.5 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">{t("description")}</th>
                        <th className="px-4 py-2.5 text-right text-[11px] font-bold text-slate-400 uppercase tracking-wider">{t("debitLabel")}</th>
                        <th className="px-4 py-2.5 text-right text-[11px] font-bold text-slate-400 uppercase tracking-wider">{t("creditLabel")}</th>
                        <th className="px-4 py-2.5 text-right text-[11px] font-bold text-slate-400 uppercase tracking-wider">{t("balance")}</th>
                        <th className="px-4 py-2.5 text-right text-[11px] font-bold text-slate-400 uppercase tracking-wider">{t("actions")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {transactions.map(txn => {
                        const isPayment = txn.amount < 0;
                        const isHighlighted = !!txn.highlighted;
                        const balance = runningBalances.get(txn.id) ?? 0;
                        const po = payoff.get(txn.id);
                        return (
                          <tr key={txn.id} className={`align-top transition-colors ${isHighlighted ? "bg-amber-400/[0.05] border-l-[3px] border-amber-400" : "hover:bg-slate-50"}`}>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <p className="text-slate-600 text-xs">{fmtDateTime(txn.date)}</p>
                              <p className="text-slate-600 text-[10px] font-mono mt-0.5">{txn.transaction_number}</p>
                            </td>
                            <td className="px-4 py-3 min-w-[220px]">
                              {renderDescription(txn)}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap text-pale-red-foreground">
                              {!isPayment && (
                                <>
                                  <span className={po?.paidOff ? "text-slate-400 line-through decoration-2" : ""}>{mmkFmt(txn.amount)}</span>
                                  {po?.paidOff ? (
                                    <p className="text-[10px] font-bold text-emerald-600 mt-0.5">✓ {t("paidOff")}</p>
                                  ) : po?.partly ? (
                                    <p className="text-[10px] font-semibold mt-0.5">{t("leftAmt", { a: mmkFmt(po.left) })}</p>
                                  ) : null}
                                </>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap text-pale-green-foreground">
                              {isPayment ? mmkFmt(-txn.amount) : ""}
                            </td>
                            <td className={`px-4 py-3 text-right tabular-nums whitespace-nowrap font-semibold ${balance > 0 ? "text-pale-red-foreground" : "text-pale-green-foreground"}`}>
                              {mmkFmt(balance)}
                            </td>
                            <td className="px-4 py-3">
                              {renderActions(txn, false)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Edit Transaction Modal */}
      {editingTxn && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70" onClick={() => setEditingTxn(null)} />
          <div className="relative bg-white border border-slate-100 rounded-xl w-full max-w-md shadow max-h-[92vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-widest font-semibold">{t("transaction")}</p>
                <h3 className="text-slate-900 font-bold text-base">{t("editEntry")}</h3>
              </div>
              <button type="button" onClick={() => setEditingTxn(null)} aria-label={t("close")} className="text-slate-500 hover:text-slate-900 p-1.5 rounded-lg hover:bg-slate-100 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEditTxn} className="overflow-y-auto p-6 space-y-4">
              {/* Total Amount */}
              <div>
                <label className={labelCls}>{t("totalAmountMMK")} <span className="text-red-500">*</span></label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">K</span>
                  <input type="text" inputMode="decimal" value={editAmount} onChange={e => handleEditAmountChange(e.target.value)}
                    placeholder="0" className={inputCls.replace("px-4", "pl-7")} required />
                </div>
              </div>

              {/* Date */}
              <div>
                <label className={labelCls}>{t("date")}</label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" />
                  <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)}
                    className={inputCls.replace("px-4", "pl-9")} />
                </div>
              </div>

              {/* Fuel fields — hidden for Family/Own or payment entries */}
              {showEditFuelFields && (
                <>
                  <div>
                    <label className={labelCls}>{t("productType")}</label>
                    <select value={editProduct} onChange={e => setEditProduct(e.target.value as typeof editProduct)}
                      className={inputCls}>
                      <option value="92 RON">92 RON</option>
                      <option value="PD">{t("productPD")}</option>
                      <option value="95">95 RON</option>
                      <option value="HSD">{t("productHSD")}</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>{t("liters")}</label>
                      <input type="text" inputMode="decimal" value={editLiters} onChange={e => handleEditLitersChange(e.target.value)}
                        placeholder="0.000" className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>{t("gallons")}</label>
                      <input type="text" inputMode="decimal" value={editGallons} onChange={e => handleEditGallonsChange(e.target.value)}
                        placeholder="0.0000" className={inputCls} />
                    </div>
                  </div>

                  <div>
                    <label className={labelCls}>
                      {t("pricePerLiter")}
                      <span className="ml-1.5 normal-case font-normal text-slate-600">{t("optional")}</span>
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">K</span>
                      <input type="text" inputMode="decimal" value={editPriceInput}
                        onChange={e => handleEditPriceChange(e.target.value)}
                        placeholder={t("egPrice")}
                        className={inputCls.replace("px-4", "pl-7")} />
                    </div>
                  </div>
                </>
              )}

              {/* Remarks */}
              <div>
                <label className={labelCls}>{t("remarks")} <span className="text-slate-600 normal-case font-normal">{t("optional")}</span></label>
                <input type="text" value={editNote} onChange={e => setEditNote(e.target.value)}
                  placeholder={t("remarksPh")} className={inputCls} />
              </div>

              {editTxnError && (
                <p className="text-xs text-red-500 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> {editTxnError}
                </p>
              )}

              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setEditingTxn(null)}
                  className="flex-1 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-semibold rounded-xl py-2.5 text-sm transition-all">
                  {t("cancel")}
                </button>
                <button type="submit" disabled={editTxnSaving}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold rounded-xl py-2.5 text-sm transition-all flex items-center justify-center gap-2">
                  {editTxnSaving ? <><Loader2 className="w-4 h-4 animate-spin" /> {t("saving")}</> : t("saveChanges")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Profile Modal */}
      {showEdit && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70" onClick={() => setShowEdit(false)} />
          <div className="relative bg-white border border-slate-100 rounded-xl w-full max-w-md shadow max-h-[92vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-widest font-semibold">{t("profile")}</p>
                <h3 className="text-slate-900 font-bold text-base">{t("editDetails")}</h3>
              </div>
              <button onClick={() => setShowEdit(false)} aria-label={t("close")} className="text-slate-500 hover:text-slate-900 p-1.5 rounded-lg hover:bg-slate-100 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="overflow-y-auto p-6 space-y-5">
              {/* Name */}
              <div>
                <label className={labelCls}>{t("name")} <span className="text-red-500">*</span></label>
                <input type="text" value={editName} onChange={e => setEditName(e.target.value)}
                  placeholder={t("namePh")} className={inputCls} required />
              </div>

              {/* Age */}
              <div>
                <label className={labelCls}>{t("age")} <span className="text-slate-600 normal-case font-normal">{t("optional")}</span></label>
                <input type="number" value={editAge} onChange={e => setEditAge(e.target.value)}
                  placeholder={t("egAge")} min="1" max="120" className={inputCls} />
              </div>

              {/* Relation */}
              <div>
                <label className={labelCls}>{t("relation")}</label>
                <select value={editRelation} onChange={e => setEditRelation(e.target.value as DebtRelation)}
                  className={inputCls}>
                  {RELATIONS.map(r => <option key={r} value={r}>{relationLabel(r, lang)}</option>)}
                </select>
              </div>

              {/* Phone Numbers */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className={labelCls + " mb-0"}>
                    {t("phoneNumbers")}
                    <span className="text-slate-600 normal-case font-normal ml-1">{t("upTo3")}</span>
                  </label>
                  {editPhones.length < 3 && (
                    <button type="button" onClick={addPhone}
                      className="flex items-center gap-1 text-xs text-pale-blue-foreground hover:opacity-80 font-semibold transition-colors">
                      <Plus className="w-3 h-3" /> {t("add")}
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  {editPhones.map((ph, idx) => (
                    <div key={idx} className="flex gap-2 items-center">
                      <div className="relative flex-1">
                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-600" />
                        <input
                          type="tel"
                          value={ph}
                          onChange={e => updatePhone(idx, e.target.value)}
                          placeholder="09-000000000"
                          maxLength={13}
                          className={`${inputCls} pl-9`}
                          required={idx === 0}
                        />
                        {idx === 0 && (
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-600 font-semibold uppercase">{t("primary")}</span>
                        )}
                      </div>
                      {idx > 0 && (
                        <button type="button" onClick={() => removePhone(idx)}
                          aria-label={t("removePhone", { n: idx + 1 })}
                          className="text-slate-300 hover:text-pale-red-foreground hover:bg-pale-red p-2 rounded-lg transition-all shrink-0">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Credit Limit */}
              <div>
                <label className={labelCls}>
                  {t("creditLimit")}
                  <span className="text-slate-600 normal-case font-normal ml-1">{t("noLimitHint")}</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm font-medium select-none">K</span>
                  <input type="number" value={editCreditLimit} onChange={e => setEditCreditLimit(e.target.value)}
                    placeholder={t("noLimitPh")} min="0"
                    className={`${inputCls} pl-8`} />
                </div>
                <p className="text-xs text-slate-600 mt-1">{t("creditLimitHelp")}</p>
              </div>

              {/* Payment Due Date */}
              <div>
                <label className={labelCls}>
                  {t("dueDate")}
                  <span className="text-slate-600 normal-case font-normal ml-1">{t("optional")}</span>
                </label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" />
                  <input type="date" value={editPaymentDueDate} onChange={e => setEditPaymentDueDate(e.target.value)}
                    className={`${inputCls} pl-9`} />
                </div>
                <p className="text-xs text-slate-600 mt-1">{t("dueHelp")}</p>
              </div>

              {editError && (
                <div className="flex items-start gap-2 bg-pale-red border border-red-100 rounded-xl px-4 py-3 text-xs text-pale-red-foreground">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {editError}
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setShowEdit(false)}
                  className="flex-1 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-semibold rounded-xl py-2.5 text-sm transition-all">
                  {t("cancel")}
                </button>
                <button type="submit" disabled={editSaving}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold rounded-xl py-2.5 text-sm transition-all flex items-center justify-center gap-2">
                  {editSaving ? <><Loader2 className="w-4 h-4 animate-spin" /> {t("saving")}</> : t("saveChanges")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
