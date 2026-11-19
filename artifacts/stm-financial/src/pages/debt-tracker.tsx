import { useState, useEffect, useCallback, useMemo } from "react";
import {
  supabase, DebtProfile, DEBT_TABLES, RELATIONS, DebtRelation,
  NO_SCORE_RELATIONS, RECEIVABLES_EXCLUDED_RELATIONS, computeReceivables,
  DebtCategoryId, DEBT_CATEGORY_RELATIONS, DEBT_CATEGORY_LABELS,
  repaymentSummary, fmtPercent, mmkFmt, formatPhone, generateTxnNumber,
  combineDateWithCurrentTime,
} from "@/lib/debt-supabase";
import DebtProfileDetail from "@/components/debt-profile-detail";
import DebtLedgerModal from "@/components/debt-ledger-modal";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cacheDebtProfiles, getCachedDebtProfiles, useOnlineStatus } from "@/lib/offlineCache";
import { useAuth } from "@/lib/auth-context";
import {
  Plus, Search, SortAsc, User, Phone, X, Calendar, CreditCard,
  AlertTriangle, CheckCircle, TrendingDown, Loader2, Trash2, ShieldCheck, PieChart as PieChartIcon,
  Banknote, ArrowUpDown, ChevronRight, FileSpreadsheet, WifiOff,
} from "lucide-react";

const RELATION_COLORS: Record<DebtRelation, string> = {
  Friends:    "bg-slate-100 text-slate-600 border-slate-200",
  Family:     "bg-slate-100 text-slate-600 border-slate-200",
  Own:        "bg-slate-100 text-slate-600 border-slate-200",
  Contract:   "bg-slate-100 text-slate-600 border-slate-200",
  Vendor:     "bg-slate-100 text-slate-600 border-slate-200",
  Employee:   "bg-slate-100 text-slate-600 border-slate-200",
  "On Paper": "bg-slate-100 text-slate-600 border-slate-200",
  Other:      "bg-slate-100 text-slate-600 border-slate-200",
};

const LITERS_PER_GALLON = 4.54609;

type SortKey = "newest" | "oldest" | "highest" | "lowest" | "az" | "za";

type TabId = DebtCategoryId;
const TAB_RELATIONS = DEBT_CATEGORY_RELATIONS;
const TAB_LABELS = DEBT_CATEGORY_LABELS;

export default function DebtTracker() {
  const [profiles, setProfiles] = useState<DebtProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("newest");
  const [activeTab, setActiveTab] = useState<TabId>("normal");
  const [selectedProfile, setSelectedProfile] = useState<DebtProfile | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [ledgerProfile, setLedgerProfile] = useState<DebtProfile | null>(null);

  const { profile: authProfile } = useAuth();
  const isCeo = authProfile?.role === "ceo";
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const [deleteAllConfirmText, setDeleteAllConfirmText] = useState("");
  const [deletingAll, setDeletingAll] = useState(false);
  const [deleteAllError, setDeleteAllError] = useState("");
  const [deleteAllTxnCount, setDeleteAllTxnCount] = useState<number | null>(null);

  const [name, setName] = useState("");
  const [relation, setRelation] = useState<DebtRelation>("Other");
  const [phones, setPhones] = useState<string[]>([""]);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [totalDebt, setTotalDebt] = useState("");
  const [creditLimit, setCreditLimit] = useState("");
  const [paymentDueDate, setPaymentDueDate] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  // Fuel fields for the initial debt entry — non-Family/Own only
  const [createFuelProduct, setCreateFuelProduct] = useState<"92 RON" | "PD" | "95" | "HSD">("92 RON");
  const [createFuelLiters, setCreateFuelLiters] = useState("");
  const [createFuelGallons, setCreateFuelGallons] = useState("");
  const [createFuelPrice, setCreateFuelPrice] = useState("");
  const [createFuelRemarks, setCreateFuelRemarks] = useState("");
  const [createLastSource, setCreateLastSource] = useState<'total' | 'liters' | null>(null);

  const isSimpleRelation = NO_SCORE_RELATIONS.has(relation);
  const createFuelAmountNum = parseFloat(totalDebt) || 0;
  const createFuelLitersNum = parseFloat(createFuelLiters) || 0;
  const createFuelPriceNum  = parseFloat(createFuelPrice)  || 0;

  function handleCreateLitersChange(val: string) {
    setCreateFuelLiters(val);
    setCreateLastSource('liters');
    const liters = parseFloat(val);
    if (liters > 0) {
      setCreateFuelGallons((liters / LITERS_PER_GALLON).toFixed(4));
    } else if (val === "") {
      setCreateFuelGallons("");
    }
  }
  function handleCreateGallonsChange(val: string) {
    setCreateFuelGallons(val);
    setCreateLastSource('liters');
    const gallons = parseFloat(val);
    if (gallons > 0) {
      setCreateFuelLiters((gallons * LITERS_PER_GALLON).toFixed(4));
    } else if (val === "") {
      setCreateFuelLiters("");
    }
  }
  function handleCreateAmountChange(val: string) {
    setTotalDebt(val);
    setCreateLastSource('total');
  }
  function handleCreatePriceChange(val: string) {
    setCreateFuelPrice(val);
    const price = parseFloat(val);
    if (price > 0) {
      if (createLastSource === 'total') {
        // User typed total first — preserve total, recalculate liters
        const amount = parseFloat(totalDebt);
        if (amount > 0) {
          const calcLiters = amount / price;
          setCreateFuelLiters(calcLiters.toFixed(3));
          setCreateFuelGallons((calcLiters / LITERS_PER_GALLON).toFixed(4));
        }
      } else {
        // User typed liters first (or no source yet) — preserve liters, recalculate total
        const liters = parseFloat(createFuelLiters);
        if (liters > 0) {
          setTotalDebt((liters * price).toFixed(0));
        } else {
          // Fallback: no liters entered yet, derive from total if present
          const amount = parseFloat(totalDebt);
          if (amount > 0) {
            const calcLiters = amount / price;
            setCreateFuelLiters(calcLiters.toFixed(3));
            setCreateFuelGallons((calcLiters / LITERS_PER_GALLON).toFixed(4));
          }
        }
      }
    }
  }

  // Every transaction amount, by profile — just enough to work out how much each person has repaid.
  // null = couldn't load (e.g. offline), so the "% repaid" figures are hidden rather than wrong.
  const [txnAmounts, setTxnAmounts] = useState<Map<string, number[]> | null>(null);

  const fetchTxnAmounts = useCallback(async () => {
    const byProfile = new Map<string, number[]>();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from(DEBT_TABLES.TRANSACTIONS)
        .select("profile_id, amount")
        .order("id")
        .range(from, from + 999);
      if (error) { setTxnAmounts(null); return; }
      for (const t of (data ?? []) as { profile_id: string; amount: number }[]) {
        const list = byProfile.get(t.profile_id);
        if (list) list.push(Number(t.amount)); else byProfile.set(t.profile_id, [Number(t.amount)]);
      }
      if (!data || data.length < 1000) break;
    }
    setTxnAmounts(byProfile);
  }, []);

  const fetchProfiles = useCallback(async () => {
    fetchTxnAmounts();
    const { data, error } = await supabase
      .from(DEBT_TABLES.PROFILES)
      .select("*")
      .order("created_at", { ascending: false });
    if (data) {
      setProfiles(data as DebtProfile[]);
      cacheDebtProfiles(data as DebtProfile[]);
    } else if (error) {
      // Offline or request failed — fall back to the last successfully loaded snapshot
      // so profile links keep working instead of showing an empty list.
      setProfiles(getCachedDebtProfiles());
    }
  }, [fetchTxnAmounts]);

  const isOnline = useOnlineStatus(fetchProfiles);

  useEffect(() => {
    setLoading(true);
    fetchProfiles().finally(() => setLoading(false));
  }, [fetchProfiles]);

  async function handleDeleteProfile(profile: DebtProfile) {
    if (!window.confirm(`Delete "${profile.name}" and all their transactions?\n\nThis cannot be undone.`)) return;
    const { error } = await supabase.from(DEBT_TABLES.PROFILES).delete().eq("id", profile.id);
    if (!error) fetchProfiles();
  }

  const DELETE_ALL_PHRASE = "DELETE ALL";

  async function openDeleteAll() {
    setDeleteAllConfirmText("");
    setDeleteAllError("");
    setDeleteAllTxnCount(null);
    setShowDeleteAll(true);
    // Shown in the dialog so the scale of what's about to go is explicit.
    const { count } = await supabase
      .from(DEBT_TABLES.TRANSACTIONS)
      .select("id", { count: "exact", head: true });
    setDeleteAllTxnCount(count ?? null);
  }

  async function handleDeleteAll() {
    if (deleteAllConfirmText !== DELETE_ALL_PHRASE) return;
    setDeletingAll(true);
    setDeleteAllError("");
    // One DELETE statement, so it is atomic: either every profile goes (their
    // transactions cascade via the profile_id FK) or, if anything blocks it,
    // nothing is deleted. The filter matches every row — PostgREST refuses an
    // unfiltered DELETE.
    const { error, count } = await supabase
      .from(DEBT_TABLES.PROFILES)
      .delete({ count: "exact" })
      .not("id", "is", null);
    setDeletingAll(false);
    if (error) {
      setDeleteAllError(error.message);
      return;
    }
    // RLS doesn't raise on a disallowed DELETE — it just matches zero rows.
    if (!count && profiles.length > 0) {
      setDeleteAllError("Nothing was deleted. Your account may not have permission to delete debt profiles.");
      return;
    }
    setShowDeleteAll(false);
    setSelectedProfile(null);
    fetchProfiles();
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setCreateError("Name is required."); return; }
    setCreating(true);
    setCreateError("");

    const debt = totalDebt ? parseFloat(totalDebt) : null;
    const cleanPhones = phones.map(p => p.trim()).filter(Boolean);

    const { data: profileData, error: profileError } = await supabase
      .from(DEBT_TABLES.PROFILES)
      .insert({
        name: name.trim(),
        relation,
        phone_number: cleanPhones[0] || null,
        phone_numbers: cleanPhones,
        date,
        total_debt: debt,
        current_balance: debt ?? 0,
        credit_limit: creditLimit ? parseFloat(creditLimit) : null,
        payment_due_date: paymentDueDate || null,
      })
      .select("id")
      .single();

    if (profileError) { setCreateError(profileError.message); setCreating(false); return; }

    // For non-Family/Own with a starting debt: also create an initial transaction with fuel details
    if (!isSimpleRelation && debt != null && debt > 0 && profileData?.id) {
      // ── Build a timezone-safe timestamp from the user's chosen date + current local time ──
      // Parse picker value as LOCAL integers to avoid UTC-midnight shift.
      const [year, month, day] = date.split("-").map(Number);
      const finalTimestamp = new Date(year, month - 1, day); // local midnight
      const now = new Date();
      finalTimestamp.setHours(now.getHours());
      finalTimestamp.setMinutes(now.getMinutes());
      finalTimestamp.setSeconds(now.getSeconds());
      finalTimestamp.setMilliseconds(0);
      const txnTimestamp = finalTimestamp.toISOString(); // UTC equivalent of local time

      await supabase.from(DEBT_TABLES.TRANSACTIONS).insert({
        profile_id: profileData.id,
        amount: debt,
        date: txnTimestamp,
        note: createFuelRemarks.trim() || null,
        transaction_number: generateTxnNumber(),
        source: "manual",
        product_type: createFuelProduct,
        price_per_liter: createFuelPriceNum > 0 ? createFuelPriceNum : null,
        liters: createFuelLitersNum > 0 ? createFuelLitersNum : null,
        gallons: createFuelLitersNum > 0 ? createFuelLitersNum / LITERS_PER_GALLON : null,
      });
    }

    setCreating(false);
    setShowCreate(false);
    resetCreate();
    fetchProfiles();
  }

  function resetCreate() {
    setName(""); setRelation("Other"); setPhones([""]); setDate(new Date().toISOString().slice(0, 10));
    setTotalDebt(""); setCreditLimit(""); setPaymentDueDate(""); setCreateError("");
    setCreateFuelProduct("92 RON"); setCreateFuelLiters(""); setCreateFuelGallons(""); setCreateFuelPrice(""); setCreateFuelRemarks(""); setCreateLastSource(null);
  }

  function addCreatePhone() {
    if (phones.length < 3) setPhones(prev => [...prev, ""]);
  }
  function removeCreatePhone(idx: number) {
    setPhones(prev => prev.filter((_, i) => i !== idx));
  }
  function updateCreatePhone(idx: number, val: string) {
    setPhones(prev => prev.map((p, i) => i === idx ? formatPhone(val) : p));
  }

  const filtered = profiles
    .filter(p => TAB_RELATIONS[activeTab].includes(p.relation))
    .filter(p => p.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === "newest") return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (sortBy === "oldest") return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      if (sortBy === "highest") return b.current_balance - a.current_balance;
      if (sortBy === "lowest") return a.current_balance - b.current_balance;
      if (sortBy === "az") return a.name.localeCompare(b.name);
      if (sortBy === "za") return b.name.localeCompare(a.name);
      return 0;
    });

  const { owed: externalOwed, activeCount: externalActiveCount } = computeReceivables(profiles);

  const totalOwed = profiles.reduce((s, p) => s + Math.max(0, p.current_balance), 0);
  const repayment = useMemo(() => {
    if (!txnAmounts) return null;
    const byId = new Map(profiles.map(p => [p.id, repaymentSummary(txnAmounts.get(p.id) ?? [], p.current_balance)]));
    let borrowed = 0, repaid = 0, remaining = 0;
    for (const r of byId.values()) { borrowed += r.borrowed; repaid += Math.min(r.repaid, r.borrowed); remaining += r.remaining; }
    const percent = borrowed > 0 ? (repaid / borrowed) * 100 : 0;
    return { byId, borrowed, repaid, remaining, percent };
  }, [profiles, txnAmounts]);
  const cleared = profiles.filter(p => p.current_balance <= 0).length;

  return (
    <div className="flex-1 overflow-auto bg-slate-50">
      {/* Page header */}
      <div className="px-6 py-5 border-b border-slate-100 bg-white">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Debt Tracker</h1>
            <p className="text-slate-400 text-sm mt-0.5">Manage debt profiles & repayment history</p>
          </div>
          <button
            onClick={() => { resetCreate(); setShowCreate(true); }}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl px-4 py-2 text-sm transition-all"
          >
            <Plus className="w-4 h-4" /> New Profile
          </button>
        </div>
      </div>

      <div className="p-6 space-y-5">

        {!isOnline && (
          <div className="flex items-center gap-2 bg-pale-gold border border-amber-100 rounded-xl px-4 py-2.5 text-sm text-pale-gold-foreground font-medium">
            <WifiOff className="w-4 h-4 shrink-0" />
            Offline — showing the last loaded data. Changes will sync automatically once you're back online.
          </div>
        )}

        {/* ── External Receivables Widget ── */}
        <div className="relative overflow-hidden rounded-xl border border-amber-500/20 bg-card shadow-sm p-5">
          <div className="relative flex items-start justify-between gap-4 flex-wrap">
            {/* Left: label + breakdown */}
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center shrink-0">
                  <Banknote className="w-4 h-4 text-pale-gold-foreground" />
                </div>
                <p className="text-xs font-bold text-pale-gold-foreground/80 uppercase tracking-widest">Total Outstanding Debt</p>
              </div>
              <p className="text-slate-400 text-[11px] mt-1 ml-10">
                {RELATIONS.filter(r => !RECEIVABLES_EXCLUDED_RELATIONS.has(r)).join(" · ")}
              </p>
              <p className="text-slate-400 text-[10px] ml-10 mt-0.5 italic">
                Excludes {Array.from(RECEIVABLES_EXCLUDED_RELATIONS).join(", ")}
              </p>
            </div>

            {/* Right: the big number */}
            <div className="text-right shrink-0">
              <p className="text-3xl font-black tabular-nums text-pale-gold-foreground tracking-tight">
                {mmkFmt(externalOwed)}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                {externalActiveCount} {externalActiveCount === 1 ? "debtor" : "debtors"} with open balance
              </p>
            </div>
          </div>

          {/* Bottom mini-bar: % of total */}
          {totalOwed > 0 && (
            <div className="relative mt-4">
              <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-amber-500 transition-all duration-700"
                  style={{ width: `${Math.min(100, (externalOwed / totalOwed) * 100).toFixed(1)}%` }}
                />
              </div>
              <p className="text-[10px] text-slate-400 mt-1 text-right">
                {((externalOwed / totalOwed) * 100).toFixed(0)}% of all outstanding debt
              </p>
            </div>
          )}
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div className="bg-white border border-slate-100 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-red-500/20 flex items-center justify-center">
                <TrendingDown className="w-4 h-4 text-pale-red-foreground" />
              </div>
              <span className="text-slate-400 text-xs font-medium uppercase tracking-wider">Total Balance (All Profiles)</span>
            </div>
            <p className="text-lg font-bold text-slate-900 tabular-nums">{mmkFmt(totalOwed)}</p>
            <p className="text-slate-500 text-xs mt-1">{profiles.length} active profiles</p>
          </div>
          <div className="bg-white border border-slate-100 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                <CheckCircle className="w-4 h-4 text-pale-green-foreground" />
              </div>
              <span className="text-slate-400 text-xs font-medium uppercase tracking-wider">Cleared</span>
            </div>
            <p className="text-lg font-bold text-slate-900">{cleared}</p>
            <p className="text-slate-500 text-xs mt-1">Fully paid off</p>
          </div>
          <div className="bg-white border border-slate-100 rounded-xl p-4 col-span-2 md:col-span-1">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                <PieChartIcon className="w-4 h-4 text-pale-green-foreground" />
              </div>
              <span className="text-slate-400 text-xs font-medium uppercase tracking-wider">Repaid</span>
            </div>
            <p className="text-lg font-bold text-slate-900 tabular-nums">
              {repayment ? fmtPercent(repayment.percent, repayment.remaining) : "—"}
            </p>
            <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden mt-1.5" aria-hidden="true">
              <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${repayment ? Math.min(100, repayment.percent) : 0}%` }} />
            </div>
            <p className="text-slate-500 text-xs mt-1.5">
              {repayment ? `${mmkFmt(repayment.repaid)} of ${mmkFmt(repayment.borrowed)} borrowed` : "Of everything borrowed"}
            </p>
          </div>
        </div>

        {/* Relation Tabs */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabId)}>
        <TabsList className="bg-white border border-slate-100 p-1 h-auto flex-wrap gap-1">
          {(Object.keys(TAB_LABELS) as TabId[]).map(id => (
            <TabsTrigger
              key={id}
              value={id}
              className="text-xs font-semibold px-3 py-1.5 data-[state=active]:bg-slate-100 data-[state=active]:text-slate-900 text-slate-400"
            >
              {TAB_LABELS[id]}
              <span className="ml-1.5 text-[10px] text-slate-500">
                {profiles.filter(p => TAB_RELATIONS[id].includes(p.relation)).length}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value={activeTab} className="mt-3 space-y-5">

        {/* Search + Sort */}
        <div className="bg-white border border-slate-100 rounded-xl p-4 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search profiles by name…"
              className="w-full bg-white border border-slate-100 text-slate-900 text-sm rounded-xl pl-9 pr-4 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder:text-slate-400"
            />
          </div>
          <div className="flex items-center gap-2">
            <ArrowUpDown className="w-4 h-4 text-slate-500 shrink-0" />
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as SortKey)}
              className="bg-white border border-slate-100 text-slate-900 text-sm rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
              <option value="highest">Highest Balance</option>
              <option value="lowest">Lowest Balance</option>
              <option value="az">A → Z (Name)</option>
              <option value="za">Z → A (Name)</option>
            </select>
          </div>
        </div>

        {/* Profile list */}
        <div className="bg-white border border-slate-100 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-pale-blue-foreground" />
            <h2 className="text-slate-900 font-semibold text-sm">Debt Profiles</h2>
            <span className="ml-auto text-slate-500 text-xs">{filtered.length} {filtered.length === 1 ? "profile" : "profiles"}</span>
            {isCeo && profiles.length > 0 && (
              <button
                type="button"
                onClick={openDeleteAll}
                disabled={!isOnline}
                title={isOnline ? "Delete every debt profile" : "Unavailable offline"}
                className="flex items-center gap-1 text-xs font-semibold text-pale-red-foreground hover:bg-pale-red border border-red-200 rounded-lg px-2 py-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete all
              </button>
            )}
          </div>

          {loading ? (
            <div className="p-16 text-center">
              <Loader2 className="w-8 h-8 text-blue-500/50 animate-spin mx-auto mb-3" />
              <p className="text-slate-500 text-sm">Loading profiles…</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-16 text-center">
              <CreditCard className="w-10 h-10 text-slate-200 mx-auto mb-3" />
              <p className="text-slate-400 text-sm font-medium">
                {search ? "No profiles match your search" : "No debt profiles yet"}
              </p>
              {!search && (
                <button
                  onClick={() => { resetCreate(); setShowCreate(true); }}
                  className="mt-4 text-pale-blue-foreground hover:text-pale-blue-foreground text-xs font-semibold"
                >
                  Create the first profile <ChevronRight className="w-3 h-3 inline" />
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Desktop table header */}
              <div className="hidden md:flex items-center px-5 py-2 bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-100">
                <div className="flex-1">Name</div>
                <div className="w-28">Relation</div>
                <div className="w-36 text-right">Balance</div>
                <div className="w-28 text-right">Repaid</div>
                <div className="w-20" />
              </div>
              <div className="divide-y divide-slate-100">
                {filtered.map(profile => {
                  const paid = profile.current_balance <= 0;
                  const rp = repayment?.byId.get(profile.id);
                  const rpPct = rp && (rp.borrowed > 0 || rp.repaid > 0) ? fmtPercent(rp.percent, rp.remaining) : null;
                  return (
                    <div
                      key={profile.id}
                      onClick={() => setSelectedProfile(profile)}
                      className="group flex items-center px-4 md:px-5 py-3.5 cursor-pointer hover:bg-slate-100 transition-colors gap-3 md:gap-4"
                    >
                      {/* Avatar */}
                      <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 font-bold text-sm shrink-0">
                        {profile.name[0].toUpperCase()}
                      </div>

                      {/* Name + phone (flex-1) */}
                      <div className="flex-1 min-w-0">
                        <p className="text-slate-900 font-semibold text-sm truncate">{profile.name}</p>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-0.5">
                          {profile.phone_number && (
                            <span className="text-slate-500 text-xs flex items-center gap-1 whitespace-nowrap">
                              <Phone className="w-3 h-3" /> {profile.phone_number}
                            </span>
                          )}
                          {/* Relation badge on mobile */}
                          <span className={`md:hidden text-[10px] font-semibold px-1.5 py-0.5 rounded border ${RELATION_COLORS[profile.relation]}`}>
                            {profile.relation}
                          </span>
                        </div>
                        {/* Mobile: balance + repaid row */}
                        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 mt-1.5 md:hidden">
                          <span className={`font-bold text-sm tabular-nums whitespace-nowrap ${paid ? "text-pale-green-foreground" : "text-slate-900"}`}>
                            {paid ? "Cleared" : mmkFmt(profile.current_balance)}
                          </span>
                          {rpPct && rp && (
                            <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 whitespace-nowrap">
                              <span className="w-12 h-1.5 rounded-full bg-slate-200 overflow-hidden" aria-hidden="true">
                                <span className="block h-full bg-emerald-500 rounded-full" style={{ width: `${Math.min(100, rp.percent)}%` }} />
                              </span>
                              {rpPct} repaid
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Desktop: relation */}
                      <div className="hidden md:block w-28">
                        <span className={`text-[10px] font-semibold px-2 py-1 rounded border ${RELATION_COLORS[profile.relation]}`}>
                          {profile.relation}
                        </span>
                      </div>

                      {/* Desktop: balance */}
                      <div className="hidden md:block w-36 text-right">
                        <span className={`font-bold text-sm tabular-nums flex items-center justify-end gap-1 ${paid ? "text-pale-green-foreground" : "text-slate-900"}`}>
                          {paid ? <><CheckCircle className="w-3.5 h-3.5" /> Cleared</> : mmkFmt(profile.current_balance)}
                        </span>
                      </div>

                      {/* Desktop: % repaid */}
                      <div className="hidden md:block w-28 text-right">
                        {rpPct && rp ? (
                          <>
                            <span className="text-sm font-bold tabular-nums text-slate-900">{rpPct}</span>
                            <div className="ml-auto mt-1 w-20 h-1.5 rounded-full bg-slate-200 overflow-hidden" aria-hidden="true">
                              <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.min(100, rp.percent)}%` }} />
                            </div>
                          </>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </div>

                      {/* Row actions: hover-reveal only where a mouse can hover;
                          touch screens can't hover, so there they're always shown. */}
                      <div className="shrink-0 md:w-20 flex justify-end items-center gap-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); setLedgerProfile(profile); }}
                          className="[@media(hover:hover)]:opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-slate-400 hover:text-pale-blue-foreground hover:bg-pale-blue p-2 md:p-1.5 rounded-lg transition-all"
                          title="Export / Preview ledger"
                          aria-label={`Export ledger for ${profile.name}`}
                        >
                          <FileSpreadsheet className="w-4 h-4 md:w-3.5 md:h-3.5" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteProfile(profile); }}
                          className="[@media(hover:hover)]:opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-slate-400 hover:text-pale-red-foreground hover:bg-pale-red p-2 md:p-1.5 rounded-lg transition-all"
                          title="Delete profile"
                          aria-label={`Delete profile ${profile.name}`}
                        >
                          <Trash2 className="w-4 h-4 md:w-3.5 md:h-3.5" />
                        </button>
                        <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-slate-400 transition-colors" />
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        </TabsContent>
        </Tabs>
      </div>

      {/* Create Profile Panel */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowCreate(false)} />
          <div className="relative w-full max-w-md bg-white border-l border-slate-100 h-full overflow-y-auto shadow">
            <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between z-10">
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-widest font-semibold">New Profile</p>
                <h2 className="text-slate-900 font-bold text-base">Create Debt Profile</h2>
              </div>
              <button onClick={() => setShowCreate(false)} aria-label="Close panel" className="text-slate-500 hover:text-slate-900 p-1.5 rounded-lg hover:bg-slate-100 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="p-6 space-y-5">
              {/* Name */}
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                  Name <span className="text-pale-red-foreground">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Full name or alias"
                  className="w-full bg-white border border-slate-100 text-slate-900 text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/50 placeholder:text-slate-400"
                  required
                />
              </div>

              {/* Relation */}
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Relation</label>
                <select
                  value={relation}
                  onChange={e => setRelation(e.target.value as DebtRelation)}
                  className="w-full bg-white border border-slate-100 text-slate-900 text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                >
                  {RELATIONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>

              {/* Phone Numbers */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    Phone Numbers <span className="text-slate-400 normal-case font-normal">(up to 3)</span>
                  </label>
                  {phones.length < 3 && (
                    <button type="button" onClick={addCreatePhone}
                      className="flex items-center gap-1 text-xs text-pale-blue-foreground hover:text-pale-blue-foreground font-semibold transition-colors">
                      <Plus className="w-3 h-3" /> Add
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  {phones.map((ph, idx) => (
                    <div key={idx} className="flex gap-2 items-center">
                      <div className="relative flex-1">
                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                        <input
                          type="tel"
                          value={ph}
                          onChange={e => updateCreatePhone(idx, e.target.value)}
                          placeholder="09-000000000"
                          maxLength={13}
                          className="w-full bg-white border border-slate-100 text-slate-900 text-sm rounded-xl pl-9 pr-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/50 placeholder:text-slate-400"
                        />
                        {idx === 0 && phones.length > 1 && (
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 font-semibold uppercase">Primary</span>
                        )}
                      </div>
                      {idx > 0 && (
                        <button type="button" onClick={() => removeCreatePhone(idx)}
                          aria-label={`Remove phone number ${idx + 1}`}
                          className="text-slate-400 hover:text-pale-red-foreground hover:bg-pale-red p-2 rounded-lg transition-all shrink-0">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Date */}
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Date</label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="date"
                    value={date}
                    onChange={e => setDate(e.target.value)}
                    className="w-full bg-white border border-slate-100 text-slate-900 text-sm rounded-xl pl-9 pr-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  />
                </div>
              </div>

              {/* Credit Limit */}
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                  Credit Limit <span className="text-slate-400 normal-case font-normal">(optional)</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm font-medium select-none">K</span>
                  <input
                    type="number"
                    value={creditLimit}
                    onChange={e => setCreditLimit(e.target.value)}
                    placeholder="Leave blank for no limit"
                    min="0"
                    className="w-full bg-white border border-slate-100 text-slate-900 text-sm rounded-xl pl-8 pr-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/50 placeholder:text-slate-400"
                  />
                </div>
                <p className="text-xs text-slate-400 mt-1">Triggers an alert when balance exceeds this amount.</p>
              </div>

              {/* Payment Due Date */}
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                  Payment Due Date <span className="text-slate-400 normal-case font-normal">(optional)</span>
                </label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="date"
                    value={paymentDueDate}
                    onChange={e => setPaymentDueDate(e.target.value)}
                    className="w-full bg-white border border-slate-100 text-slate-900 text-sm rounded-xl pl-9 pr-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  />
                </div>
                <p className="text-xs text-slate-400 mt-1">Triggers an alert when today is past this date and debt remains.</p>
              </div>

              {/* Starting Debt / Fuel Fields */}
              {isSimpleRelation ? (
                /* Family / Own — simple amount only */
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                    Starting Amount <span className="text-slate-400 normal-case font-normal">(optional)</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm font-medium select-none">K</span>
                    <input type="number" value={totalDebt} onChange={e => setTotalDebt(e.target.value)}
                      placeholder="Leave blank if unknown" min="0"
                      className="w-full bg-white border border-slate-100 text-slate-900 text-sm rounded-xl pl-8 pr-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/50 placeholder:text-slate-400" />
                  </div>
                  <p className="text-xs text-slate-400 mt-1">Can be updated later via transactions.</p>
                </div>
              ) : (
                /* Standard customers — full fuel details */
                <div className="space-y-3">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Initial Debt (Fuel Details)</p>

                  {/* Product type */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Product Type</label>
                    <select value={createFuelProduct} onChange={e => setCreateFuelProduct(e.target.value as typeof createFuelProduct)}
                      className="w-full bg-white border border-slate-100 text-slate-900 text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/50">
                      <option value="92 RON">92 RON</option>
                      <option value="PD">PD (Premium Diesel)</option>
                      <option value="95">95 RON</option>
                      <option value="HSD">Diesel</option>
                    </select>
                  </div>

                  {/* Total Amount */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                      Total Amount <span className="text-slate-400 normal-case font-normal">(optional)</span>
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm font-medium select-none">K</span>
                      <input type="text" inputMode="decimal" value={totalDebt} onChange={e => handleCreateAmountChange(e.target.value)}
                        placeholder="0"
                        className="w-full bg-white border border-slate-100 text-slate-900 text-sm rounded-xl pl-8 pr-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/50 placeholder:text-slate-400" />
                    </div>
                  </div>

                  {/* Liters & Gallons — cross-calculating */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Liters (L)</label>
                      <input type="text" inputMode="decimal" value={createFuelLiters}
                        onChange={e => handleCreateLitersChange(e.target.value)}
                        placeholder="0.000"
                        className="w-full bg-white border border-slate-100 text-slate-900 text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/50 placeholder:text-slate-400" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Gallons (G)</label>
                      <input type="text" inputMode="decimal" value={createFuelGallons}
                        onChange={e => handleCreateGallonsChange(e.target.value)}
                        placeholder="0.0000"
                        className="w-full bg-white border border-slate-100 text-slate-900 text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/50 placeholder:text-slate-400" />
                    </div>
                  </div>

                  {/* Price Per Liter — user-entered, optional */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                      Price Per Liter <span className="text-slate-400 normal-case font-normal">(optional)</span>
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm font-medium select-none">K</span>
                      <input type="text" inputMode="decimal" value={createFuelPrice}
                        onChange={e => handleCreatePriceChange(e.target.value)}
                        placeholder="e.g. 1650"
                        className="w-full bg-white border border-slate-100 text-slate-900 text-sm rounded-xl pl-8 pr-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/50 placeholder:text-slate-400" />
                    </div>
                  </div>

                  {/* Remarks */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                      Remarks <span className="text-slate-400 normal-case font-normal">(optional)</span>
                    </label>
                    <input type="text" value={createFuelRemarks} onChange={e => setCreateFuelRemarks(e.target.value)}
                      placeholder="e.g. Plate no., vehicle type…"
                      className="w-full bg-white border border-slate-100 text-slate-900 text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/50 placeholder:text-slate-400" />
                  </div>
                </div>
              )}

              {createError && (
                <div className="flex items-start gap-2 bg-pale-red border border-red-100 rounded-xl px-4 py-3 text-xs text-pale-red-foreground">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  {createError}
                </div>
              )}

              <button
                type="submit"
                disabled={creating}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold rounded-xl py-3 text-sm transition-all flex items-center justify-center gap-2"
              >
                {creating ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating…</> : "Create Profile"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Profile Detail Panel */}
      {selectedProfile && (
        <DebtProfileDetail
          profile={selectedProfile}
          onClose={() => setSelectedProfile(null)}
          onUpdated={() => {
            fetchProfiles();
            setSelectedProfile(null);
          }}
          onProfileChange={(p) => setSelectedProfile(p)}
        />
      )}

      {/* Debtors Ledger Export/Preview Modal */}
      {ledgerProfile && (
        <DebtLedgerModal
          profile={ledgerProfile}
          onClose={() => setLedgerProfile(null)}
        />
      )}

      {/* Delete All Profiles confirmation */}
      {showDeleteAll && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => !deletingAll && setShowDeleteAll(false)} />
          <div role="alertdialog" aria-modal="true" aria-labelledby="delete-all-title"
            className="relative w-full max-w-md bg-white border border-slate-100 rounded-2xl shadow p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-pale-red flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-pale-red-foreground" />
              </div>
              <div className="min-w-0">
                <h2 id="delete-all-title" className="text-slate-900 font-bold text-base">Delete all debt profiles?</h2>
                <p className="text-slate-500 text-sm mt-1">
                  This permanently deletes <span className="font-semibold text-slate-900">{profiles.length} {profiles.length === 1 ? "profile" : "profiles"}</span>
                  {" "}across every tab, and{" "}
                  <span className="font-semibold text-slate-900">
                    {deleteAllTxnCount === null ? "all" : deleteAllTxnCount} {deleteAllTxnCount === 1 ? "transaction" : "transactions"}
                  </span>
                  {" "}with them. It cannot be undone.
                </p>
              </div>
            </div>

            <div>
              <label htmlFor="delete-all-confirm" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                Type <span className="text-slate-900 font-mono normal-case">{DELETE_ALL_PHRASE}</span> to confirm
              </label>
              <input
                id="delete-all-confirm"
                type="text"
                value={deleteAllConfirmText}
                onChange={e => setDeleteAllConfirmText(e.target.value)}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                disabled={deletingAll}
                className="w-full bg-white border border-slate-200 text-slate-900 text-base sm:text-sm font-mono rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-red-500"
              />
            </div>

            {deleteAllError && (
              <div className="flex items-start gap-2 bg-pale-red border border-red-200 rounded-xl px-3 py-2.5 text-xs text-pale-red-foreground">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                {deleteAllError}
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setShowDeleteAll(false)}
                disabled={deletingAll}
                className="text-sm font-semibold text-slate-700 hover:bg-slate-100 rounded-xl px-4 py-2 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteAll}
                disabled={deleteAllConfirmText !== DELETE_ALL_PHRASE || deletingAll}
                className="flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white text-sm font-bold rounded-xl px-4 py-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {deletingAll ? <><Loader2 className="w-4 h-4 animate-spin" /> Deleting…</> : <><Trash2 className="w-4 h-4" /> Delete all</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
