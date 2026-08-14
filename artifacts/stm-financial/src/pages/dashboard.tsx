import { useEffect, useState, useCallback } from "react";
import { supabase, Shift, TABLES, COLS, mapRowToShift, shiftTotalSales, RED_FLAG_THRESHOLD } from "@/lib/supabase";
import {
  DebtProfile, DEBT_TABLES, RELATIONS, RECEIVABLES_EXCLUDED_RELATIONS, computeReceivables, mmkFmt,
  DebtCategoryId, DEBT_CATEGORY_RELATIONS, DEBT_CATEGORY_LABELS,
} from "@/lib/debt-supabase";
import {
  LineChart, Line, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import {
  DollarSign, AlertTriangle, Users, TrendingUp, RefreshCw, Banknote, BarChart3, CreditCard,
} from "lucide-react";

export default function Dashboard() {
  const [refreshing, setRefreshing] = useState(false);

  const [debtProfiles, setDebtProfiles] = useState<DebtProfile[]>([]);
  const [todayShifts, setTodayShifts] = useState<Shift[]>([]);
  const [recentShifts, setRecentShifts] = useState<Shift[]>([]);

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

  const fetchTodayShifts = useCallback(async () => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const { data, error } = await supabase
      .from(TABLES.SHIFTS)
      .select("*")
      .gte(COLS.TIMESTAMP, start.toISOString());
    if (!error && data) {
      setTodayShifts((data as Record<string, unknown>[]).map(mapRowToShift));
    }
  }, []);

  const fetchRecentShifts = useCallback(async () => {
    const start = new Date();
    start.setDate(start.getDate() - 30);
    start.setHours(0, 0, 0, 0);
    const { data, error } = await supabase
      .from(TABLES.SHIFTS)
      .select("*")
      .order(COLS.TIMESTAMP, { ascending: true })
      .gte(COLS.TIMESTAMP, start.toISOString())
      .limit(500);
    if (!error && data) {
      setRecentShifts((data as Record<string, unknown>[]).map(mapRowToShift));
    }
  }, []);

  useEffect(() => {
    fetchTodayShifts();
    fetchRecentShifts();

    const channel = supabase
      .channel("shifts-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: TABLES.SHIFTS }, () => {
        fetchTodayShifts();
        fetchRecentShifts();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchTodayShifts, fetchRecentShifts]);

  async function handleRefresh() {
    setRefreshing(true);
    await Promise.all([fetchDebtProfiles(), fetchTodayShifts(), fetchRecentShifts()]);
    setRefreshing(false);
  }

  // ── Derived metrics ──
  const totalSalesToday = todayShifts.reduce((s, sh) => s + shiftTotalSales(sh), 0);

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const salesThisWeek = recentShifts
    .filter(s => new Date(s.created_at) >= sevenDaysAgo)
    .reduce((sum, s) => sum + shiftTotalSales(s), 0);

  const redFlags30d = recentShifts.filter(s => Math.abs(s.difference ?? 0) >= RED_FLAG_THRESHOLD).length;
  const totalShifts30d = recentShifts.length;
  const totalSales30d = recentShifts.reduce((s, sh) => s + shiftTotalSales(sh), 0);
  const avgDailySales30d = totalSales30d / 30;

  const { owed: debtOwed, activeCount: debtActiveCount } = computeReceivables(debtProfiles);

  const salesTrendData = (() => {
    const byDay = new Map<string, number>();
    for (const s of recentShifts) {
      const key = new Date(s.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      byDay.set(key, (byDay.get(key) ?? 0) + shiftTotalSales(s));
    }
    return Array.from(byDay.entries()).map(([date, sales]) => ({ date, sales }));
  })();

  const priceChartData = recentShifts
    .filter(s => s.fuel_92_price != null || s.fuel_95_price != null || s.premium_diesel_price != null || s.diesel_price != null)
    .map(s => ({
      date: new Date(s.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      "92": s.fuel_92_price,
      "95": s.fuel_95_price,
      "PD": s.premium_diesel_price,
      "Diesel": s.diesel_price,
    }));

  const DEBT_CATEGORY_COLORS: Record<DebtCategoryId, string> = {
    normal: "hsl(var(--chart-1))",
    own_family: "hsl(var(--chart-2))",
    on_paper: "hsl(var(--chart-3))",
    employees: "hsl(var(--chart-4))",
  };
  const debtCategoryData = (Object.keys(DEBT_CATEGORY_LABELS) as DebtCategoryId[]).map(id => {
    const inCategory = debtProfiles.filter(p => DEBT_CATEGORY_RELATIONS[id].includes(p.relation));
    return {
      label: DEBT_CATEGORY_LABELS[id],
      owed: inCategory.reduce((s, p) => s + Math.max(0, p.current_balance), 0),
      color: DEBT_CATEGORY_COLORS[id],
    };
  });

  return (
    <div className="flex-1 overflow-auto bg-slate-50">
      <div className="px-6 py-5 border-b border-slate-100 bg-white">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Executive Dashboard</h1>
            <p className="text-slate-500 text-sm mt-0.5">Live summary · STM Financial</p>
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 text-slate-500 hover:text-slate-900 bg-white hover:bg-slate-50 border border-slate-200 shadow-xs rounded-xl px-4 py-2 text-sm font-medium transition-all"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="p-6 space-y-5">
        {/* Hero widgets */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Total Sales Today */}
          <div className="relative overflow-hidden rounded-2xl bg-white border border-slate-100 shadow-sm p-5">
            <div className="relative flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-9 h-9 rounded-xl bg-pale-green flex items-center justify-center shrink-0">
                    <DollarSign className="w-4 h-4 text-pale-green-foreground" />
                  </div>
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Total Sales Today</p>
                </div>
                <p className="text-slate-400 text-[11px] mt-1 ml-11">Fuel, Pipa & Jelly Can sales</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-3xl font-black tabular-nums text-pale-green-foreground tracking-tight">{mmkFmt(totalSalesToday)}</p>
                <p className="text-xs text-slate-400 mt-1">
                  {todayShifts.length} {todayShifts.length === 1 ? "shift" : "shifts"} today
                </p>
              </div>
            </div>
          </div>

          {/* Total Outstanding Debt */}
          <div className="relative overflow-hidden rounded-2xl bg-white border border-slate-100 shadow-sm p-5">
            <div className="relative flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-9 h-9 rounded-xl bg-pale-gold flex items-center justify-center shrink-0">
                    <Banknote className="w-4 h-4 text-pale-gold-foreground" />
                  </div>
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Total Outstanding Debt</p>
                </div>
                <p className="text-slate-400 text-[11px] mt-1 ml-11">
                  {RELATIONS.filter(r => !RECEIVABLES_EXCLUDED_RELATIONS.has(r)).join(" · ")}
                </p>
                <p className="text-slate-400 text-[10px] ml-11 mt-0.5 italic">
                  Excludes {Array.from(RECEIVABLES_EXCLUDED_RELATIONS).join(", ")}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-3xl font-black tabular-nums text-pale-gold-foreground tracking-tight">{mmkFmt(debtOwed)}</p>
                <p className="text-xs text-slate-400 mt-1">
                  {debtActiveCount} {debtActiveCount === 1 ? "debtor" : "debtors"} with open balance
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* KPI tiles */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white border border-slate-100 shadow-sm rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-9 h-9 rounded-xl bg-pale-blue flex items-center justify-center">
                <TrendingUp className="w-4 h-4 text-pale-blue-foreground" />
              </div>
              <span className="text-slate-500 text-xs font-medium uppercase tracking-wider">Sales This Week</span>
            </div>
            <p className="text-lg font-bold text-slate-900 tabular-nums">{mmkFmt(salesThisWeek)}</p>
            <p className="text-slate-400 text-xs mt-1">Last 7 days</p>
          </div>

          <div className="bg-white border border-slate-100 shadow-sm rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-9 h-9 rounded-xl bg-pale-red flex items-center justify-center">
                <AlertTriangle className="w-4 h-4 text-pale-red-foreground" />
              </div>
              <span className="text-slate-500 text-xs font-medium uppercase tracking-wider">Red Flags</span>
            </div>
            <p className="text-lg font-bold text-slate-900">{redFlags30d}</p>
            <p className="text-slate-400 text-xs mt-1">Last 30 days</p>
          </div>

          <div className="bg-white border border-slate-100 shadow-sm rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-9 h-9 rounded-xl bg-pale-gold flex items-center justify-center">
                <Users className="w-4 h-4 text-pale-gold-foreground" />
              </div>
              <span className="text-slate-500 text-xs font-medium uppercase tracking-wider">Total Shifts</span>
            </div>
            <p className="text-lg font-bold text-slate-900">{totalShifts30d}</p>
            <p className="text-slate-400 text-xs mt-1">Last 30 days</p>
          </div>

          <div className="bg-white border border-slate-100 shadow-sm rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-9 h-9 rounded-xl bg-pale-blue flex items-center justify-center">
                <BarChart3 className="w-4 h-4 text-pale-blue-foreground" />
              </div>
              <span className="text-slate-500 text-xs font-medium uppercase tracking-wider">Avg Daily Sales</span>
            </div>
            <p className="text-lg font-bold text-slate-900 tabular-nums">{mmkFmt(avgDailySales30d)}</p>
            <p className="text-slate-400 text-xs mt-1">Last 30 days</p>
          </div>
        </div>

        {/* Fuel Price History */}
        <div className="bg-white border border-slate-100 shadow-sm rounded-2xl overflow-hidden p-4">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-4 h-4 text-pale-blue-foreground" />
            <h2 className="text-slate-900 font-semibold text-sm">Fuel Price History</h2>
            <span className="ml-auto text-slate-400 text-xs">Last 30 days</span>
          </div>
          {priceChartData.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-sm">No price data in the last 30 days</div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={priceChartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="date" stroke="#d1d5db" tick={{ fontSize: 11, fill: "#9ca3af" }} tickLine={false} axisLine={{ stroke: "#e5e7eb" }} />
                <YAxis stroke="#d1d5db" tick={{ fontSize: 11, fill: "#9ca3af" }} tickLine={false} axisLine={false} width={56} />
                <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: "12px", fontSize: "12px", boxShadow: "0 4px 16px rgba(16,24,40,0.08)" }} labelStyle={{ color: "#475569" }} />
                <Legend wrapperStyle={{ fontSize: "12px" }} />
                <Line type="monotone" dataKey="92" name="92 RON" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={false} connectNulls />
                <Line type="monotone" dataKey="95" name="95 RON" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={false} connectNulls />
                <Line type="monotone" dataKey="PD" name="Premium Diesel" stroke="hsl(var(--chart-3))" strokeWidth={2} dot={false} connectNulls />
                <Line type="monotone" dataKey="Diesel" name="Diesel" stroke="hsl(var(--chart-5))" strokeWidth={2} dot={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Sales Trend + Debt by Category */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white border border-slate-100 shadow-sm rounded-2xl overflow-hidden p-4">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="w-4 h-4 text-pale-blue-foreground" />
              <h2 className="text-slate-900 font-semibold text-sm">Sales Trend</h2>
              <span className="ml-auto text-slate-400 text-xs">Last 30 days</span>
            </div>
            {salesTrendData.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-sm">No sales data in the last 30 days</div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={salesTrendData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="date" stroke="#d1d5db" tick={{ fontSize: 11, fill: "#9ca3af" }} tickLine={false} axisLine={{ stroke: "#e5e7eb" }} />
                  <YAxis stroke="#d1d5db" tick={{ fontSize: 11, fill: "#9ca3af" }} tickLine={false} axisLine={false} width={56} />
                  <Tooltip
                    contentStyle={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: "12px", fontSize: "12px", boxShadow: "0 4px 16px rgba(16,24,40,0.08)" }}
                    labelStyle={{ color: "#475569" }}
                    formatter={(v: number) => [mmkFmt(v), "Sales"]}
                  />
                  <Bar dataKey="sales" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="bg-white border border-slate-100 shadow-sm rounded-2xl overflow-hidden p-4">
            <div className="flex items-center gap-2 mb-4">
              <CreditCard className="w-4 h-4 text-pale-blue-foreground" />
              <h2 className="text-slate-900 font-semibold text-sm">Debt by Category</h2>
            </div>
            {debtProfiles.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-sm">No debt profiles yet</div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={debtCategoryData} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                  <XAxis type="number" stroke="#d1d5db" tick={{ fontSize: 11, fill: "#9ca3af" }} tickLine={false} axisLine={{ stroke: "#e5e7eb" }} />
                  <YAxis type="category" dataKey="label" stroke="#d1d5db" tick={{ fontSize: 11, fill: "#475569" }} tickLine={false} axisLine={false} width={90} />
                  <Tooltip
                    contentStyle={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: "12px", fontSize: "12px", boxShadow: "0 4px 16px rgba(16,24,40,0.08)" }}
                    labelStyle={{ color: "#475569" }}
                    formatter={(v: number) => [mmkFmt(v), "Balance"]}
                  />
                  <Bar dataKey="owed" radius={[0, 4, 4, 0]}>
                    {debtCategoryData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
