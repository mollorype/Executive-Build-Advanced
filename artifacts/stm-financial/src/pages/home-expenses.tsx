import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { mmkFmt } from "@/lib/debt-supabase";
import {
  HOME_FAMILY_TABLE, HOME_EXPENSES_TABLE, HOME_EXPENSE_SETUP_SQL,
  HOME_EXPENSE_CATEGORIES, HOME_EXPENSE_CATEGORY_LABELS,
  todayStr, monthStartStr,
  type FamilyMember, type HomeExpense, type HomeExpenseCategory,
} from "@/lib/home-expenses";
import {
  Home, Users, Plus, X, Trash2, AlertCircle, Copy, Loader2, UserRound,
  Utensils, Car, HeartPulse, GraduationCap, Zap, MoreHorizontal, Wallet, CalendarDays, Receipt,
} from "lucide-react";

const CATEGORY_ICONS: Record<HomeExpenseCategory, typeof Utensils> = {
  food: Utensils,
  transport: Car,
  health: HeartPulse,
  education: GraduationCap,
  utilities: Zap,
  other: MoreHorizontal,
};

function n(v: string): number {
  const x = parseFloat(v.replace(/,/g, ""));
  return isNaN(x) ? 0 : x;
}

function dateLabel(dateStr: string): string {
  const today = todayStr();
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  if (dateStr === today) return "Today";
  if (dateStr === yesterday) return "Yesterday";
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
  });
}

export default function HomeExpenses() {
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [expenses, setExpenses] = useState<HomeExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [tableError, setTableError] = useState(false);
  const [copied, setCopied] = useState(false);

  // Family member management
  const [newMemberName, setNewMemberName] = useState("");
  const [addingMember, setAddingMember] = useState(false);
  const [memberError, setMemberError] = useState("");
  const [deletingMemberId, setDeletingMemberId] = useState<string | null>(null);

  // Expense form
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [category, setCategory] = useState<HomeExpenseCategory>("food");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [expenseDate, setExpenseDate] = useState(todayStr());
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [deletingExpenseId, setDeletingExpenseId] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    const [membersRes, expensesRes] = await Promise.all([
      supabase.from(HOME_FAMILY_TABLE).select("*").order("created_at", { ascending: true }),
      supabase.from(HOME_EXPENSES_TABLE).select("*").order("expense_date", { ascending: false }).order("created_at", { ascending: false }),
    ]);

    const missing = (e: { code?: string; message?: string } | null) =>
      !!e && (e.code === "42P01" || e.code === "PGRST116" || (e.message?.includes("does not exist") ?? false));

    if (missing(membersRes.error) || missing(expensesRes.error)) {
      setTableError(true);
    } else {
      setTableError(false);
      if (membersRes.data) setMembers(membersRes.data as FamilyMember[]);
      if (expensesRes.data) setExpenses(expensesRes.data as HomeExpense[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    if (!selectedMemberId && members.length > 0) setSelectedMemberId(members[0].id);
  }, [members, selectedMemberId]);

  function handleCopy() {
    navigator.clipboard.writeText(HOME_EXPENSE_SETUP_SQL);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleAddMember(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newMemberName.trim();
    if (!trimmed) return;

    setAddingMember(true);
    setMemberError("");
    const { error } = await supabase.from(HOME_FAMILY_TABLE).insert({ name: trimmed });
    setAddingMember(false);

    if (error) {
      setMemberError(error.code === "23505" ? `${trimmed} is already on the list.` : error.message);
      return;
    }
    setNewMemberName("");
    fetchAll();
  }

  async function handleDeleteMember(member: FamilyMember) {
    if (!window.confirm(`Remove ${member.name} from family members?\nPast expenses logged for them are kept, just unlinked.`)) return;
    setDeletingMemberId(member.id);
    await supabase.from(HOME_FAMILY_TABLE).delete().eq("id", member.id);
    setDeletingMemberId(null);
    if (selectedMemberId === member.id) setSelectedMemberId("");
    fetchAll();
  }

  async function handleAddExpense(e: React.FormEvent) {
    e.preventDefault();
    const member = members.find(m => m.id === selectedMemberId);
    if (!member) {
      setFormError("Add a family member first.");
      return;
    }
    const amt = n(amount);
    if (amt <= 0) {
      setFormError("Enter an amount greater than zero.");
      return;
    }

    setSubmitting(true);
    setFormError("");
    const { error } = await supabase.from(HOME_EXPENSES_TABLE).insert({
      member_id: member.id,
      member_name: member.name,
      category,
      amount: amt,
      note: note.trim() || null,
      expense_date: expenseDate,
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

  async function handleDeleteExpense(expense: HomeExpense) {
    if (!window.confirm(`Delete this ${HOME_EXPENSE_CATEGORY_LABELS[expense.category]} expense of ${mmkFmt(expense.amount)}?`)) return;
    setDeletingExpenseId(expense.id);
    await supabase.from(HOME_EXPENSES_TABLE).delete().eq("id", expense.id);
    setDeletingExpenseId(null);
    fetchAll();
  }

  const totalToday = useMemo(
    () => expenses.filter(e => e.expense_date === todayStr()).reduce((s, e) => s + e.amount, 0),
    [expenses]
  );
  const monthExpenses = useMemo(
    () => expenses.filter(e => e.expense_date >= monthStartStr()),
    [expenses]
  );
  const totalThisMonth = useMemo(() => monthExpenses.reduce((s, e) => s + e.amount, 0), [monthExpenses]);

  const categoryBreakdown = useMemo(() => {
    const sums = new Map<HomeExpenseCategory, number>();
    for (const e of monthExpenses) sums.set(e.category, (sums.get(e.category) ?? 0) + e.amount);
    return HOME_EXPENSE_CATEGORIES
      .map(c => ({ category: c, total: sums.get(c) ?? 0 }))
      .filter(row => row.total > 0)
      .sort((a, b) => b.total - a.total);
  }, [monthExpenses]);

  const groupedExpenses = useMemo(() => {
    const groups: { date: string; items: HomeExpense[] }[] = [];
    for (const e of expenses) {
      const last = groups[groups.length - 1];
      if (last && last.date === e.expense_date) last.items.push(e);
      else groups.push({ date: e.expense_date, items: [e] });
    }
    return groups;
  }, [expenses]);

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
        <h1 className="text-2xl font-bold text-slate-900">Home Expense</h1>
        <p className="text-slate-400 text-sm mt-0.5">Track your family's day-to-day spending</p>
      </div>

      <div className="p-6 max-w-3xl space-y-5">
        {tableError ? (
          <div className="bg-pale-gold border border-amber-100 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <AlertCircle className="w-5 h-5 text-pale-gold-foreground shrink-0" />
              <p className="text-pale-gold-foreground font-semibold text-sm">One-time setup required</p>
            </div>
            <p className="text-pale-gold-foreground/80 text-xs mb-3">
              Run this SQL once in your Supabase SQL Editor to enable Home Expense tracking:
            </p>
            <pre className="bg-slate-900 rounded-lg p-3 text-xs text-slate-100 font-mono overflow-x-auto whitespace-pre-wrap mb-3">
              {HOME_EXPENSE_SETUP_SQL}
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
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="bg-white border border-slate-100 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-pale-blue flex items-center justify-center">
                    <Wallet className="w-4 h-4 text-pale-blue-foreground" />
                  </div>
                  <span className="text-slate-400 text-xs font-medium uppercase tracking-wider">Today</span>
                </div>
                <p className="text-xl font-bold text-slate-900 tabular-nums">{mmkFmt(totalToday)}</p>
              </div>
              <div className="bg-white border border-slate-100 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-pale-gold flex items-center justify-center">
                    <Receipt className="w-4 h-4 text-pale-gold-foreground" />
                  </div>
                  <span className="text-slate-400 text-xs font-medium uppercase tracking-wider">This Month</span>
                </div>
                <p className="text-xl font-bold text-slate-900 tabular-nums">{mmkFmt(totalThisMonth)}</p>
              </div>
              <div className="bg-white border border-slate-100 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-pale-green flex items-center justify-center">
                    <Users className="w-4 h-4 text-pale-green-foreground" />
                  </div>
                  <span className="text-slate-400 text-xs font-medium uppercase tracking-wider">Family Members</span>
                </div>
                <p className="text-xl font-bold text-slate-900 tabular-nums">{members.length}</p>
              </div>
            </div>

            {/* Category breakdown */}
            {categoryBreakdown.length > 0 && (
              <div className="bg-white border border-slate-100 shadow-sm rounded-2xl p-5">
                <p className="text-slate-900 font-semibold text-sm mb-4">This Month by Category</p>
                <div className="space-y-3">
                  {categoryBreakdown.map(row => {
                    const Icon = CATEGORY_ICONS[row.category];
                    const pct = totalThisMonth > 0 ? (row.total / totalThisMonth) * 100 : 0;
                    return (
                      <div key={row.category}>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="flex items-center gap-1.5 text-slate-600 font-medium">
                            <Icon className="w-3.5 h-3.5 text-slate-400" />
                            {HOME_EXPENSE_CATEGORY_LABELS[row.category]}
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

            {/* Family members */}
            <div className="bg-white border border-slate-100 shadow-sm rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
                <Users className="w-4 h-4 text-pale-blue-foreground" />
                <h2 className="text-slate-900 font-semibold text-sm">Family Members</h2>
              </div>
              <div className="p-5 space-y-3">
                {members.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {members.map(member => (
                      <span key={member.id} className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-full pl-1 pr-2 py-1">
                        <span className="w-6 h-6 rounded-full bg-pale-blue flex items-center justify-center text-[11px] font-bold text-pale-blue-foreground uppercase shrink-0">
                          {member.name[0]}
                        </span>
                        <span className="text-sm text-slate-700 font-medium">{member.name}</span>
                        <button
                          onClick={() => handleDeleteMember(member)}
                          disabled={deletingMemberId === member.id}
                          aria-label={`Remove ${member.name}`}
                          className="text-slate-300 hover:text-red-500 disabled:opacity-40 transition-colors ml-0.5"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                {members.length === 0 && (
                  <div className="text-center py-4">
                    <UserRound className="w-7 h-7 text-slate-200 mx-auto mb-2" />
                    <p className="text-slate-400 text-sm">No family members yet. Add one below to start logging expenses.</p>
                  </div>
                )}
                <form onSubmit={handleAddMember} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newMemberName}
                    onChange={e => setNewMemberName(e.target.value)}
                    placeholder="Family member name"
                    className="flex-1 bg-white border border-slate-100 text-slate-900 text-sm rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder:text-slate-400"
                  />
                  <button
                    type="submit"
                    disabled={addingMember || !newMemberName.trim()}
                    className="flex items-center gap-1.5 bg-primary hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed text-primary-foreground font-semibold text-sm rounded-xl px-4 py-2.5 transition-all shrink-0"
                  >
                    {addingMember ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    Add
                  </button>
                </form>
                {memberError && <p className="text-pale-red-foreground text-xs">{memberError}</p>}
              </div>
            </div>

            {/* Log an expense */}
            <div className="bg-white border border-slate-100 shadow-sm rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
                <Home className="w-4 h-4 text-pale-blue-foreground" />
                <h2 className="text-slate-900 font-semibold text-sm">Log an Expense</h2>
              </div>
              <form onSubmit={handleAddExpense} className="p-5 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Family Member</label>
                  <select
                    value={selectedMemberId}
                    onChange={e => setSelectedMemberId(e.target.value)}
                    disabled={members.length === 0}
                    className="w-full bg-white border border-slate-100 text-slate-900 text-sm rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-40"
                  >
                    {members.length === 0 && <option value="">Add a family member first</option>}
                    {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Category</label>
                  <div className="flex flex-wrap gap-2">
                    {HOME_EXPENSE_CATEGORIES.map(c => {
                      const Icon = CATEGORY_ICONS[c];
                      const active = category === c;
                      return (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setCategory(c)}
                          className={`flex items-center gap-1.5 text-xs font-semibold rounded-full px-3 py-1.5 border transition-all ${
                            active
                              ? "bg-pale-blue border-blue-200 text-pale-blue-foreground"
                              : "bg-white border-slate-200 text-slate-500 hover:border-slate-300"
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                          {HOME_EXPENSE_CATEGORY_LABELS[c]}
                        </button>
                      );
                    })}
                  </div>
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
                      <CalendarDays className="w-3.5 h-3.5" /> Date
                    </label>
                    <input
                      type="date"
                      value={expenseDate}
                      onChange={e => setExpenseDate(e.target.value)}
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
                    placeholder="e.g. Groceries at the market"
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
                  disabled={submitting || members.length === 0}
                  className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-xl py-3 text-sm transition-all"
                >
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  {submitting ? "Saving…" : "Add Expense"}
                </button>
              </form>
            </div>

            {/* Expense list */}
            <div className="bg-white border border-slate-100 shadow-sm rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
                <Receipt className="w-4 h-4 text-pale-blue-foreground" />
                <h2 className="text-slate-900 font-semibold text-sm">Expense History</h2>
              </div>

              {groupedExpenses.length === 0 ? (
                <div className="px-6 py-10 text-center">
                  <Receipt className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                  <p className="text-slate-400 text-sm">No expenses logged yet.</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {groupedExpenses.map(group => {
                    const dayTotal = group.items.reduce((s, e) => s + e.amount, 0);
                    return (
                      <div key={group.date}>
                        <div className="px-5 py-2.5 bg-slate-50 flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">{dateLabel(group.date)}</span>
                          <span className="text-xs font-semibold text-slate-500 tabular-nums">{mmkFmt(dayTotal)}</span>
                        </div>
                        {group.items.map(expense => {
                          const Icon = CATEGORY_ICONS[expense.category];
                          return (
                            <div key={expense.id} className="px-5 py-3 flex items-center gap-3">
                              <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                                <Icon className="w-4 h-4 text-slate-500" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm text-slate-900 font-medium truncate">
                                  {expense.member_name}
                                  <span className="text-slate-400 font-normal"> · {HOME_EXPENSE_CATEGORY_LABELS[expense.category]}</span>
                                </p>
                                {expense.note && <p className="text-xs text-slate-400 truncate mt-0.5">{expense.note}</p>}
                              </div>
                              <span className="text-sm font-semibold text-slate-900 tabular-nums shrink-0">{mmkFmt(expense.amount)}</span>
                              <button
                                onClick={() => handleDeleteExpense(expense)}
                                disabled={deletingExpenseId === expense.id}
                                aria-label="Delete expense"
                                className="shrink-0 text-slate-300 hover:text-red-500 disabled:opacity-40 transition-colors p-1"
                              >
                                {deletingExpenseId === expense.id
                                  ? <Loader2 className="w-4 h-4 animate-spin" />
                                  : <Trash2 className="w-4 h-4" />}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
