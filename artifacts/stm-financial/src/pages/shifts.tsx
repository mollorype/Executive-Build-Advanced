import { useEffect, useState, useCallback } from "react";
import { supabase, Shift, TABLES, COLS, mapRowToShift, shiftTotalSales, RED_FLAG_THRESHOLD } from "@/lib/supabase";
import ShiftDetailPanel from "@/components/shift-detail-panel";
import ShiftEditDialog from "@/components/shift-edit-dialog";
import {
  BarChart3, DollarSign, AlertTriangle, Users,
  ChevronRight, TrendingUp, RefreshCw,
  ChevronLeft, ChevronRight as ChevronRightIcon,
  Calendar, Trash2, X, Pencil,
} from "lucide-react";

const PAGE_SIZE = 20;

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

export default function Shifts() {
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

  useEffect(() => {
    setPage(0);
    setLoading(true);
    fetchShifts(0).finally(() => setLoading(false));

    const channel = supabase
      .channel("shifts-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: TABLES.SHIFTS }, () => {
        fetchShifts(0);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchShifts]);

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
    if (!data || data.length === 0) return "The delete was blocked by a permissions rule. Contact your system administrator.";
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
    <div className="flex-1 overflow-auto bg-slate-50">
      <div className="px-6 py-5 border-b border-slate-100 bg-white">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Shifts</h1>
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
              className="flex items-center gap-2 text-slate-400 hover:text-slate-900 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg px-4 py-2 text-sm font-medium transition-all"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-5">
        {/* Date Filter */}
        <div className="bg-white border border-slate-100 rounded-xl p-4">
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
                    : "bg-white text-slate-400 hover:text-slate-900 hover:bg-slate-100 border border-slate-100"
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
                  aria-label="From date"
                  className="bg-white border border-slate-100 text-slate-900 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <span className="text-slate-500 text-xs">→</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={e => { setCustomTo(e.target.value); setPage(0); }}
                  aria-label="To date"
                  className="bg-white border border-slate-100 text-slate-900 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white border border-slate-100 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-pale-blue flex items-center justify-center">
                <DollarSign className="w-4 h-4 text-pale-blue-foreground" />
              </div>
              <span className="text-slate-400 text-xs font-medium uppercase tracking-wider">Actual Collected</span>
            </div>
            <p className="text-lg font-bold text-slate-900 tabular-nums">{mmk(totalCollected)}</p>
            <p className="text-slate-500 text-xs mt-1">This page</p>
          </div>

          <div className="bg-white border border-slate-100 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">
                <TrendingUp className="w-4 h-4 text-slate-500" />
              </div>
              <span className="text-slate-400 text-xs font-medium uppercase tracking-wider">Expected Total</span>
            </div>
            <p className="text-lg font-bold text-slate-900 tabular-nums">{mmk(totalExpected)}</p>
            <p className="text-slate-500 text-xs mt-1">This page</p>
          </div>

          <div className="bg-white border border-slate-100 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-pale-red flex items-center justify-center">
                <AlertTriangle className="w-4 h-4 text-pale-red-foreground" />
              </div>
              <span className="text-slate-400 text-xs font-medium uppercase tracking-wider">Red Flags</span>
            </div>
            <p className="text-lg font-bold text-slate-900">{redFlagCount}</p>
            <p className="text-slate-500 text-xs mt-1">≥ 10,000 MMK diff</p>
          </div>

          <div className="bg-white border border-slate-100 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">
                <Users className="w-4 h-4 text-slate-500" />
              </div>
              <span className="text-slate-400 text-xs font-medium uppercase tracking-wider">Total Shifts</span>
            </div>
            <p className="text-lg font-bold text-slate-900">{totalCount}</p>
            <p className="text-slate-500 text-xs mt-1">{uniqueWorkers} workers this page</p>
          </div>
        </div>

        {/* Ledger Table */}
        <div className="bg-white border border-slate-100 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-pale-blue-foreground" />
            <h2 className="text-slate-900 font-semibold text-sm">Shift Ledger</h2>
            <div className="ml-auto flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-slate-500 text-xs">Live</span>
            </div>
          </div>

          {deleteError && (
            <div className="mx-5 mt-4 flex items-start gap-2 bg-pale-red border border-red-100 rounded-xl px-4 py-3 text-xs text-pale-red-foreground">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{deleteError}</span>
              <button onClick={() => setDeleteError("")} aria-label="Dismiss error" className="ml-auto text-pale-red-foreground hover:opacity-70"><X className="w-3.5 h-3.5" /></button>
            </div>
          )}

          {/* Select-all bar */}
          {shifts.length > 0 && !loading && (
            <div className="px-4 py-2.5 border-b border-slate-100 flex items-center gap-3">
              <input type="checkbox"
                checked={selectedIds.size === shifts.length}
                onChange={toggleSelectAll}
                aria-label="Select all shifts"
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
              <p className="text-slate-500 text-sm">Loading shift data…</p>
            </div>
          ) : shifts.length === 0 ? (
            <div className="p-16 text-center">
              <BarChart3 className="w-10 h-10 text-slate-200 mx-auto mb-3" />
              <p className="text-slate-400 text-sm font-medium">No shifts in this time window</p>
              <p className="text-slate-400 text-xs mt-1">Try a different date range</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {/* Desktop table header */}
              <div className="hidden md:flex items-center gap-3 px-4 py-2 bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                <div className="w-4 shrink-0" />
                <div className="flex-1">Date & Time</div>
                <div className="w-28 shrink-0">Employee</div>
                <div className="w-36 shrink-0 text-right text-pale-gold-foreground/80">Total Sales</div>
                <div className="w-32 shrink-0 text-right">Actual Cash</div>
                <div className="w-32 shrink-0 text-right">Exp. Cash</div>
                <div className="w-28 shrink-0 text-right">Difference</div>
                <div className="w-14 shrink-0" />
              </div>

              {shifts.map(shift => {
                const diff = shift.difference ?? 0;
                const isRedFlag = Math.abs(diff) >= RED_FLAG_THRESHOLD;
                const isSelected = selectedIds.has(shift.id);
                const totalSales = shiftTotalSales(shift);

                return (
                  <div
                    key={shift.id}
                    onClick={() => setSelectedShift(shift)}
                    className={`group flex items-center gap-3 px-4 py-3 md:py-2.5 cursor-pointer transition-colors ${
                      isRedFlag
                        ? "bg-pale-red hover:bg-red-100"
                        : isSelected
                        ? "bg-pale-blue hover:bg-blue-100"
                        : "hover:bg-slate-50"
                    }`}
                  >
                    {/* Checkbox */}
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(shift.id)}
                      onClick={e => e.stopPropagation()}
                      aria-label={`Select shift by ${shift.employee_username || "unknown"}`}
                      className="w-4 h-4 rounded accent-red-500 cursor-pointer shrink-0"
                    />

                    {/* Left info column */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        {isRedFlag && <AlertTriangle className="w-3.5 h-3.5 text-pale-red-foreground shrink-0" />}
                        <span className="text-slate-700 text-xs font-medium truncate">
                          {formatDateTime(shift.created_at)}
                        </span>
                        {shift.employee_username && (
                          <span className="text-slate-600 text-xs shrink-0 md:hidden">· {shift.employee_username}</span>
                        )}
                      </div>
                      {/* Mobile-only: sales total + actual cash + diff */}
                      <div className="flex items-baseline justify-between gap-2 mt-1 md:hidden">
                        <div>
                          <span className="text-pale-gold-foreground/70 text-[11px]">Sales: </span>
                          <span className="text-pale-gold-foreground font-bold text-sm tabular-nums">
                            {mmk(totalSales)}
                          </span>
                        </div>
                        <span className={`font-bold text-sm tabular-nums shrink-0 ${
                          isRedFlag ? "text-pale-red-foreground" : diff >= 0 ? "text-pale-green-foreground" : "text-pale-gold-foreground"
                        }`}>
                          {diff >= 0 ? "+" : ""}{mmk(diff)}
                        </span>
                      </div>
                      <div className="flex items-baseline gap-2 mt-0.5 md:hidden">
                        <span className="text-slate-500 text-[11px]">Cash: </span>
                        <span className="text-slate-900 font-semibold text-xs tabular-nums">
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
                      <span className="text-pale-gold-foreground font-bold text-sm tabular-nums">
                        {mmk(totalSales)}
                      </span>
                    </div>
                    <div className="hidden md:block w-32 shrink-0 text-right">
                      <span className="text-slate-900 font-bold text-sm tabular-nums">
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
                        isRedFlag ? "text-pale-red-foreground" : diff >= 0 ? "text-pale-green-foreground" : "text-pale-gold-foreground"
                      }`}>
                        {diff >= 0 ? "+" : ""}{mmk(diff)}
                      </span>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={e => { e.stopPropagation(); setEditingShift(shift); }}
                        className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-pale-blue-foreground hover:bg-pale-blue p-1.5 rounded-lg transition-all"
                        title="Edit shift"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); handleDeleteShift(shift); }}
                        className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-pale-red-foreground hover:bg-pale-red p-1.5 rounded-lg transition-all"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                      <ChevronRight className="w-4 h-4 text-slate-300" />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {totalPages > 1 && (
            <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-between">
              <p className="text-slate-500 text-xs">
                Page {page + 1} of {totalPages} &nbsp;·&nbsp; {totalCount} total shifts
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-slate-200 text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition-all"
                >
                  <ChevronLeft className="w-3.5 h-3.5" /> Previous Page
                </button>
                <button
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-slate-200 text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition-all"
                >
                  Next Page <ChevronRightIcon className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-500">
          <div className="w-3 h-3 rounded border border-red-200" style={{ backgroundColor: "rgba(220,38,38,0.12)" }} />
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
