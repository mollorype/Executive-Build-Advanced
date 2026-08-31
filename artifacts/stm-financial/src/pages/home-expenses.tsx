import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { mmkFmt } from "@/lib/debt-supabase";
import {
  HOME_IC_LEDGER_TABLE, HOME_IC_SETUP_SQL,
  IC_ROLES, IC_ROLE_LABELS, IC_NON_EXPENSE_ROLES,
  todayStr, monthStartStr, weekStartStr, yearStartStr, lastMonthRange,
  type IcLedgerEntry, type IcEntryType, type IcRole,
} from "@/lib/home-expenses";
import { buildIcLedger, exportIcLedgerExcel } from "@/lib/home-expense-export";
import {
  Plus, Trash2, AlertCircle, Copy, Loader2, CalendarDays, Download,
  TrendingUp, TrendingDown, Scale, PiggyBank, ChefHat, User, Users, UserCircle2, UserRound, Contact, Landmark, ListChecks,
} from "lucide-react";

const ROLE_ICONS: Record<IcRole, typeof User> = {
  mom: UserRound,
  kitchen: ChefHat,
  dad: User,
  bro: Users,
  me: UserCircle2,
  am: Contact,
  bank_transfer: Landmark,
  saving: PiggyBank,
};

const RANGE_PRESETS: { label: string; range: () => { from: string; to: string } }[] = [
  { label: "Today", range: () => ({ from: todayStr(), to: todayStr() }) },
  { label: "This Week", range: () => ({ from: weekStartStr(), to: todayStr() }) },
  { label: "This Month", range: () => ({ from: monthStartStr(), to: todayStr() }) },
  { label: "Last Month", range: () => lastMonthRange() },
  { label: "This Year", range: () => ({ from: yearStartStr(), to: todayStr() }) },
];

function n(v: string): number {
  const x = parseFloat(v.replace(/,/g, ""));
  return isNaN(x) ? 0 : x;
}

function fmtDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

export default function HomeExpenses() {
  const [entries, setEntries] = useState<IcLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [tableError, setTableError] = useState(false);
  const [copied, setCopied] = useState(false);

  // Add entry form
  const [entryType, setEntryType] = useState<IcEntryType>("expense");
  const [role, setRole] = useState<IcRole>("mom");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [entryDate, setEntryDate] = useState(todayStr());
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Shared time frame + export
  const [rangeFrom, setRangeFrom] = useState(monthStartStr());
  const [rangeTo, setRangeTo] = useState(todayStr());
  const [exporting, setExporting] = useState(false);

  const fetchAll = useCallback(async () => {
    const { data, error } = await supabase
      .from(HOME_IC_LEDGER_TABLE)
      .select("*")
      .order("entry_date", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) {
      if (error.code === "42P01" || error.code === "PGRST116" || error.message.includes("does not exist")) {
        setTableError(true);
      }
    } else {
      setTableError(false);
      setEntries((data ?? []) as IcLedgerEntry[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  function handleCopy() {
    navigator.clipboard.writeText(HOME_IC_SETUP_SQL);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleAddEntry(e: React.FormEvent) {
    e.preventDefault();
    const amt = n(amount);
    if (amt <= 0) {
      setFormError("Enter an amount greater than zero.");
      return;
    }

    setSubmitting(true);
    setFormError("");
    const { error } = await supabase.from(HOME_IC_LEDGER_TABLE).insert({
      entry_type: entryType,
      role,
      amount: amt,
      note: note.trim() || null,
      entry_date: entryDate,
    });
    setSubmitting(false);

    if (error) {
      setFormError(error.message);
      return;
    }
    setAmount("");
    setNote("");
    fetchAll();
  }

  async function handleDeleteEntry(entry: IcLedgerEntry) {
    if (!window.confirm(`Delete this ${IC_ROLE_LABELS[entry.role]} ${entry.entry_type} of ${mmkFmt(entry.amount)}?`)) return;
    setDeletingId(entry.id);
    await supabase.from(HOME_IC_LEDGER_TABLE).delete().eq("id", entry.id);
    setDeletingId(null);
    fetchAll();
  }

  const rangeEntries = useMemo(
    () => entries.filter(e => e.entry_date >= rangeFrom && e.entry_date <= rangeTo),
    [entries, rangeFrom, rangeTo]
  );

  const ledger = useMemo(() => buildIcLedger(entries, rangeFrom, rangeTo), [entries, rangeFrom, rangeTo]);

  const totalIncome = useMemo(
    () => rangeEntries.filter(e => e.entry_type === "income").reduce((s, e) => s + e.amount, 0),
    [rangeEntries]
  );
  const totalSaved = useMemo(
    () => rangeEntries.filter(e => e.entry_type === "expense" && IC_NON_EXPENSE_ROLES.has(e.role)).reduce((s, e) => s + e.amount, 0),
    [rangeEntries]
  );
  const totalExpenses = useMemo(
    () => rangeEntries.filter(e => e.entry_type === "expense" && !IC_NON_EXPENSE_ROLES.has(e.role)).reduce((s, e) => s + e.amount, 0),
    [rangeEntries]
  );

  const roleBreakdown = useMemo(() => {
    const sums = new Map<IcRole, number>();
    for (const e of rangeEntries) {
      if (e.entry_type !== "expense" || IC_NON_EXPENSE_ROLES.has(e.role)) continue;
      sums.set(e.role, (sums.get(e.role) ?? 0) + e.amount);
    }
    return IC_ROLES
      .map(r => ({ role: r, total: sums.get(r) ?? 0 }))
      .filter(row => row.total > 0)
      .sort((a, b) => b.total - a.total);
  }, [rangeEntries]);

  async function handleExport() {
    setExporting(true);
    try {
      await exportIcLedgerExcel(rangeFrom, rangeTo, ledger);
    } finally {
      setExporting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-50">
        <Loader2 className="w-6 h-6 text-blue-300 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto bg-slate-50">
      <div className="px-6 py-5 border-b border-slate-100 bg-white">
        <h1 className="text-2xl font-bold text-slate-900">I/C</h1>
        <p className="text-slate-400 text-sm mt-0.5">Income & Cost ledger</p>
      </div>

      <div className="p-6 max-w-3xl space-y-5">
        {tableError ? (
          <div className="bg-pale-gold border border-amber-100 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <AlertCircle className="w-5 h-5 text-pale-gold-foreground shrink-0" />
              <p className="text-pale-gold-foreground font-semibold text-sm">One-time setup required</p>
            </div>
            <p className="text-pale-gold-foreground/80 text-xs mb-3">
              Run this SQL once in your Supabase SQL Editor to enable the I/C ledger:
            </p>
            <pre className="bg-slate-900 rounded-lg p-3 text-xs text-slate-100 font-mono overflow-x-auto whitespace-pre-wrap mb-3">
              {HOME_IC_SETUP_SQL}
            </pre>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 text-xs bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-lg px-3 py-1.5 transition-colors"
            >
              <Copy className="w-3 h-3" />
              {copied ? "Copied!" : "Copy SQL"}
            </button>
          </div>
        ) : (
          <>
            {/* Summary row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white border border-slate-100 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-pale-green flex items-center justify-center">
                    <TrendingUp className="w-4 h-4 text-pale-green-foreground" />
                  </div>
                  <span className="text-slate-400 text-xs font-medium uppercase tracking-wider">Income</span>
                </div>
                <p className="text-xl font-bold text-slate-900 tabular-nums">{mmkFmt(totalIncome)}</p>
              </div>
              <div className="bg-white border border-slate-100 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-pale-red flex items-center justify-center">
                    <TrendingDown className="w-4 h-4 text-pale-red-foreground" />
                  </div>
                  <span className="text-slate-400 text-xs font-medium uppercase tracking-wider">Expenses</span>
                </div>
                <p className="text-xl font-bold text-slate-900 tabular-nums">{mmkFmt(totalExpenses)}</p>
              </div>
              <div className="bg-white border border-slate-100 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-pale-gold flex items-center justify-center">
                    <PiggyBank className="w-4 h-4 text-pale-gold-foreground" />
                  </div>
                  <span className="text-slate-400 text-xs font-medium uppercase tracking-wider">Saved</span>
                </div>
                <p className="text-xl font-bold text-slate-900 tabular-nums">{mmkFmt(totalSaved)}</p>
              </div>
              <div className="bg-white border border-slate-100 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-pale-blue flex items-center justify-center">
                    <Scale className="w-4 h-4 text-pale-blue-foreground" />
                  </div>
                  <span className="text-slate-400 text-xs font-medium uppercase tracking-wider">Balance</span>
                </div>
                <p className={`text-xl font-bold tabular-nums ${ledger.closingBalance >= 0 ? "text-slate-900" : "text-pale-red-foreground"}`}>
                  {mmkFmt(ledger.closingBalance)}
                </p>
              </div>
            </div>

            {/* Shared time frame + export */}
            <div className="bg-white border border-slate-100 shadow-sm rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <CalendarDays className="w-4 h-4 text-pale-blue-foreground" />
                <h2 className="text-slate-900 font-semibold text-sm">Time Frame</h2>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 mb-3">
                {RANGE_PRESETS.map(preset => {
                  const { from, to } = preset.range();
                  const active = rangeFrom === from && rangeTo === to;
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => { setRangeFrom(from); setRangeTo(to); }}
                      className={`text-xs font-semibold rounded-full px-3 py-1 border transition-all ${
                        active
                          ? "bg-pale-blue border-blue-200 text-pale-blue-foreground"
                          : "bg-white border-slate-200 text-slate-500 hover:border-slate-300"
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  value={rangeFrom}
                  onChange={e => setRangeFrom(e.target.value)}
                  aria-label="From date"
                  className="bg-white border border-slate-100 text-slate-900 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <span className="text-slate-400 text-xs">→</span>
                <input
                  type="date"
                  value={rangeTo}
                  onChange={e => setRangeTo(e.target.value)}
                  aria-label="To date"
                  className="bg-white border border-slate-100 text-slate-900 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <button
                  onClick={handleExport}
                  disabled={exporting || ledger.rows.length === 0}
                  className="ml-auto flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-xs rounded-lg px-3.5 py-2 transition-all"
                >
                  {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  {exporting ? "Preparing…" : "Export Excel"}
                </button>
              </div>
            </div>

            {/* Role breakdown */}
            {roleBreakdown.length > 0 && (
              <div className="bg-white border border-slate-100 shadow-sm rounded-2xl p-5">
                <p className="text-slate-900 font-semibold text-sm mb-4">Expenses This Period by Role</p>
                <div className="space-y-3">
                  {roleBreakdown.map(row => {
                    const Icon = ROLE_ICONS[row.role];
                    const pct = totalExpenses > 0 ? (row.total / totalExpenses) * 100 : 0;
                    return (
                      <div key={row.role}>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="flex items-center gap-1.5 text-slate-600 font-medium">
                            <Icon className="w-3.5 h-3.5 text-slate-400" />
                            {IC_ROLE_LABELS[row.role]}
                          </span>
                          <span className="text-slate-500 tabular-nums">{mmkFmt(row.total)}</span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                          <div className="h-full rounded-full bg-blue-400 transition-all duration-700" style={{ width: `${pct.toFixed(1)}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Add entry */}
            <div className="bg-white border border-slate-100 shadow-sm rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
                <ListChecks className="w-4 h-4 text-pale-blue-foreground" />
                <h2 className="text-slate-900 font-semibold text-sm">Add Entry</h2>
              </div>
              <form onSubmit={handleAddEntry} className="p-5 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Type</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setEntryType("income")}
                      className={`flex items-center justify-center gap-1.5 text-sm font-semibold rounded-xl py-2.5 border transition-all ${
                        entryType === "income"
                          ? "bg-pale-green border-emerald-200 text-pale-green-foreground"
                          : "bg-white border-slate-200 text-slate-500 hover:border-slate-300"
                      }`}
                    >
                      <TrendingUp className="w-4 h-4" /> Income
                    </button>
                    <button
                      type="button"
                      onClick={() => setEntryType("expense")}
                      className={`flex items-center justify-center gap-1.5 text-sm font-semibold rounded-xl py-2.5 border transition-all ${
                        entryType === "expense"
                          ? "bg-pale-red border-red-200 text-pale-red-foreground"
                          : "bg-white border-slate-200 text-slate-500 hover:border-slate-300"
                      }`}
                    >
                      <TrendingDown className="w-4 h-4" /> Expense
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Role</label>
                  <div className="flex flex-wrap gap-2">
                    {IC_ROLES.map(r => {
                      const Icon = ROLE_ICONS[r];
                      const active = role === r;
                      return (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setRole(r)}
                          className={`flex items-center gap-1.5 text-xs font-semibold rounded-full px-3 py-1.5 border transition-all ${
                            active
                              ? "bg-pale-blue border-blue-200 text-pale-blue-foreground"
                              : "bg-white border-slate-200 text-slate-500 hover:border-slate-300"
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                          {IC_ROLE_LABELS[r]}
                        </button>
                      );
                    })}
                  </div>
                  {role === "saving" && (
                    <p className="text-[11px] text-slate-400 mt-1.5">Deducted from the balance, but not counted as an expense.</p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Amount</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm font-semibold select-none">K</span>
                      <input
                        type="number"
                        value={amount}
                        onChange={e => setAmount(e.target.value)}
                        placeholder="0"
                        className="w-full bg-white border border-slate-100 text-slate-900 text-sm font-semibold rounded-xl pl-8 pr-3.5 py-2.5 outline-none tabular-nums focus:ring-1 focus:ring-blue-500 placeholder:text-slate-400"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <CalendarDays className="w-3.5 h-3.5" /> Day
                    </label>
                    <input
                      type="date"
                      value={entryDate}
                      onChange={e => setEntryDate(e.target.value)}
                      className="w-full bg-white border border-slate-100 text-slate-900 text-sm rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Note (optional)</label>
                  <input
                    type="text"
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    placeholder="e.g. Weekly groceries"
                    className="w-full bg-white border border-slate-100 text-slate-900 text-sm rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder:text-slate-400"
                  />
                </div>

                {formError && (
                  <div className="flex items-start gap-2 bg-pale-red border border-red-100 rounded-xl px-4 py-3 text-xs text-pale-red-foreground">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{formError}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-xl py-3 text-sm transition-all"
                >
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  {submitting ? "Saving…" : "Add Entry"}
                </button>
              </form>
            </div>

            {/* Ledger */}
            <div className="bg-white border border-slate-100 shadow-sm rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
                <ListChecks className="w-4 h-4 text-pale-blue-foreground" />
                <h2 className="text-slate-900 font-semibold text-sm">Ledger</h2>
              </div>

              <div className="px-5 py-2.5 bg-slate-50 flex items-center justify-between border-b border-slate-100">
                <span className="text-xs italic text-slate-500">Opening Balance</span>
                <span className="text-xs font-semibold text-slate-600 tabular-nums">{mmkFmt(ledger.openingBalance)}</span>
              </div>

              {ledger.rows.length === 0 ? (
                <div className="px-6 py-10 text-center">
                  <ListChecks className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                  <p className="text-slate-400 text-sm">No entries in this period.</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {ledger.rows.map(r => {
                    const entry = entries.find(e => e.id === r.id) ?? null;
                    const Icon = entry ? ROLE_ICONS[entry.role] : ListChecks;
                    return (
                      <div key={r.id} className="px-5 py-3 flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                          <Icon className="w-4 h-4 text-slate-500" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-slate-900 font-medium truncate">{r.description}</p>
                          <p className="text-xs text-slate-400 mt-0.5 tabular-nums">
                            {fmtDate(r.date)} · Balance {mmkFmt(r.balance)}
                          </p>
                        </div>
                        <span className={`text-sm font-semibold tabular-nums shrink-0 ${r.debit ? "text-pale-red-foreground" : "text-pale-green-foreground"}`}>
                          {r.debit ? "-" : "+"}{mmkFmt(r.debit || r.credit)}
                        </span>
                        <button
                          onClick={() => entry && handleDeleteEntry(entry)}
                          disabled={!entry || deletingId === entry?.id}
                          aria-label="Delete entry"
                          className="shrink-0 text-slate-300 hover:text-red-500 disabled:opacity-40 transition-colors p-1"
                        >
                          {entry && deletingId === entry.id
                            ? <Loader2 className="w-4 h-4 animate-spin" />
                            : <Trash2 className="w-4 h-4" />}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="px-5 py-2.5 bg-slate-50 flex items-center justify-between border-t border-slate-100 text-xs">
                <span className="italic text-slate-500">Period Totals</span>
                <span className="tabular-nums text-slate-600">
                  {ledger.totalDebit > 0 && <span className="text-pale-red-foreground">-{mmkFmt(ledger.totalDebit)}</span>}
                  {ledger.totalDebit > 0 && ledger.totalCredit > 0 && <span className="mx-1.5 text-slate-300">·</span>}
                  {ledger.totalCredit > 0 && <span className="text-pale-green-foreground">+{mmkFmt(ledger.totalCredit)}</span>}
                </span>
              </div>
              <div className="px-5 py-3 bg-slate-100 border-t-2 border-slate-800 flex items-center justify-between">
                <span className="text-sm font-bold text-slate-900">Closing Balance</span>
                <span className="text-sm font-bold text-slate-900 tabular-nums">{mmkFmt(ledger.closingBalance)}</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
