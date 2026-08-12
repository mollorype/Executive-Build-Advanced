import { useEffect, useState, useCallback } from "react";
import { supabase, Shift, TABLES, COLS, mapRowToShift } from "@/lib/supabase";
import {
  DebtProfile, DEBT_TABLES, RELATIONS, RECEIVABLES_EXCLUDED_RELATIONS, computeReceivables, mmkFmt,
} from "@/lib/debt-supabase";
import ShiftDetailPanel from "@/components/shift-detail-panel";
import ShiftEditDialog from "@/components/shift-edit-dialog";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import {
  BarChart3, DollarSign, AlertTriangle, Users,
  ChevronRight, TrendingUp, RefreshCw,
  ChevronLeft, ChevronRight as ChevronRightIcon,
  Calendar, Trash2, X, Pencil, Banknote,
} from "lucide-react";

const PAGE_SIZE = 20;
const RED_FLAG_THRESHOLD = 10_000;

function mmk(val: number | null | undefined) {
  if (val == null) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(val) + " MMK";
}

function formatDateTime(ts: string) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

type DatePreset = "all" | "this_week" | "last_week" | "this_month" | "last_month" | "custom";

function getPresetRange(preset: DatePreset): { from: string; to: string } | null {
  const now = new Date();
  const toISO = (d: Date) => d.toISOString();

  if (preset === "this_week") {
    const mon = new Date(now);
    mon.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    mon.setHours(0, 0, 0, 0);
    return { from: toISO(mon), to: toISO(now) };
  }
  if (preset === "last_week") {
    const mon = new Date(now);
    mon.setDate(now.getDate() - ((now.getDay() + 6) % 7) - 7);
    mon.setHours(0, 0, 0, 0);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    sun.setHours(23, 59, 59, 999);
    return { from: toISO(mon), to: toISO(sun) };
  }
  if (preset === "this_month") {
    const from = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    return { from: toISO(from), to: toISO(now) };
  }
  if (preset === "last_month") {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
    const to = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    return { from: toISO(from), to: toISO(to) };
  }
  return null;
}

export default function Dashboard() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedShift, setSelectedShift] = useState<Shift | null>(null);

  const [preset, setPreset] = useState<DatePreset>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [page, setPage] = useState(0);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [editingShift, setEditingShift] = useState<Shift | null>(null);

  const [debtProfiles, setDebtProfiles] = useState<DebtProfile[]>([]);

  const fetchDebtProfiles = useCallback(async () => {
    const { data } = await supabase.from(DEBT_TABLES.PROFILES).select("id, relation, current_balance");
    if (data) setDebtProfiles(data as DebtProfile[]);
  }, []);

  useEffect(() => {
    fetchDebtProfiles();
    const channel = supabase
      .channel("debt-profiles-dashboard")
      .on("postgres_changes", { event: "*", schema: "public", table: DEBT_TABLES.PROFILES }, () => {
        fetchDebtProfiles();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchDebtProfiles]);

  const fetchShifts = useCallback(async (currentPage: number) => {
    const from = currentPage * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = supabase
      .from(TABLES.SHIFTS)
      .select("*", { count: "exact" })
      .order(COLS.TIMESTAMP, { ascending: false })
      .range(from, to);

    let range: { from: string; to: string } | null = null;
    if (preset === "custom" && customFrom && customTo) {
      const fromDt = new Date(customFrom);
      fromDt.setHours(0, 0, 0, 0);
      const toDt = new Date(customTo);
      toDt.setHours(23, 59, 59, 999);
      range = { from: fromDt.toISOString(), to: toDt.toISOString() };
    } else if (preset !== "all") {
      range = getPresetRange(preset);
    }

    if (range) {
      query = query.gte(COLS.TIMESTAMP, range.from).lte(COLS.TIMESTAMP, range.to);
    }

    const { data, error, count } = await query;

    if (!error && data) {
      setShifts((data as Record<string, unknown>[]).map(mapRowToShift));
      setTotalCount(count ?? 0);
    }
  }, [preset, customFrom, customTo]);

  const [priceHistory, setPriceHistory] = useState<Shift[]>([]);

  const fetchPriceHistory = useCallback(async () => {
    let query = supabase
      .from(TABLES.SHIFTS)
      .select("*")
      .order(COLS.TIMESTAMP, { ascending: true })
      .limit(300);

    let range: { from: string; to: string } | null = null;
    if (preset === "custom" && customFrom && customTo) {
      const fromDt = new Date(customFrom);
      fromDt.setHours(0, 0, 0, 0);
      const toDt = new Date(customTo);
      toDt.setHours(23, 59, 59, 999);
      range = { from: fromDt.toISOString(), to: toDt.toISOString() };
    } else if (preset !== "all") {
      range = getPresetRange(preset);
    }

    if (range) {
      query = query.gte(COLS.TIMESTAMP, range.from).lte(COLS.TIMESTAMP, range.to);
    }

    const { data, error } = await query;

    if (!error && data) {
      setPriceHistory((data as Record<string, unknown>[]).map(mapRowToShift));
    }
  }, [preset, customFrom, customTo]);

  useEffect(() => {
    setPage(0);
    setLoading(true);
    fetchShifts(0).finally(() => setLoading(false));
    fetchPriceHistory();

    const channel = supabase
      .channel("shifts-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: TABLES.SHIFTS }, () => {
        fetchShifts(0);
        fetchPriceHistory();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchShifts, fetchPriceHistory]);

  useEffect(() => {
    if (!loading) fetchShifts(page);
  }, [page]);

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === shifts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(shifts.map(s => s.id)));
    }
  }

  async function deleteShiftIds(ids: string[]): Promise<string | null> {
    const { data, error } = await supabase
      .from(TABLES.SHIFTS)
      .delete()
      .in("id", ids)
      .select("id");
    if (error) return error.message;
    if (!data || data.length === 0) return "Supabase blocked the delete — go to Supabase → Table Editor → daily_sales_reports → RLS Policies and add a DELETE policy (e.g. USING (true)).";
    return null;
  }

  async function handleDeleteShift(shift: Shift) {
    if (!window.confirm(`Delete shift by "${shift.employee_username || "unknown"}"?\n\nThis cannot be undone.`)) return;
    setDeleting(true);
    setDeleteError("");
    const err = await deleteShiftIds([shift.id]);
    setDeleting(false);
    if (err) { setDeleteError(err); return; }
    setSelectedIds(prev => { const n = new Set(prev); n.delete(shift.id); return n; });
    fetchShifts(page);
  }

  async function handleDeleteSelected() {
    const ids = [...selectedIds];
    if (!ids.length) return;
    if (!window.confirm(`Delete ${ids.length} selected shift${ids.length > 1 ? "s" : ""}?\n\nThis cannot be undone.`)) return;
    setDeleting(true);
    setDeleteError("");
    const err = await deleteShiftIds(ids);
    setDeleting(false);
    if (err) { setDeleteError(err); return; }
    setSelectedIds(new Set());
    fetchShifts(page);
  }

  async function handleRefresh() {
    setRefreshing(true);
    await fetchShifts(page);
    setRefreshing(false);
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const totalCollected = shifts.reduce((s, sh) => s + (sh.actual_cash_collected ?? 0), 0);
  const totalExpected = shifts.reduce((s, sh) => s + (sh.expected_cash_total ?? 0), 0);
  const redFlagCount = shifts.filter(s => Math.abs(s.difference ?? 0) >= RED_FLAG_THRESHOLD).length;
  const uniqueWorkers = new Set(shifts.map(s => s.employee_username).filter(Boolean)).size;

  const PRESETS: { value: DatePreset; label: string }[] = [
    { value: "all", label: "All Time" },
    { value: "this_week", label: "This Week" },
    { value: "last_week", label: "Last Week" },
    { value: "this_month", label: "This Month" },
    { value: "last_month", label: "Last Month" },
    { value: "custom", label: "Custom" },
  ];

  return (
    <div className="flex-1 overflow-auto">
      <div className="px-6 py-5 border-b border-slate-700/50">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Executive Dashboard</h1>
            <p className="text-slate-400 text-sm mt-0.5">Live shift ledger · STM Financial</p>
          </div>
          <div className="flex items-center gap-2">
            {selectedIds.size > 0 && (
              <button
                onClick={handleDeleteSelected}
                disabled={deleting}
                className="flex items-center gap-2 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white font-semibold rounded-xl px-4 py-2 text-sm transition-all"
              >
                <Trash2 className="w-4 h-4" />
                {deleting ? "Deleting…" : `Delete Selected (${selectedIds.size})`}
              </button>
            )}
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center gap-2 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-600/50 rounded-lg px-4 py-2 text-sm font-medium transition-all"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-5">
        {/* Total Debt Owned */}
        {(() => {
          const { owed, activeCount } = computeReceivables(debtProfiles);
          return (
            <div className="relative overflow-hidden rounded-xl border border-amber-500/20 bg-card shadow-sm p-5">
              <div className="relative flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center shrink-0">
                      <Banknote className="w-4 h-4 text-amber-400" />
                    </div>
                    <p className="text-xs font-bold text-amber-400/80 uppercase tracking-widest">Total Debt Owned</p>
                  </div>
                  <p className="text-slate-400 text-[11px] mt-1 ml-10">
                    {RELATIONS.filter(r => !RECEIVABLES_EXCLUDED_RELATIONS.has(r)).join(" · ")}
                  </p>
                  <p className="text-slate-600 text-[10px] ml-10 mt-0.5 italic">
                    Excludes {Array.from(RECEIVABLES_EXCLUDED_RELATIONS).join(", ")}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-3xl font-black tabular-nums text-amber-300 tracking-tight">{mmkFmt(owed)}</p>
                  <p className="text-xs text-slate-500 mt-1">
                    {activeCount} {activeCount === 1 ? "debtor" : "debtors"} with open balance
                  </p>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Date Filter */}
        <div className="bg-[#111827] border border-slate-700/50 rounded-xl p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Calendar className="w-4 h-4 text-slate-500 shrink-0" />
            <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider mr-1">Time Window:</span>
            {PRESETS.map(p => (
              <button
                key={p.value}
                onClick={() => { setPreset(p.value); setPage(0); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  preset === p.value
                    ? "bg-blue-600 text-white"
                    : "bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 border border-slate-700"
                }`}
              >
                {p.label}
              </button>
            ))}
            {preset === "custom" && (
              <div className="flex items-center gap-2 ml-2">
                <input
                  type="date"
                  value={customFrom}
                  onChange={e => { setCustomFrom(e.target.value); setPage(0); }}
                  className="bg-slate-800 border border-slate-700 text-white text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <span className="text-slate-500 text-xs">→</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={e => { setCustomTo(e.target.value); setPage(0); }}
                  className="bg-slate-800 border border-slate-700 text-white text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-[#111827] border border-slate-700/50 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
                <DollarSign className="w-4 h-4 text-blue-400" />
              </div>
              <span className="text-slate-400 text-xs font-medium uppercase tracking-wider">Actual Collected</span>
            </div>
            <p className="text-lg font-bold text-white tabular-nums">{mmk(totalCollected)}</p>
            <p className="text-slate-500 text-xs mt-1">This page</p>
          </div>

          <div className="bg-[#111827] border border-slate-700/50 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-slate-500/20 flex items-center justify-center">
                <TrendingUp className="w-4 h-4 text-slate-400" />
              </div>
              <span className="text-slate-400 text-xs font-medium uppercase tracking-wider">Expected Total</span>
            </div>
            <p className="text-lg font-bold text-white tabular-nums">{mmk(totalExpected)}</p>
            <p className="text-slate-500 text-xs mt-1">This page</p>
          </div>

          <div className="bg-[#111827] border border-slate-700/50 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-red-500/20 flex items-center justify-center">
                <AlertTriangle className="w-4 h-4 text-red-400" />
              </div>
              <span className="text-slate-400 text-xs font-medium uppercase tracking-wider">Red Flags</span>
            </div>
            <p className="text-lg font-bold text-white">{redFlagCount}</p>
            <p className="text-slate-500 text-xs mt-1">≥ 10,000 MMK diff</p>
          </div>

          <div className="bg-[#111827] border border-slate-700/50 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-slate-500/20 flex items-center justify-center">
                <Users className="w-4 h-4 text-slate-400" />
              </div>
              <span className="text-slate-400 text-xs font-medium uppercase tracking-wider">Total Shifts</span>
            </div>
            <p className="text-lg font-bold text-white">{totalCount}</p>
            <p className="text-slate-500 text-xs mt-1">{uniqueWorkers} workers this page</p>
          </div>
        </div>

        {/* Fuel Price History */}
        <div className="bg-[#111827] border border-slate-700/50 rounded-xl overflow-hidden p-4">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-4 h-4 text-blue-400" />
            <h2 className="text-white font-semibold text-sm">Fuel Price History</h2>
          </div>
          {(() => {
            const priceChartData = priceHistory
              .filter(s => s.fuel_92_price != null || s.fuel_95_price != null || s.premium_diesel_price != null || s.diesel_price != null)
              .map(s => ({
                date: new Date(s.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
                "92": s.fuel_92_price,
                "95": s.fuel_95_price,
                "PD": s.premium_diesel_price,
                "Diesel": s.diesel_price,
              }));

            if (priceChartData.length === 0) {
              return <div className="py-12 text-center text-slate-500 text-sm">No price data in this time window</div>;
            }

            const PRICE_SERIES = [
              { key: "92", label: "92 RON", color: "hsl(var(--chart-1))" },
              { key: "95", label: "95 RON", color: "hsl(var(--chart-2))" },
              { key: "PD", label: "Premium Diesel", color: "hsl(var(--chart-3))" },
              { key: "Diesel", label: "Diesel", color: "hsl(var(--chart-5))" },
            ] as const;

            return (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={priceChartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="date" stroke="#475569" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={{ stroke: "#334155" }} />
                  <YAxis stroke="#475569" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} width={56} />
                  <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "8px", fontSize: "12px" }} labelStyle={{ color: "#94a3b8" }} />
                  <Legend wrapperStyle={{ fontSize: "12px" }} />
                  {PRICE_SERIES.map(s => (
                    <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={false} connectNulls />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            );
          })()}
        </div>

        {/* Ledger Table */}
        <div className="bg-[#111827] border border-slate-700/50 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-700/50 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-blue-400" />
            <h2 className="text-white font-semibold text-sm">Shift Ledger</h2>
            <div className="ml-auto flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-slate-500 text-xs">Live</span>
            </div>
          </div>

          {deleteError && (
            <div className="mx-5 mt-4 flex items-start gap-2 bg-red-900/30 border border-red-700/40 rounded-xl px-4 py-3 text-xs text-red-300">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{deleteError}</span>
              <button onClick={() => setDeleteError("")} className="ml-auto text-red-400 hover:text-red-200"><X className="w-3.5 h-3.5" /></button>
            </div>
          )}

          {/* Select-all bar */}
          {shifts.length > 0 && !loading && (
            <div className="px-4 py-2.5 border-b border-slate-700/30 flex items-center gap-3">
              <input type="checkbox"
                checked={selectedIds.size === shifts.length}
                onChange={toggleSelectAll}
                className="w-4 h-4 rounded accent-red-500 cursor-pointer"
              />
              <span className="text-slate-500 text-xs">
                {selectedIds.size > 0 ? `${selectedIds.size} selected` : `${shifts.length} shifts`}
              </span>
            </div>
          )}

          {loading ? (
            <div className="p-16 text-center">
              <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mx-auto mb-3" />
              <p className="text-slate-500 text-sm">Loading shift data...</p>
            </div>
          ) : shifts.length === 0 ? (
            <div className="p-16 text-center">
              <BarChart3 className="w-10 h-10 text-slate-700 mx-auto mb-3" />
              <p className="text-slate-400 text-sm font-medium">No shifts in this time window</p>
              <p className="text-slate-600 text-xs mt-1">Try a different date range or check your Supabase table</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-700/20">
              {/* Desktop table header */}
              <div className="hidden md:flex items-center gap-3 px-4 py-2 bg-slate-800/50 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                <div className="w-4 shrink-0" />
                <div className="flex-1">Date & Time</div>
                <div className="w-28 shrink-0">Employee</div>
                <div className="w-36 shrink-0 text-right text-amber-500/80">Total Sales</div>
                <div className="w-32 shrink-0 text-right">Actual Cash</div>
                <div className="w-32 shrink-0 text-right">Exp. Cash</div>
                <div className="w-28 shrink-0 text-right">Difference</div>
                <div className="w-14 shrink-0" />
              </div>

              {shifts.map(shift => {
                const diff = shift.difference ?? 0;
                const isRedFlag = Math.abs(diff) >= RED_FLAG_THRESHOLD;
                const isSelected = selectedIds.has(shift.id);

                // Full grand total including pipa & jelly can (for display/reporting)
                const jellyTotal = (shift.jelly_can_items ?? []).reduce((s, i) => s + i.total, 0);
                const totalSales = (shift.fuel_92_total ?? 0) + (shift.fuel_95_total ?? 0)
                  + (shift.premium_diesel_total ?? 0) + (shift.pipa_total ?? 0)
                  + jellyTotal + (shift.diesel_cash ?? 0);

                return (
                  <div
                    key={shift.id}
                    onClick={() => setSelectedShift(shift)}
                    className={`group flex items-center gap-3 px-4 py-3 md:py-2.5 cursor-pointer transition-colors ${
                      isRedFlag
                        ? "bg-red-900/20 hover:bg-red-900/30"
                        : isSelected
                        ? "bg-blue-900/10 hover:bg-blue-900/15"
                        : "hover:bg-slate-700/20"
                    }`}
                  >
                    {/* Checkbox */}
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(shift.id)}
                      onClick={e => e.stopPropagation()}
                      className="w-4 h-4 rounded accent-red-500 cursor-pointer shrink-0"
                    />

                    {/* Left info column */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        {isRedFlag && <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />}
                        <span className="text-slate-300 text-xs font-medium truncate">
                          {formatDateTime(shift.created_at)}
                        </span>
                        {shift.employee_username && (
                          <span className="text-slate-600 text-xs shrink-0 md:hidden">· {shift.employee_username}</span>
                        )}
                      </div>
                      {/* Mobile-only: sales total + actual cash + diff */}
                      <div className="flex items-baseline justify-between gap-2 mt-1 md:hidden">
                        <div>
                          <span className="text-amber-500/70 text-[11px]">Sales: </span>
                          <span className="text-amber-300 font-bold text-sm tabular-nums">
                            {mmk(totalSales)}
                          </span>
                        </div>
                        <span className={`font-bold text-sm tabular-nums shrink-0 ${
                          isRedFlag ? "text-red-300" : diff >= 0 ? "text-emerald-400" : "text-amber-400"
                        }`}>
                          {diff >= 0 ? "+" : ""}{mmk(diff)}
                        </span>
                      </div>
                      <div className="flex items-baseline gap-2 mt-0.5 md:hidden">
                        <span className="text-slate-500 text-[11px]">Cash: </span>
                        <span className="text-white font-semibold text-xs tabular-nums">
                          {mmk(shift.actual_cash_collected)}
                        </span>
                      </div>
                    </div>

                    {/* Desktop-only columns */}
                    <div className="hidden md:block w-28 shrink-0 text-xs text-slate-400 truncate">
                      {shift.employee_username || "—"}
                    </div>
                    {/* Total Sales — amber to distinguish from cash figures */}
                    <div className="hidden md:block w-36 shrink-0 text-right">
                      <span className="text-amber-300 font-bold text-sm tabular-nums">
                        {mmk(totalSales)}
                      </span>
                    </div>
                    <div className="hidden md:block w-32 shrink-0 text-right">
                      <span className="text-white font-bold text-sm tabular-nums">
                        {mmk(shift.actual_cash_collected)}
                      </span>
                    </div>
                    <div className="hidden md:block w-32 shrink-0 text-right">
                      <span className="text-slate-400 text-sm tabular-nums">
                        {mmk(shift.expected_cash_total)}
                      </span>
                    </div>
                    <div className="hidden md:block w-28 shrink-0 text-right">
                      <span className={`font-bold text-sm tabular-nums ${
                        isRedFlag ? "text-red-300" : diff >= 0 ? "text-emerald-400" : "text-amber-400"
                      }`}>
                        {diff >= 0 ? "+" : ""}{mmk(diff)}
                      </span>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={e => { e.stopPropagation(); setEditingShift(shift); }}
                        className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-blue-400 hover:bg-blue-900/20 p-1.5 rounded-lg transition-all"
                        title="Edit shift"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); handleDeleteShift(shift); }}
                        className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 hover:bg-red-900/20 p-1.5 rounded-lg transition-all"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                      <ChevronRight className="w-4 h-4 text-slate-600" />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {totalPages > 1 && (
            <div className="px-5 py-4 border-t border-slate-700/40 flex items-center justify-between">
              <p className="text-slate-500 text-xs">
                Page {page + 1} of {totalPages} &nbsp;·&nbsp; {totalCount} total shifts
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 border border-slate-700 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-700 transition-all"
                >
                  <ChevronLeft className="w-3.5 h-3.5" /> Previous Page
                </button>
                <button
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 border border-slate-700 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-700 transition-all"
                >
                  Next Page <ChevronRightIcon className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-600">
          <div className="w-3 h-3 rounded border border-red-700/60" style={{ backgroundColor: "rgba(185,28,28,0.3)" }} />
          <span>Red rows: cash difference ≥ 10,000 MMK (surplus or deficit)</span>
        </div>
      </div>

      {selectedShift && (
        <ShiftDetailPanel shift={selectedShift} onClose={() => setSelectedShift(null)} />
      )}

      {editingShift && (
        <ShiftEditDialog
          shift={editingShift}
          onClose={() => setEditingShift(null)}
          onSaved={() => fetchShifts(page)}
        />
      )}
    </div>
  );
}
