import { useState, useEffect } from "react";
import {
  supabase, DebtProfile, DebtTransaction, DEBT_TABLES, RELATIONS, DebtRelation,
  NO_SCORE_RELATIONS,
  generateTxnNumber, calculateScore, scoreColor, scoreTier, mmkFmt, formatPhone,
  getDisplayPhones, combineDateWithCurrentTime,
} from "@/lib/debt-supabase";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import {
  X, Plus, Trash2, Clock, User, Phone, CreditCard,
  AlertTriangle, CheckCircle, Loader2, Calendar, Pencil, ShieldAlert, BadgeAlert,
  Bookmark, MessageSquarePlus,
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

function ScoreGauge({ score }: { score: number }) {
  const r = 40, cx = 60, cy = 55;
  const semi = Math.PI * r;
  const progress = (score / 100) * semi;
  const color = scoreColor(score);
  const tier = scoreTier(score);
  return (
    <div className="flex flex-col items-center gap-1">
      <svg viewBox="0 0 120 72" className="w-36 h-24">
        <path d={`M 20 55 A 40 40 0 0 1 100 55`} fill="none" stroke="#1e293b" strokeWidth="12" strokeLinecap="round" />
        <path d={`M 20 55 A 40 40 0 0 1 100 55`} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round"
          strokeDasharray={`${progress} ${semi}`} />
        <text x={cx} y={52} textAnchor="middle" fill="white" fontSize="18" fontWeight="700">{score}</text>
        <text x={cx} y={66} textAnchor="middle" fill={color} fontSize="9" fontWeight="600">{tier.toUpperCase()}</text>
      </svg>
      <p className="text-xs text-slate-500">Trust & Repayment Score</p>
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

const inputCls = "w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/50 placeholder:text-slate-600";
const labelCls = "block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5";

export default function DebtProfileDetail({ profile, onClose, onUpdated, onProfileChange }: Props) {
  const [transactions, setTransactions] = useState<DebtTransaction[]>([]);
  const [loadingTxn, setLoadingTxn] = useState(true);

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
    if (editAmountNum <= 0) { setEditTxnError("Enter a valid amount."); return; }

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
    const { data } = await supabase
      .from(DEBT_TABLES.TRANSACTIONS)
      .select("*")
      .eq("profile_id", profile.id)
      .order("date", { ascending: false });
    if (data) setTransactions(data as DebtTransaction[]);
  }

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
        setTxnError("Enter a Total Amount.");
        return;
      }
    } else {
      amt = parseFloat(txnAmount);
      if (!amt || isNaN(amt) || amt <= 0) { setTxnError("Enter a valid amount."); return; }
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
    const newScore = calculateScore(allTxns, newBalance);
    const lastPayAt = txnType === "payment" ? new Date().toISOString() : profile.last_payment_at;

    await supabase.from(DEBT_TABLES.PROFILES).update({
      current_balance: newBalance,
      score: newScore,
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

    const updated: DebtProfile = { ...profile, current_balance: newBalance, score: newScore, last_payment_at: lastPayAt ?? profile.last_payment_at };
    onProfileChange(updated);
    await fetchTransactions();

    triggerAlertCheck(profile.id);
  }

  async function handleDeleteTransaction(txn: DebtTransaction) {
    if (!window.confirm(`Delete transaction ${txn.transaction_number}?\nThis will reverse its effect on the balance.`)) return;
    setDeletingId(txn.id);
    const newBalance = profile.current_balance - txn.amount;
    const { error } = await supabase.from(DEBT_TABLES.TRANSACTIONS).delete().eq("id", txn.id);
    if (error) { setDeletingId(null); return; }
    const remainingTxns = transactions.filter(t => t.id !== txn.id);
    const newScore = calculateScore(remainingTxns, newBalance);
    const payments = remainingTxns.filter(t => t.amount < 0);
    const lastPay = payments.length > 0
      ? payments.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0].created_at
      : null;
    await supabase.from(DEBT_TABLES.PROFILES).update({ current_balance: newBalance, score: newScore, last_payment_at: lastPay }).eq("id", profile.id);
    const updated: DebtProfile = { ...profile, current_balance: newBalance, score: newScore, last_payment_at: lastPay };
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
    if (!editName.trim()) { setEditError("Name is required."); return; }
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

  const paid = Math.max(0, (profile.total_debt ?? 0) - Math.max(0, profile.current_balance));
  const remaining = Math.max(0, profile.current_balance);
  const hasPieData = (profile.total_debt ?? 0) > 0;
  const pieData = hasPieData
    ? [{ name: "Paid", value: paid, color: "#10b981" }, { name: "Remaining", value: remaining, color: "#ef4444" }]
    : [];

  const isCleared = profile.current_balance <= 0;
  const isHighRisk = profile.score < 40;
  const today = new Date().toISOString().slice(0, 10);
  const isOverCreditLimit = profile.credit_limit != null && profile.current_balance > profile.credit_limit;
  const isPastDueDate = profile.payment_due_date != null && today > profile.payment_due_date && profile.current_balance > 0;
  const displayPhones = getDisplayPhones(profile);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div className="relative w-full max-w-[520px] bg-[#0f1623] border-l border-slate-700/50 h-full overflow-y-auto shadow">
        {/* Header */}
        <div className="sticky top-0 bg-[#0f1623] border-b border-slate-700/50 px-6 py-4 flex items-start justify-between z-10">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-full bg-slate-700 flex items-center justify-center text-slate-200 font-bold text-lg">
              {profile.name[0].toUpperCase()}
            </div>
            <div>
              <h2 className="text-white font-bold text-base leading-tight">{profile.name}</h2>
              <p className="text-slate-500 text-xs">{profile.relation} · Created {fmtDate(profile.created_at)}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <button onClick={openEdit} title="Edit Profile"
              className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-700/50 transition-colors">
              <Pencil className="w-4 h-4" />
            </button>
            <button onClick={onClose}
              className="text-slate-500 hover:text-white p-1.5 rounded-lg hover:bg-slate-700/50 transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Status banners */}
          {isCleared ? (
            <div className="flex items-center gap-3 bg-emerald-900/30 border border-emerald-700/50 rounded-xl px-4 py-3">
              <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" />
              <p className="text-emerald-300 font-semibold text-sm">Debt fully cleared</p>
            </div>
          ) : (isHighRisk && !NO_SCORE_RELATIONS.has(profile.relation)) ? (
            <div className="flex items-center gap-3 bg-red-900/30 border border-red-700/50 rounded-xl px-4 py-3">
              <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
              <p className="text-red-300 font-semibold text-sm">High Risk — Low repayment activity</p>
            </div>
          ) : null}

          {/* Violation alerts */}
          {(isOverCreditLimit || isPastDueDate) && (
            <div className="space-y-2">
              {isOverCreditLimit && (
                <div className="flex items-start gap-3 bg-amber-900/30 border border-amber-700/50 rounded-xl px-4 py-3">
                  <BadgeAlert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-amber-300 font-semibold text-sm">Credit Limit Exceeded</p>
                    <p className="text-amber-400/70 text-xs mt-0.5">
                      Balance {mmkFmt(profile.current_balance)} exceeds limit of {mmkFmt(profile.credit_limit)}
                    </p>
                  </div>
                </div>
              )}
              {isPastDueDate && (
                <div className="flex items-start gap-3 bg-red-900/30 border border-red-700/50 rounded-xl px-4 py-3">
                  <ShieldAlert className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-red-300 font-semibold text-sm">Payment Overdue</p>
                    <p className="text-red-400/70 text-xs mt-0.5">Due date {fmtDate(profile.payment_due_date!)} has passed</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Profile info */}
          <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-4 space-y-2.5">
            <div className="flex justify-between text-sm">
              <span className="text-slate-400 flex items-center gap-1.5"><User className="w-3 h-3" /> Name</span>
              <span className="text-white font-semibold">{profile.name}</span>
            </div>
            {profile.age != null && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Age</span>
                <span className="text-white font-medium">{profile.age}</span>
              </div>
            )}
            {displayPhones.length > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-400 flex items-center gap-1.5"><Phone className="w-3 h-3" /> Phone</span>
                <div className="text-right space-y-0.5">
                  {displayPhones.map((ph, i) => (
                    <p key={i} className="text-white font-medium">{ph}{i === 0 && displayPhones.length > 1 ? " (primary)" : ""}</p>
                  ))}
                </div>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-slate-400 flex items-center gap-1.5"><CreditCard className="w-3 h-3" /> Current Balance</span>
              <span className={`font-bold tabular-nums ${isCleared ? "text-emerald-400" : "text-red-300"}`}>
                {isCleared ? "Cleared ✓" : mmkFmt(profile.current_balance)}
              </span>
            </div>
            {profile.total_debt != null && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Original Debt</span>
                <span className="text-slate-300 tabular-nums">{mmkFmt(profile.total_debt)}</span>
              </div>
            )}
            {profile.credit_limit != null && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Credit Limit</span>
                <span className={`font-semibold tabular-nums ${isOverCreditLimit ? "text-amber-400" : "text-slate-300"}`}>
                  {mmkFmt(profile.credit_limit)}
                </span>
              </div>
            )}
            {profile.payment_due_date && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-400 flex items-center gap-1.5"><Calendar className="w-3 h-3" /> Payment Due</span>
                <span className={`font-semibold ${isPastDueDate ? "text-red-400" : "text-slate-300"}`}>
                  {fmtDate(profile.payment_due_date)}
                </span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-slate-400 flex items-center gap-1.5"><Clock className="w-3 h-3" /> Last Payment</span>
              <span className="text-slate-300">{profile.last_payment_at ? fmtDate(profile.last_payment_at) : "No payments yet"}</span>
            </div>
          </div>

          {/* Chart + Score */}
          {(hasPieData || !NO_SCORE_RELATIONS.has(profile.relation)) && (
            <div className={`grid gap-4 ${hasPieData && !NO_SCORE_RELATIONS.has(profile.relation) ? "grid-cols-2" : "grid-cols-1 place-items-center"}`}>
              {hasPieData && (
                <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-4 flex flex-col items-center">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Repayment Progress</p>
                  <ResponsiveContainer width={120} height={120}>
                    <PieChart>
                      <Pie data={pieData} cx={55} cy={55} innerRadius={30} outerRadius={50} paddingAngle={2} dataKey="value">
                        {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                      </Pie>
                      <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "8px", fontSize: "12px" }} formatter={(v: number) => [mmkFmt(v), ""]} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex gap-3 mt-1 text-xs">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> Paid</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> Left</span>
                  </div>
                </div>
              )}
              {!NO_SCORE_RELATIONS.has(profile.relation) && (
                <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-4 flex flex-col items-center justify-center">
                  <ScoreGauge score={profile.score} />
                  <div className="mt-2 space-y-1 text-xs text-slate-600 text-center">
                    <p>80–100 Excellent · 40–79 Average</p>
                    <p>0–39 High Risk</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Add Transaction */}
          <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-4">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Record Transaction</p>
            <form onSubmit={handleAddTransaction} className="space-y-3">
              {/* Type toggle */}
              <div className="flex gap-2">
                <button type="button" onClick={() => setTxnType("payment")}
                  className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${txnType === "payment" ? "bg-emerald-600/30 border-emerald-500/50 text-emerald-300" : "bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300"}`}>
                  ↓ Payment (reduces debt)
                </button>
                <button type="button" onClick={() => setTxnType("debt")}
                  className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${txnType === "debt" ? "bg-red-600/30 border-red-500/50 text-red-300" : "bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300"}`}>
                  ↑ New Debt (adds to balance)
                </button>
              </div>

              {/* ── Fuel fields: only for non-Family/Own debt entries ── */}
              {showFuelFields ? (
                <>
                  {/* Product type */}
                  <div>
                    <label className="text-xs text-slate-500 font-semibold uppercase tracking-wider block mb-1">Product Type</label>
                    <select value={fuelProduct} onChange={e => setFuelProduct(e.target.value as typeof fuelProduct)}
                      className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/50">
                      <option value="92 RON">92 RON</option>
                      <option value="PD">PD (Premium Diesel)</option>
                      <option value="95">95 RON</option>
                      <option value="HSD">HSD (Diesel)</option>
                    </select>
                  </div>

                  {/* Total Amount */}
                  <div>
                    <label className="text-xs text-slate-500 font-semibold uppercase tracking-wider block mb-1">Total Amount (MMK)</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">K</span>
                      <input type="text" inputMode="decimal" value={fuelAmountInput} onChange={e => handleFuelAmountChange(e.target.value)}
                        placeholder="0"
                        className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-xl pl-7 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/50 placeholder:text-slate-600" />
                    </div>
                  </div>

                  {/* Liters & Gallons — cross-calculating */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-slate-500 font-semibold uppercase tracking-wider block mb-1">Liters (L)</label>
                      <input type="text" inputMode="decimal" value={fuelLitersInput}
                        onChange={e => handleFuelLitersChange(e.target.value)}
                        placeholder="0.000"
                        className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/50 placeholder:text-slate-600" />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500 font-semibold uppercase tracking-wider block mb-1">Gallons (G)</label>
                      <input type="text" inputMode="decimal" value={fuelGallonsInput}
                        onChange={e => handleFuelGallonsChange(e.target.value)}
                        placeholder="0.0000"
                        className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/50 placeholder:text-slate-600" />
                    </div>
                  </div>

                  {/* Price Per Liter — user-entered, optional */}
                  <div>
                    <label className="text-xs text-slate-500 font-semibold uppercase tracking-wider block mb-1">
                      Price Per Liter
                      <span className="ml-1.5 normal-case font-normal text-slate-600">(optional)</span>
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">K</span>
                      <input type="text" inputMode="decimal" value={fuelPriceInput}
                        onChange={e => handleFuelPriceChange(e.target.value)}
                        placeholder="e.g. 1650"
                        className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-xl pl-7 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/50 placeholder:text-slate-600" />
                    </div>
                  </div>
                </>
              ) : (
                /* ── Simple amount field: payments OR Family/Own debts ── */
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500 font-semibold uppercase tracking-wider block mb-1">Amount</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">K</span>
                      <input type="number" value={txnAmount} onChange={e => setTxnAmount(e.target.value)}
                        placeholder="0" min="0"
                        className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-xl pl-7 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/50 placeholder:text-slate-600"
                        required />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 font-semibold uppercase tracking-wider block mb-1">Date</label>
                    <input type="date" value={txnDate} onChange={e => setTxnDate(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/50" />
                  </div>
                </div>
              )}

              {/* Date — shown below fuel fields */}
              {showFuelFields && (
                <div>
                  <label className="text-xs text-slate-500 font-semibold uppercase tracking-wider block mb-1">Date</label>
                  <input type="date" value={txnDate} onChange={e => setTxnDate(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/50" />
                </div>
              )}

              {/* Remarks / note */}
              <div>
                <label className="text-xs text-slate-500 font-semibold uppercase tracking-wider block mb-1">
                  {showFuelFields ? "Remarks (optional)" : "Note (optional)"}
                </label>
                <input type="text" value={txnNote} onChange={e => setTxnNote(e.target.value)}
                  placeholder={showFuelFields ? "e.g. Plate no., vehicle type…" : "e.g. Partial payment, Invoice #2…"}
                  className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/50 placeholder:text-slate-600" />
              </div>

              {txnError && (
                <p className="text-xs text-red-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {txnError}</p>
              )}
              <button type="submit" disabled={submitting}
                className={`w-full py-2.5 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 ${txnType === "payment" ? "bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50" : "bg-red-700 hover:bg-red-600 text-white disabled:opacity-50"}`}>
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                {submitting ? "Saving…" : txnType === "payment" ? "Record Payment" : "Add Debt"}
              </button>
            </form>
          </div>

          {/* Transaction History */}
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
              <Clock className="w-3.5 h-3.5" /> Transaction History
            </p>
            {loadingTxn ? (
              <div className="py-8 text-center"><Loader2 className="w-6 h-6 text-blue-500/50 animate-spin mx-auto" /></div>
            ) : transactions.length === 0 ? (
              <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-6 text-center">
                <p className="text-slate-500 text-sm">No transactions yet</p>
              </div>
            ) : (
              <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl overflow-hidden">
                {transactions.map((txn, i) => {
                  const isPayment = txn.amount < 0;
                  const hasProductType = !isPayment && !!txn.product_type;
                  const hasVolume = txn.liters != null && txn.liters > 0;
                  const isHighlighted = !!txn.highlighted;
                  const isEditingRemark = remarkEditingId === txn.id;
                  return (
                    <div key={txn.id} className={[
                      "flex items-start gap-3 px-4 py-3 text-sm group transition-colors",
                      i > 0 ? "border-t border-slate-700/30" : "",
                      isHighlighted ? "border-l-[3px] border-amber-400 bg-amber-400/[0.04] pl-3" : "",
                    ].join(" ")}>
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${isPayment ? "bg-emerald-500/20" : "bg-red-500/20"}`}>
                        <span className={`text-[10px] font-bold ${isPayment ? "text-emerald-400" : "text-red-400"}`}>{isPayment ? "↓" : "↑"}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className={`font-bold tabular-nums ${isPayment ? "text-emerald-400" : "text-red-300"}`}>
                            {isPayment ? "" : "+"}{mmkFmt(txn.amount)}
                          </span>
                          <span className="text-slate-600 text-[10px] font-mono shrink-0">{txn.transaction_number}</span>
                        </div>
                        <p className="text-slate-500 text-xs mt-0.5">{fmtDateTime(txn.date)}</p>
                        {/* Product type — shown even when volumes are null/blank */}
                        {hasProductType && (
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            <span className="text-[10px] font-bold text-blue-400 bg-blue-900/20 border border-blue-700/30 px-1.5 py-0.5 rounded">
                              {txn.product_type}
                            </span>
                            {hasVolume ? (
                              <span className="text-[10px] text-slate-400">
                                {txn.liters!.toLocaleString("en-US", { maximumFractionDigits: 3 })} L
                                {txn.price_per_liter != null && (
                                  <> @ {new Intl.NumberFormat("en-US").format(txn.price_per_liter)}/L</>
                                )}
                              </span>
                            ) : (
                              <span className="text-[10px] text-slate-500 italic">(Flat Amount Purchase)</span>
                            )}
                          </div>
                        )}
                        {/* Remark — inline editable */}
                        {isEditingRemark ? (
                          <div className="flex items-center gap-1.5 mt-1.5">
                            <input
                              autoFocus
                              type="text"
                              value={remarkDraft}
                              onChange={e => setRemarkDraft(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === "Enter") handleSaveRemark(txn);
                                if (e.key === "Escape") setRemarkEditingId(null);
                              }}
                              placeholder="Add a remark…"
                              className="flex-1 bg-slate-700 border border-slate-600 text-white text-xs rounded-lg px-2.5 py-1 focus:outline-none focus:ring-1 focus:ring-amber-500/50 placeholder:text-slate-500"
                            />
                            <button
                              onClick={() => handleSaveRemark(txn)}
                              className="text-xs text-amber-400 hover:text-amber-300 font-semibold px-2 py-1 rounded-lg hover:bg-amber-900/20 transition-all">
                              Save
                            </button>
                            <button
                              onClick={() => setRemarkEditingId(null)}
                              className="text-xs text-slate-500 hover:text-slate-300 px-1.5 py-1 rounded-lg hover:bg-slate-700 transition-all">
                              ✕
                            </button>
                          </div>
                        ) : txn.note ? (
                          <p
                            title="Click to edit remark"
                            onClick={() => { setRemarkEditingId(txn.id); setRemarkDraft(txn.note ?? ""); }}
                            className="text-slate-400 text-xs mt-0.5 italic cursor-pointer hover:text-amber-300 transition-colors">
                            "{txn.note}"
                          </p>
                        ) : null}
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${txn.source === "daily_app" ? "text-amber-400 border-amber-700/40 bg-amber-900/20" : "text-slate-500 border-slate-700/40"}`}>
                            {txn.source === "daily_app" ? "Daily App" : "Manual"}
                          </span>
                          {/* Quick add remark when none exists */}
                          {!txn.note && !isEditingRemark && (
                            <button
                              onClick={() => { setRemarkEditingId(txn.id); setRemarkDraft(""); }}
                              className="flex items-center gap-0.5 text-[10px] text-slate-600 hover:text-slate-400 opacity-0 group-hover:opacity-100 transition-all">
                              <MessageSquarePlus className="w-3 h-3" /> remark
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0 mt-0.5">
                        {/* Highlight toggle — always visible when highlighted, hover-only otherwise */}
                        <button
                          type="button"
                          onClick={() => handleToggleHighlight(txn)}
                          disabled={togglingHighlight === txn.id}
                          title={isHighlighted ? "Remove highlight" : "Highlight transaction"}
                          className={`p-1.5 rounded-lg transition-all ${
                            isHighlighted
                              ? "text-amber-400 bg-amber-900/20"
                              : "text-slate-600 hover:text-amber-400 hover:bg-amber-900/20 opacity-0 group-hover:opacity-100"
                          }`}>
                          {togglingHighlight === txn.id
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <Bookmark className="w-3.5 h-3.5" fill={isHighlighted ? "currentColor" : "none"} />}
                        </button>
                        <button type="button" onClick={() => openEditTxn(txn)}
                          className="text-slate-600 hover:text-blue-400 hover:bg-blue-900/20 p-1.5 rounded-lg transition-all opacity-0 group-hover:opacity-100">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => handleDeleteTransaction(txn)} disabled={deletingId === txn.id}
                          className="text-slate-600 hover:text-red-400 hover:bg-red-900/20 p-1.5 rounded-lg transition-all opacity-0 group-hover:opacity-100">
                          {deletingId === txn.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Edit Transaction Modal */}
      {editingTxn && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70" onClick={() => setEditingTxn(null)} />
          <div className="relative bg-[#0f1623] border border-slate-700/50 rounded-xl w-full max-w-md shadow max-h-[92vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-700/50 flex items-center justify-between shrink-0">
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-widest font-semibold">Transaction</p>
                <h3 className="text-white font-bold text-base">Edit Entry</h3>
              </div>
              <button type="button" onClick={() => setEditingTxn(null)} className="text-slate-500 hover:text-white p-1.5 rounded-lg hover:bg-slate-700/50 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEditTxn} className="overflow-y-auto p-6 space-y-4">
              {/* Total Amount */}
              <div>
                <label className={labelCls}>Total Amount (MMK) <span className="text-red-400">*</span></label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">K</span>
                  <input type="text" inputMode="decimal" value={editAmount} onChange={e => handleEditAmountChange(e.target.value)}
                    placeholder="0" className={inputCls.replace("px-4", "pl-7")} required />
                </div>
              </div>

              {/* Date */}
              <div>
                <label className={labelCls}>Date</label>
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
                    <label className={labelCls}>Product Type</label>
                    <select value={editProduct} onChange={e => setEditProduct(e.target.value as typeof editProduct)}
                      className={inputCls}>
                      <option value="92 RON">92 RON</option>
                      <option value="PD">PD (Premium Diesel)</option>
                      <option value="95">95 RON</option>
                      <option value="HSD">HSD (Diesel)</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>Liters (L)</label>
                      <input type="text" inputMode="decimal" value={editLiters} onChange={e => handleEditLitersChange(e.target.value)}
                        placeholder="0.000" className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Gallons (G)</label>
                      <input type="text" inputMode="decimal" value={editGallons} onChange={e => handleEditGallonsChange(e.target.value)}
                        placeholder="0.0000" className={inputCls} />
                    </div>
                  </div>

                  <div>
                    <label className={labelCls}>
                      Price Per Liter
                      <span className="ml-1.5 normal-case font-normal text-slate-600">(optional)</span>
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">K</span>
                      <input type="text" inputMode="decimal" value={editPriceInput}
                        onChange={e => handleEditPriceChange(e.target.value)}
                        placeholder="e.g. 1650"
                        className={inputCls.replace("px-4", "pl-7")} />
                    </div>
                  </div>
                </>
              )}

              {/* Remarks */}
              <div>
                <label className={labelCls}>Remarks <span className="text-slate-600 normal-case font-normal">(optional)</span></label>
                <input type="text" value={editNote} onChange={e => setEditNote(e.target.value)}
                  placeholder="e.g. Plate no., vehicle type…" className={inputCls} />
              </div>

              {editTxnError && (
                <p className="text-xs text-red-400 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> {editTxnError}
                </p>
              )}

              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setEditingTxn(null)}
                  className="flex-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 font-semibold rounded-xl py-2.5 text-sm transition-all">
                  Cancel
                </button>
                <button type="submit" disabled={editTxnSaving}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold rounded-xl py-2.5 text-sm transition-all flex items-center justify-center gap-2">
                  {editTxnSaving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : "Save Changes"}
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
          <div className="relative bg-[#0f1623] border border-slate-700/50 rounded-xl w-full max-w-md shadow max-h-[92vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-700/50 flex items-center justify-between shrink-0">
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-widest font-semibold">Profile</p>
                <h3 className="text-white font-bold text-base">Edit Details</h3>
              </div>
              <button onClick={() => setShowEdit(false)} className="text-slate-500 hover:text-white p-1.5 rounded-lg hover:bg-slate-700/50 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="overflow-y-auto p-6 space-y-5">
              {/* Name */}
              <div>
                <label className={labelCls}>Name <span className="text-red-400">*</span></label>
                <input type="text" value={editName} onChange={e => setEditName(e.target.value)}
                  placeholder="Full name or alias" className={inputCls} required />
              </div>

              {/* Age */}
              <div>
                <label className={labelCls}>Age <span className="text-slate-600 normal-case font-normal">(optional)</span></label>
                <input type="number" value={editAge} onChange={e => setEditAge(e.target.value)}
                  placeholder="e.g. 35" min="1" max="120" className={inputCls} />
              </div>

              {/* Relation */}
              <div>
                <label className={labelCls}>Relation</label>
                <select value={editRelation} onChange={e => setEditRelation(e.target.value as DebtRelation)}
                  className={inputCls}>
                  {RELATIONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>

              {/* Phone Numbers */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className={labelCls + " mb-0"}>
                    Phone Numbers
                    <span className="text-slate-600 normal-case font-normal ml-1">(up to 3)</span>
                  </label>
                  {editPhones.length < 3 && (
                    <button type="button" onClick={addPhone}
                      className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 font-semibold transition-colors">
                      <Plus className="w-3 h-3" /> Add
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
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-600 font-semibold uppercase">Primary</span>
                        )}
                      </div>
                      {idx > 0 && (
                        <button type="button" onClick={() => removePhone(idx)}
                          className="text-slate-600 hover:text-red-400 hover:bg-red-900/20 p-2 rounded-lg transition-all shrink-0">
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
                  Credit Limit
                  <span className="text-slate-600 normal-case font-normal ml-1">(optional — leave blank for no limit)</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm font-medium select-none">K</span>
                  <input type="number" value={editCreditLimit} onChange={e => setEditCreditLimit(e.target.value)}
                    placeholder="Leave blank for no limit" min="0"
                    className={`${inputCls} pl-8`} />
                </div>
                <p className="text-xs text-slate-600 mt-1">An alert fires when the balance exceeds this amount.</p>
              </div>

              {/* Payment Due Date */}
              <div>
                <label className={labelCls}>
                  Payment Due Date
                  <span className="text-slate-600 normal-case font-normal ml-1">(optional)</span>
                </label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" />
                  <input type="date" value={editPaymentDueDate} onChange={e => setEditPaymentDueDate(e.target.value)}
                    className={`${inputCls} pl-9`} />
                </div>
                <p className="text-xs text-slate-600 mt-1">An alert fires when today's date passes this and balance is still owed.</p>
              </div>

              {editError && (
                <div className="flex items-start gap-2 bg-red-900/30 border border-red-700/40 rounded-xl px-4 py-3 text-xs text-red-300">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {editError}
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setShowEdit(false)}
                  className="flex-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 font-semibold rounded-xl py-2.5 text-sm transition-all">
                  Cancel
                </button>
                <button type="submit" disabled={editSaving}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold rounded-xl py-2.5 text-sm transition-all flex items-center justify-center gap-2">
                  {editSaving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
