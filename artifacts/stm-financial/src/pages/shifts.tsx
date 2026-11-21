import { useEffect, useState, useCallback } from "react";
import { useLocation, useSearch } from "wouter";
import { supabase, Shift, TABLES, COLS, mapRowToShift, shiftTotalSales, RED_FLAG_THRESHOLD } from "@/lib/supabase";
import ShiftDetailPanel from "@/components/shift-detail-panel";
import ShiftEditDialog from "@/components/shift-edit-dialog";
import TelegramAlertsCard from "@/components/telegram-alerts-card";
import { makeT } from "@/lib/app-i18n";
import { confirmDialog } from "@/components/confirm-dialog";

const useT = makeT({
  badLink: { en: "That shift link isn't valid.", my: "ဤဆိုင်း link မမှန်ပါ။" },
  loadFail: { en: "Couldn't load that shift. Try again.", my: "ဆိုင်းကို မဖွင့်နိုင်ပါ။ ထပ်ကြိုးစားပါ။" },
  gone: { en: "That shift no longer exists — it may have been deleted.", my: "ဤဆိုင်း မရှိတော့ပါ — ဖျက်ထားနိုင်ပါသည်။" },
  blocked: { en: "The delete was blocked by a permissions rule. Contact your system administrator.", my: "ခွင့်ပြုချက် စည်းကမ်းကြောင့် မဖျက်နိုင်ပါ။" },
  confirmOne: { en: "Delete shift by \"{name}\"?\n\nThis cannot be undone.", my: "\"{name}\" ၏ ဆိုင်းကို ဖျက်မလား?\n\nပြန်ယူ၍ မရပါ။" },
  confirmMany: { en: "Delete {n} selected shift(s)?\n\nThis cannot be undone.", my: "ရွေးထားသော ဆိုင်း {n} ခုကို ဖျက်မလား?\n\nပြန်ယူ၍ မရပါ။" },
  unknown: { en: "unknown", my: "အမည်မသိ" },
  all: { en: "All Time", my: "အားလုံး" },
  thisWeek: { en: "This Week", my: "ဤအပတ်" },
  lastWeek: { en: "Last Week", my: "ပြီးခဲ့သောအပတ်" },
  thisMonth: { en: "This Month", my: "ဤလ" },
  lastMonth: { en: "Last Month", my: "ပြီးခဲ့သောလ" },
  custom: { en: "Custom", my: "စိတ်ကြိုက်" },
  title: { en: "Shifts", my: "ဆိုင်းစာရင်းများ" },
  subtitle: { en: "Live shift ledger · STM Financial", my: "တိုက်ရိုက် ဆိုင်းစာရင်း · STM Financial" },
  deleting: { en: "Deleting…", my: "ဖျက်နေသည်…" },
  deleteSelected: { en: "Delete Selected ({n})", my: "ရွေးထားသည်ကို ဖျက်ရန် ({n})" },
  dismiss: { en: "Dismiss", my: "ပိတ်ရန်" },
  refresh: { en: "Refresh", my: "ပြန်ဖွင့်ရန်" },
  timeWindow: { en: "Time Window:", my: "ကာလ:" },
  fromDate: { en: "From date", my: "မှ" },
  toDate: { en: "To date", my: "အထိ" },
  actualCollected: { en: "Actual Collected", my: "ရရှိငွေ အမှန်" },
  thisPage: { en: "This page", my: "ဤစာမျက်နှာ" },
  expectedTotal: { en: "Expected Total", my: "ရှိရမည့်ငွေ" },
  redFlags: { en: "Red Flags", my: "သတိပေးချက်များ" },
  redFlagHint: { en: "≥ 10,000 MMK diff", my: "ကွာခြားချက် ≥ 10,000 MMK" },
  totalShifts: { en: "Total Shifts", my: "ဆိုင်း စုစုပေါင်း" },
  workers: { en: "{n} workers this page", my: "ဤစာမျက်နှာတွင် ဝန်ထမ်း {n} ဦး" },
  ledger: { en: "Shift Ledger", my: "ဆိုင်းစာရင်း" },
  live: { en: "Live", my: "တိုက်ရိုက်" },
  dismissError: { en: "Dismiss error", my: "ပိတ်ရန်" },
  selectAll: { en: "Select all shifts", my: "ဆိုင်းအားလုံး ရွေးရန်" },
  selected: { en: "{n} selected", my: "{n} ခု ရွေးထား" },
  shiftsN: { en: "{n} shifts", my: "ဆိုင်း {n} ခု" },
  loading: { en: "Loading shift data…", my: "ဆိုင်းစာရင်း ဖွင့်နေသည်…" },
  none: { en: "No shifts in this time window", my: "ဤကာလတွင် ဆိုင်း မရှိပါ" },
  tryRange: { en: "Try a different date range", my: "အခြား ရက်ကာလ ရွေးကြည့်ပါ" },
  dateTime: { en: "Date & Time", my: "ရက်စွဲ နှင့် အချိန်" },
  employee: { en: "Employee", my: "ဝန်ထမ်း" },
  totalSales: { en: "Total Sales", my: "ရောင်းအား" },
  actualCash: { en: "Actual Cash", my: "ငွေသား အမှန်" },
  expCash: { en: "Exp. Cash", my: "ရှိရမည့်ငွေ" },
  difference: { en: "Difference", my: "ကွာခြားချက်" },
  selectShift: { en: "Select shift by {name}", my: "{name} ၏ ဆိုင်းကို ရွေးရန်" },
  salesLabel: { en: "Sales: ", my: "ရောင်းအား: " },
  cashLabel: { en: "Cash: ", my: "ငွေသား: " },
  editShift: { en: "Edit shift", my: "ဆိုင်း ပြင်ရန်" },
  deleteShift: { en: "Delete shift", my: "ဆိုင်း ဖျက်ရန်" },
  page: { en: "Page {p} of {n} · {total} total shifts", my: "စာမျက်နှာ {p} / {n} · ဆိုင်း စုစုပေါင်း {total} ခု" },
  prev: { en: "Previous Page", my: "ယခင်" },
  next: { en: "Next Page", my: "နောက်" },
  legend: { en: "Red rows: cash difference ≥ 10,000 MMK (surplus or deficit)", my: "အနီရောင် အတန်း: ငွေ ကွာခြားချက် ≥ 10,000 MMK (ပို သို့မဟုတ် လို)" },
});
import {
  BarChart3, DollarSign, AlertTriangle, Users,
  ChevronRight, TrendingUp, RefreshCw,
  ChevronLeft, ChevronRight as ChevronRightIcon,
  Calendar, Trash2, X, Pencil,
} from "lucide-react";

const PAGE_SIZE = 20;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  const t = useT();
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

  // Deep link: /shifts?shift=<id> (the Telegram alert's "View shift details"
  // button) opens that shift directly, even if it isn't on the current page.
  const [, setLocation] = useLocation();
  const linkedShiftId = new URLSearchParams(useSearch()).get("shift");
  const [linkError, setLinkError] = useState("");

  useEffect(() => {
    if (!linkedShiftId) return;
    setLinkError("");
    if (!UUID_RE.test(linkedShiftId)) {
      setLinkError(t("badLink"));
      return;
    }
    let cancelled = false;
    supabase.from(TABLES.SHIFTS).select("*").eq("id", linkedShiftId).maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (data) setSelectedShift(mapRowToShift(data as Record<string, unknown>));
        else setLinkError(error ? t("loadFail") : t("gone"));
      });
    return () => { cancelled = true; };
  }, [linkedShiftId]);

  function closeShiftPanel() {
    setSelectedShift(null);
    // Drop ?shift= so a refresh doesn't reopen it.
    if (linkedShiftId) setLocation("/shifts", { replace: true });
  }

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
    if (!data || data.length === 0) return t("blocked");
    return null;
  }

  async function handleDeleteShift(shift: Shift) {
    if (!(await confirmDialog(t("confirmOne", { name: shift.employee_username || t("unknown") }), { danger: true }))) return;
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
    if (!(await confirmDialog(t("confirmMany", { n: ids.length }), { danger: true }))) return;
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
    { value: "all", label: t("all") },
    { value: "this_week", label: t("thisWeek") },
    { value: "last_week", label: t("lastWeek") },
    { value: "this_month", label: t("thisMonth") },
    { value: "last_month", label: t("lastMonth") },
    { value: "custom", label: t("custom") },
  ];

  return (
    <div className="flex-1 overflow-auto bg-slate-50">
      <div className="px-6 py-5 border-b border-slate-100 bg-white">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{t("title")}</h1>
            <p className="text-slate-400 text-sm mt-0.5">{t("subtitle")}</p>
          </div>
          <div className="flex items-center gap-2">
            {selectedIds.size > 0 && (
              <button
                onClick={handleDeleteSelected}
                disabled={deleting}
                className="flex items-center gap-2 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white font-semibold rounded-xl px-4 py-2 text-sm transition-all"
              >
                <Trash2 className="w-4 h-4" />
                {deleting ? t("deleting") : t("deleteSelected", { n: selectedIds.size })}
              </button>
            )}
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center gap-2 text-slate-400 hover:text-slate-900 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg px-4 py-2 text-sm font-medium transition-all"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
              {t("refresh")}
            </button>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-5">
        {linkError && (
          <div role="alert" className="flex items-start gap-2 bg-pale-red border border-red-200 rounded-xl px-4 py-3 text-sm text-pale-red-foreground">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="flex-1">{linkError}</span>
            <button
              onClick={() => { setLinkError(""); setLocation("/shifts", { replace: true }); }}
              aria-label={t("dismiss")}
              className="shrink-0 hover:opacity-70"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <TelegramAlertsCard />

        {/* Date Filter */}
        <div className="bg-white border border-slate-100 rounded-xl p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Calendar className="w-4 h-4 text-slate-500 shrink-0" />
            <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider mr-1">{t("timeWindow")}</span>
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
                  aria-label={t("fromDate")}
                  className="bg-white border border-slate-100 text-slate-900 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <span className="text-slate-500 text-xs">→</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={e => { setCustomTo(e.target.value); setPage(0); }}
                  aria-label={t("toDate")}
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
              <span className="text-slate-400 text-xs font-medium uppercase tracking-wider">{t("actualCollected")}</span>
            </div>
            <p className="text-lg font-bold text-slate-900 tabular-nums">{mmk(totalCollected)}</p>
            <p className="text-slate-500 text-xs mt-1">{t("thisPage")}</p>
          </div>

          <div className="bg-white border border-slate-100 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">
                <TrendingUp className="w-4 h-4 text-slate-500" />
              </div>
              <span className="text-slate-400 text-xs font-medium uppercase tracking-wider">{t("expectedTotal")}</span>
            </div>
            <p className="text-lg font-bold text-slate-900 tabular-nums">{mmk(totalExpected)}</p>
            <p className="text-slate-500 text-xs mt-1">{t("thisPage")}</p>
          </div>

          <div className="bg-white border border-slate-100 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-pale-red flex items-center justify-center">
                <AlertTriangle className="w-4 h-4 text-pale-red-foreground" />
              </div>
              <span className="text-slate-400 text-xs font-medium uppercase tracking-wider">{t("redFlags")}</span>
            </div>
            <p className="text-lg font-bold text-slate-900">{redFlagCount}</p>
            <p className="text-slate-500 text-xs mt-1">{t("redFlagHint")}</p>
          </div>

          <div className="bg-white border border-slate-100 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">
                <Users className="w-4 h-4 text-slate-500" />
              </div>
              <span className="text-slate-400 text-xs font-medium uppercase tracking-wider">{t("totalShifts")}</span>
            </div>
            <p className="text-lg font-bold text-slate-900">{totalCount}</p>
            <p className="text-slate-500 text-xs mt-1">{t("workers", { n: uniqueWorkers })}</p>
          </div>
        </div>

        {/* Ledger Table */}
        <div className="bg-white border border-slate-100 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-pale-blue-foreground" />
            <h2 className="text-slate-900 font-semibold text-sm">{t("ledger")}</h2>
            <div className="ml-auto flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-slate-500 text-xs">{t("live")}</span>
            </div>
          </div>

          {deleteError && (
            <div className="mx-5 mt-4 flex items-start gap-2 bg-pale-red border border-red-100 rounded-xl px-4 py-3 text-xs text-pale-red-foreground">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{deleteError}</span>
              <button onClick={() => setDeleteError("")} aria-label={t("dismissError")} className="ml-auto text-pale-red-foreground hover:opacity-70"><X className="w-3.5 h-3.5" /></button>
            </div>
          )}

          {/* Select-all bar */}
          {shifts.length > 0 && !loading && (
            <div className="px-4 py-2.5 border-b border-slate-100 flex items-center gap-3">
              <input type="checkbox"
                checked={selectedIds.size === shifts.length}
                onChange={toggleSelectAll}
                aria-label={t("selectAll")}
                className="w-4 h-4 rounded accent-red-500 cursor-pointer"
              />
              <span className="text-slate-500 text-xs">
                {selectedIds.size > 0 ? t("selected", { n: selectedIds.size }) : t("shiftsN", { n: shifts.length })}
              </span>
            </div>
          )}

          {loading ? (
            <div className="p-16 text-center">
              <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mx-auto mb-3" />
              <p className="text-slate-500 text-sm">{t("loading")}</p>
            </div>
          ) : shifts.length === 0 ? (
            <div className="p-16 text-center">
              <BarChart3 className="w-10 h-10 text-slate-200 mx-auto mb-3" />
              <p className="text-slate-400 text-sm font-medium">{t("none")}</p>
              <p className="text-slate-400 text-xs mt-1">{t("tryRange")}</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {/* Desktop table header */}
              <div className="hidden md:flex items-center gap-3 px-4 py-2 bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                <div className="w-4 shrink-0" />
                <div className="flex-1">{t("dateTime")}</div>
                <div className="w-28 shrink-0">{t("employee")}</div>
                <div className="w-36 shrink-0 text-right text-pale-gold-foreground/80">{t("totalSales")}</div>
                <div className="w-32 shrink-0 text-right">{t("actualCash")}</div>
                <div className="w-32 shrink-0 text-right">{t("expCash")}</div>
                <div className="w-28 shrink-0 text-right">{t("difference")}</div>
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
                      aria-label={t("selectShift", { name: shift.employee_username || t("unknown") })}
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
                          <span className="text-pale-gold-foreground/70 text-[11px]">{t("salesLabel")}</span>
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
                        <span className="text-slate-500 text-[11px]">{t("cashLabel")}</span>
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
                        title={t("editShift")}
                        aria-label={t("editShift")}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); handleDeleteShift(shift); }}
                        title={t("deleteShift")} aria-label={t("deleteShift")}
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
                {t("page", { p: page + 1, n: totalPages, total: totalCount })}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-slate-200 text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition-all"
                >
                  <ChevronLeft className="w-3.5 h-3.5" /> {t("prev")}
                </button>
                <button
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-slate-200 text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition-all"
                >
                  {t("next")} <ChevronRightIcon className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-500">
          <div className="w-3 h-3 rounded border border-red-200" style={{ backgroundColor: "rgba(220,38,38,0.12)" }} />
          <span>{t("legend")}</span>
        </div>
      </div>

      {selectedShift && (
        <ShiftDetailPanel shift={selectedShift} onClose={closeShiftPanel} />
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
