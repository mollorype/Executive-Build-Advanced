import { useState, useEffect } from "react";
import {
  supabase, DebtProfile, DebtTransaction, DEBT_TABLES,
  generateTxnNumber, calculateScore, scoreColor, scoreTier, mmkFmt, formatPhone,
} from "@/lib/debt-supabase";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import {
  X, Plus, Trash2, Clock, User, Phone, CreditCard,
  AlertTriangle, CheckCircle, Loader2, Calendar,
} from "lucide-react";

type Props = {
  profile: DebtProfile;
  onClose: () => void;
  onUpdated: () => void;
  onProfileChange: (p: DebtProfile) => void;
};

function ScoreGauge({ score }: { score: number }) {
  const r = 40;
  const cx = 60;
  const cy = 55;
  const semi = Math.PI * r;
  const progress = (score / 100) * semi;
  const color = scoreColor(score);
  const tier = scoreTier(score);

  return (
    <div className="flex flex-col items-center gap-1">
      <svg viewBox="0 0 120 72" className="w-36 h-24">
        <path d={`M 20 55 A 40 40 0 0 1 100 55`} fill="none" stroke="#1e293b" strokeWidth="12" strokeLinecap="round" />
        <path
          d={`M 20 55 A 40 40 0 0 1 100 55`}
          fill="none"
          stroke={color}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={`${progress} ${semi}`}
        />
        <text x={cx} y={52} textAnchor="middle" fill="white" fontSize="18" fontWeight="700">{score}</text>
        <text x={cx} y={66} textAnchor="middle" fill={color} fontSize="9" fontWeight="600">{tier.toUpperCase()}</text>
      </svg>
      <p className="text-xs text-slate-500">Trust & Repayment Score</p>
    </div>
  );
}

function fmtDate(d: string) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}
function fmtDateTime(d: string) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

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

  async function fetchTransactions() {
    const { data } = await supabase
      .from(DEBT_TABLES.TRANSACTIONS)
      .select("*")
      .eq("profile_id", profile.id)
      .order("created_at", { ascending: false });
    if (data) setTransactions(data as DebtTransaction[]);
  }

  useEffect(() => {
    setLoadingTxn(true);
    fetchTransactions().finally(() => setLoadingTxn(false));
  }, [profile.id]);

  async function handleAddTransaction(e: React.FormEvent) {
    e.preventDefault();
    const amt = parseFloat(txnAmount);
    if (!amt || isNaN(amt) || amt <= 0) { setTxnError("Enter a valid amount."); return; }
    setSubmitting(true);
    setTxnError("");

    const finalAmount = txnType === "payment" ? -amt : amt;
    const newBalance = profile.current_balance + finalAmount;
    const txnNum = generateTxnNumber();

    const { error: txnErr } = await supabase.from(DEBT_TABLES.TRANSACTIONS).insert({
      profile_id: profile.id,
      amount: finalAmount,
      date: txnDate,
      note: txnNote.trim() || null,
      transaction_number: txnNum,
      source: "manual",
    });

    if (txnErr) { setTxnError(txnErr.message); setSubmitting(false); return; }

    const allTxns = [...transactions, { id: "", profile_id: profile.id, amount: finalAmount, date: txnDate, note: txnNote, transaction_number: txnNum, source: "manual" as const, created_at: new Date().toISOString() }];
    const newScore = calculateScore(allTxns, newBalance);
    const lastPayAt = txnType === "payment" ? new Date().toISOString() : profile.last_payment_at;

    await supabase.from(DEBT_TABLES.PROFILES).update({
      current_balance: newBalance,
      score: newScore,
      last_payment_at: lastPayAt,
    }).eq("id", profile.id);

    setTxnAmount(""); setTxnNote(""); setTxnType("payment");
    setSubmitting(false);

    const updated: DebtProfile = { ...profile, current_balance: newBalance, score: newScore, last_payment_at: lastPayAt ?? profile.last_payment_at };
    onProfileChange(updated);
    await fetchTransactions();
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

    await supabase.from(DEBT_TABLES.PROFILES).update({
      current_balance: newBalance,
      score: newScore,
      last_payment_at: lastPay,
    }).eq("id", profile.id);

    const updated: DebtProfile = { ...profile, current_balance: newBalance, score: newScore, last_payment_at: lastPay };
    onProfileChange(updated);
    setDeletingId(null);
    await fetchTransactions();
  }

  const paid = Math.max(0, (profile.total_debt ?? 0) - Math.max(0, profile.current_balance));
  const remaining = Math.max(0, profile.current_balance);
  const hasPieData = (profile.total_debt ?? 0) > 0;

  const pieData = hasPieData
    ? [
        { name: "Paid", value: paid, color: "#10b981" },
        { name: "Remaining", value: remaining, color: "#ef4444" },
      ]
    : [];

  const isCleared = profile.current_balance <= 0;
  const isHighRisk = profile.score < 40;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-[520px] bg-[#0f1623] border-l border-slate-700/50 h-full overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 bg-[#0f1623]/95 backdrop-blur border-b border-slate-700/50 px-6 py-4 flex items-start justify-between z-10">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-full bg-slate-700 flex items-center justify-center text-slate-200 font-bold text-lg">
              {profile.name[0].toUpperCase()}
            </div>
            <div>
              <h2 className="text-white font-bold text-base leading-tight">{profile.name}</h2>
              <p className="text-slate-500 text-xs">{profile.relation} · Created {fmtDate(profile.created_at)}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white p-1.5 rounded-lg hover:bg-slate-700/50 transition-colors mt-0.5">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Status banner */}
          {isCleared ? (
            <div className="flex items-center gap-3 bg-emerald-900/30 border border-emerald-700/50 rounded-xl px-4 py-3">
              <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" />
              <p className="text-emerald-300 font-semibold text-sm">Debt fully cleared</p>
            </div>
          ) : isHighRisk ? (
            <div className="flex items-center gap-3 bg-red-900/30 border border-red-700/50 rounded-xl px-4 py-3">
              <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
              <p className="text-red-300 font-semibold text-sm">High Risk — Low repayment activity</p>
            </div>
          ) : null}

          {/* Profile info */}
          <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-4 space-y-2.5">
            <div className="flex justify-between text-sm">
              <span className="text-slate-400 flex items-center gap-1.5"><User className="w-3 h-3" /> Name</span>
              <span className="text-white font-semibold">{profile.name}</span>
            </div>
            {profile.phone_number && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-400 flex items-center gap-1.5"><Phone className="w-3 h-3" /> Phone</span>
                <span className="text-white font-medium">{profile.phone_number}</span>
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
            <div className="flex justify-between text-sm">
              <span className="text-slate-400 flex items-center gap-1.5"><Clock className="w-3 h-3" /> Last Payment</span>
              <span className="text-slate-300">{profile.last_payment_at ? fmtDate(profile.last_payment_at) : "No payments yet"}</span>
            </div>
          </div>

          {/* Chart + Score row */}
          <div className={`grid gap-4 ${hasPieData ? "grid-cols-2" : "grid-cols-1 place-items-center"}`}>
            {hasPieData && (
              <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-4 flex flex-col items-center">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Repayment Progress</p>
                <ResponsiveContainer width={120} height={120}>
                  <PieChart>
                    <Pie data={pieData} cx={55} cy={55} innerRadius={30} outerRadius={50} paddingAngle={2} dataKey="value">
                      {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Pie>
                    <Tooltip
                      contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "8px", fontSize: "12px" }}
                      formatter={(v: number) => [mmkFmt(v), ""]}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex gap-3 mt-1 text-xs">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> Paid</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> Left</span>
                </div>
              </div>
            )}
            <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-4 flex flex-col items-center justify-center">
              <ScoreGauge score={profile.score} />
              <div className="mt-2 space-y-1 text-xs text-slate-600 text-center">
                <p>80–100 Excellent · 40–79 Average</p>
                <p>0–39 High Risk</p>
              </div>
            </div>
          </div>

          {/* Add Transaction */}
          <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-4">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Record Transaction</p>
            <form onSubmit={handleAddTransaction} className="space-y-3">
              {/* Type toggle */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setTxnType("payment")}
                  className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${
                    txnType === "payment"
                      ? "bg-emerald-600/30 border-emerald-500/50 text-emerald-300"
                      : "bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300"
                  }`}
                >
                  ↓ Payment (reduces debt)
                </button>
                <button
                  type="button"
                  onClick={() => setTxnType("debt")}
                  className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${
                    txnType === "debt"
                      ? "bg-red-600/30 border-red-500/50 text-red-300"
                      : "bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300"
                  }`}
                >
                  ↑ New Debt (adds to balance)
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-500 font-semibold uppercase tracking-wider block mb-1">Amount</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">K</span>
                    <input
                      type="number"
                      value={txnAmount}
                      onChange={e => setTxnAmount(e.target.value)}
                      placeholder="0"
                      min="0"
                      className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-xl pl-7 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/50 placeholder:text-slate-600"
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-slate-500 font-semibold uppercase tracking-wider block mb-1">Date</label>
                  <input
                    type="date"
                    value={txnDate}
                    onChange={e => setTxnDate(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-500 font-semibold uppercase tracking-wider block mb-1">Note (optional)</label>
                <input
                  type="text"
                  value={txnNote}
                  onChange={e => setTxnNote(e.target.value)}
                  placeholder="e.g. Partial payment, Invoice #2…"
                  className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/50 placeholder:text-slate-600"
                />
              </div>

              {txnError && (
                <p className="text-xs text-red-400 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> {txnError}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className={`w-full py-2.5 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 ${
                  txnType === "payment"
                    ? "bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
                    : "bg-red-700 hover:bg-red-600 text-white disabled:opacity-50"
                }`}
              >
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
              <div className="py-8 text-center">
                <Loader2 className="w-6 h-6 text-blue-500/50 animate-spin mx-auto" />
              </div>
            ) : transactions.length === 0 ? (
              <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-6 text-center">
                <p className="text-slate-500 text-sm">No transactions yet</p>
              </div>
            ) : (
              <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl overflow-hidden">
                {transactions.map((txn, i) => {
                  const isPayment = txn.amount < 0;
                  return (
                    <div key={txn.id} className={["flex items-start gap-3 px-4 py-3 text-sm group", i > 0 ? "border-t border-slate-700/30" : ""].join(" ")}>
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
                        <p className="text-slate-500 text-xs mt-0.5">{fmtDateTime(txn.created_at)}</p>
                        {txn.note && <p className="text-slate-400 text-xs mt-0.5 italic">"{txn.note}"</p>}
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${txn.source === "daily_app" ? "text-amber-400 border-amber-700/40 bg-amber-900/20" : "text-slate-500 border-slate-700/40"}`}>
                            {txn.source === "daily_app" ? "Daily App" : "Manual"}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteTransaction(txn)}
                        disabled={deletingId === txn.id}
                        className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 hover:bg-red-900/20 p-1.5 rounded-lg transition-all shrink-0 mt-0.5"
                      >
                        {deletingId === txn.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
