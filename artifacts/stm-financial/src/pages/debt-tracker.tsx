import { useState, useEffect, useCallback } from "react";
import {
  supabase, DebtProfile, DEBT_TABLES, RELATIONS, DebtRelation,
  NO_SCORE_RELATIONS, RECEIVABLES_EXCLUDED_RELATIONS, computeReceivables,
  DebtCategoryId, DEBT_CATEGORY_RELATIONS, DEBT_CATEGORY_LABELS,
  calculateScore, scoreColor, scoreTier, mmkFmt, formatPhone, generateTxnNumber,
  combineDateWithCurrentTime,
} from "@/lib/debt-supabase";
import DebtProfileDetail from "@/components/debt-profile-detail";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Plus, Search, SortAsc, User, Phone, X, Calendar, CreditCard,
  AlertTriangle, CheckCircle, TrendingDown, Loader2, Trash2, ShieldCheck,
  Banknote, ArrowUpDown, ChevronRight,
} from "lucide-react";

const RELATION_COLORS: Record<DebtRelation, string> = {
  Friends:    "bg-slate-500/20 text-slate-300 border-slate-500/30",
  Family:     "bg-slate-500/20 text-slate-300 border-slate-500/30",
  Own:        "bg-slate-500/20 text-slate-300 border-slate-500/30",
  Contract:   "bg-slate-500/20 text-slate-300 border-slate-500/30",
  Vendor:     "bg-slate-500/20 text-slate-300 border-slate-500/30",
  Employee:   "bg-slate-500/20 text-slate-300 border-slate-500/30",
  "On Paper": "bg-slate-500/20 text-slate-300 border-slate-500/30",
  Other:      "bg-slate-500/20 text-slate-300 border-slate-500/30",
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

  const fetchProfiles = useCallback(async () => {
    const { data } = await supabase
      .from(DEBT_TABLES.PROFILES)
      .select("*")
      .order("created_at", { ascending: false });
    if (data) setProfiles(data as DebtProfile[]);
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchProfiles().finally(() => setLoading(false));
  }, [fetchProfiles]);

  async function handleDeleteProfile(profile: DebtProfile) {
    if (!window.confirm(`Delete "${profile.name}" and all their transactions?\n\nThis cannot be undone.`)) return;
    const { error } = await supabase.from(DEBT_TABLES.PROFILES).delete().eq("id", profile.id);
    if (!error) fetchProfiles();
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
        score: 50,
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
  const redFlags = profiles.filter(p => p.score < 40).length;
  const cleared = profiles.filter(p => p.current_balance <= 0).length;

  return (
    <div className="flex-1 overflow-auto">
      {/* Page header */}
      <div className="px-6 py-5 border-b border-slate-700/50">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white">Debt Tracker</h1>
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

        {/* ── External Receivables Widget ── */}
        <div className="relative overflow-hidden rounded-xl border border-amber-500/20 bg-card shadow-sm p-5">
          <div className="relative flex items-start justify-between gap-4 flex-wrap">
            {/* Left: label + breakdown */}
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center shrink-0">
                  <Banknote className="w-4 h-4 text-amber-400" />
                </div>
                <p className="text-xs font-bold text-amber-400/80 uppercase tracking-widest">Total Outstanding Debt</p>
              </div>
              <p className="text-slate-400 text-[11px] mt-1 ml-10">
                {RELATIONS.filter(r => !RECEIVABLES_EXCLUDED_RELATIONS.has(r)).join(" · ")}
              </p>
              <p className="text-slate-600 text-[10px] ml-10 mt-0.5 italic">
                Excludes {Array.from(RECEIVABLES_EXCLUDED_RELATIONS).join(", ")}
              </p>
            </div>

            {/* Right: the big number */}
            <div className="text-right shrink-0">
              <p className="text-3xl font-black tabular-nums text-amber-300 tracking-tight">
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
              <div className="h-1.5 w-full rounded-full bg-slate-700/60 overflow-hidden">
                <div
                  className="h-full rounded-full bg-amber-500 transition-all duration-700"
                  style={{ width: `${Math.min(100, (externalOwed / totalOwed) * 100).toFixed(1)}%` }}
                />
              </div>
              <p className="text-[10px] text-slate-600 mt-1 text-right">
                {((externalOwed / totalOwed) * 100).toFixed(0)}% of all outstanding debt
              </p>
            </div>
          )}
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div className="bg-[#111827] border border-slate-700/50 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-red-500/20 flex items-center justify-center">
                <TrendingDown className="w-4 h-4 text-red-400" />
              </div>
              <span className="text-slate-400 text-xs font-medium uppercase tracking-wider">Total Balance (All Profiles)</span>
            </div>
            <p className="text-lg font-bold text-white tabular-nums">{mmkFmt(totalOwed)}</p>
            <p className="text-slate-500 text-xs mt-1">{profiles.length} active profiles</p>
          </div>
          <div className="bg-[#111827] border border-slate-700/50 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                <CheckCircle className="w-4 h-4 text-emerald-400" />
              </div>
              <span className="text-slate-400 text-xs font-medium uppercase tracking-wider">Cleared</span>
            </div>
            <p className="text-lg font-bold text-white">{cleared}</p>
            <p className="text-slate-500 text-xs mt-1">Fully paid off</p>
          </div>
          <div className="bg-[#111827] border border-slate-700/50 rounded-xl p-4 col-span-2 md:col-span-1">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
              </div>
              <span className="text-slate-400 text-xs font-medium uppercase tracking-wider">High Risk</span>
            </div>
            <p className="text-lg font-bold text-white">{redFlags}</p>
            <p className="text-slate-500 text-xs mt-1">Score below 40</p>
          </div>
        </div>

        {/* Relation Tabs */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabId)}>
        <TabsList className="bg-[#111827] border border-slate-700/50 p-1 h-auto flex-wrap gap-1">
          {(Object.keys(TAB_LABELS) as TabId[]).map(id => (
            <TabsTrigger
              key={id}
              value={id}
              className="text-xs font-semibold px-3 py-1.5 data-[state=active]:bg-slate-700 data-[state=active]:text-white text-slate-400"
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
        <div className="bg-[#111827] border border-slate-700/50 rounded-xl p-4 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search profiles by name…"
              className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-xl pl-9 pr-4 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder:text-slate-600"
            />
          </div>
          <div className="flex items-center gap-2">
            <ArrowUpDown className="w-4 h-4 text-slate-500 shrink-0" />
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as SortKey)}
              className="bg-slate-800 border border-slate-700 text-white text-sm rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
        <div className="bg-[#111827] border border-slate-700/50 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-700/50 flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-blue-400" />
            <h2 className="text-white font-semibold text-sm">Debt Profiles</h2>
            <span className="ml-auto text-slate-500 text-xs">{filtered.length} {filtered.length === 1 ? "profile" : "profiles"}</span>
          </div>

          {loading ? (
            <div className="p-16 text-center">
              <Loader2 className="w-8 h-8 text-blue-500/50 animate-spin mx-auto mb-3" />
              <p className="text-slate-500 text-sm">Loading profiles…</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-16 text-center">
              <CreditCard className="w-10 h-10 text-slate-700 mx-auto mb-3" />
              <p className="text-slate-400 text-sm font-medium">
                {search ? "No profiles match your search" : "No debt profiles yet"}
              </p>
              {!search && (
                <button
                  onClick={() => { resetCreate(); setShowCreate(true); }}
                  className="mt-4 text-blue-400 hover:text-blue-300 text-xs font-semibold"
                >
                  Create the first profile <ChevronRight className="w-3 h-3 inline" />
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Desktop table header */}
              <div className="hidden md:flex items-center px-5 py-2 bg-slate-800/50 text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-700/30">
                <div className="flex-1">Name</div>
                <div className="w-28">Relation</div>
                <div className="w-36 text-right">Balance</div>
                <div className="w-28 text-right">Score</div>
                <div className="w-10" />
              </div>
              <div className="divide-y divide-slate-700/20">
                {filtered.map(profile => {
                  const paid = profile.current_balance <= 0;
                  const risk = profile.score < 40;
                  const sc = scoreColor(profile.score);
                  const tier = scoreTier(profile.score);
                  return (
                    <div
                      key={profile.id}
                      onClick={() => setSelectedProfile(profile)}
                      className="group flex items-center px-5 py-3.5 cursor-pointer hover:bg-slate-700/20 transition-colors gap-4"
                    >
                      {/* Avatar */}
                      <div className="w-9 h-9 rounded-full bg-slate-700 flex items-center justify-center text-slate-300 font-bold text-sm shrink-0">
                        {profile.name[0].toUpperCase()}
                      </div>

                      {/* Name + phone (flex-1) */}
                      <div className="flex-1 min-w-0">
                        <p className="text-white font-semibold text-sm truncate">{profile.name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {profile.phone_number && (
                            <span className="text-slate-500 text-xs flex items-center gap-1">
                              <Phone className="w-3 h-3" /> {profile.phone_number}
                            </span>
                          )}
                          {/* Relation badge on mobile */}
                          <span className={`md:hidden text-[10px] font-semibold px-1.5 py-0.5 rounded border ${RELATION_COLORS[profile.relation]}`}>
                            {profile.relation}
                          </span>
                        </div>
                        {/* Mobile: balance + score row */}
                        <div className="flex items-center justify-between mt-1.5 md:hidden">
                          <span className={`font-bold text-sm tabular-nums ${paid ? "text-emerald-400" : risk ? "text-red-400" : "text-white"}`}>
                            {paid ? "Cleared" : mmkFmt(profile.current_balance)}
                          </span>
                          {!NO_SCORE_RELATIONS.has(profile.relation) && (
                            <span className="text-xs font-bold" style={{ color: sc }}>
                              {profile.score}/100 · {tier}
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
                        <span className={`font-bold text-sm tabular-nums flex items-center justify-end gap-1 ${paid ? "text-emerald-400" : risk ? "text-red-400" : "text-white"}`}>
                          {paid ? <><CheckCircle className="w-3.5 h-3.5" /> Cleared</> : mmkFmt(profile.current_balance)}
                        </span>
                      </div>

                      {/* Desktop: score */}
                      <div className="hidden md:block w-28 text-right">
                        {NO_SCORE_RELATIONS.has(profile.relation) ? (
                          <span className="text-xs text-slate-600 italic">N/A</span>
                        ) : (
                          <>
                            <span className="text-sm font-bold tabular-nums" style={{ color: sc }}>
                              {profile.score}<span className="text-slate-600 font-normal">/100</span>
                            </span>
                            <p className="text-xs mt-0.5" style={{ color: sc }}>{tier}</p>
                          </>
                        )}
                      </div>

                      <div className="w-10 flex justify-end items-center gap-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteProfile(profile); }}
                          className="opacity-0 group-hover:opacity-100 text-slate-700 hover:text-red-400 hover:bg-red-900/20 p-1.5 rounded-lg transition-all"
                          title="Delete profile"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-slate-400 transition-colors" />
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
          <div className="relative w-full max-w-md bg-[#0f1623] border-l border-slate-700/50 h-full overflow-y-auto shadow">
            <div className="sticky top-0 bg-[#0f1623] border-b border-slate-700/50 px-6 py-4 flex items-center justify-between z-10">
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-widest font-semibold">New Profile</p>
                <h2 className="text-white font-bold text-base">Create Debt Profile</h2>
              </div>
              <button onClick={() => setShowCreate(false)} aria-label="Close panel" className="text-slate-500 hover:text-white p-1.5 rounded-lg hover:bg-slate-700/50 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="p-6 space-y-5">
              {/* Name */}
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                  Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Full name or alias"
                  className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/50 placeholder:text-slate-600"
                  required
                />
              </div>

              {/* Relation */}
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Relation</label>
                <select
                  value={relation}
                  onChange={e => setRelation(e.target.value as DebtRelation)}
                  className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                >
                  {RELATIONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>

              {/* Phone Numbers */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    Phone Numbers <span className="text-slate-600 normal-case font-normal">(up to 3)</span>
                  </label>
                  {phones.length < 3 && (
                    <button type="button" onClick={addCreatePhone}
                      className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 font-semibold transition-colors">
                      <Plus className="w-3 h-3" /> Add
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  {phones.map((ph, idx) => (
                    <div key={idx} className="flex gap-2 items-center">
                      <div className="relative flex-1">
                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-600" />
                        <input
                          type="tel"
                          value={ph}
                          onChange={e => updateCreatePhone(idx, e.target.value)}
                          placeholder="09-000000000"
                          maxLength={13}
                          className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-xl pl-9 pr-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/50 placeholder:text-slate-600"
                        />
                        {idx === 0 && phones.length > 1 && (
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-600 font-semibold uppercase">Primary</span>
                        )}
                      </div>
                      {idx > 0 && (
                        <button type="button" onClick={() => removeCreatePhone(idx)}
                          aria-label={`Remove phone number ${idx + 1}`}
                          className="text-slate-600 hover:text-red-400 hover:bg-red-900/20 p-2 rounded-lg transition-all shrink-0">
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
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" />
                  <input
                    type="date"
                    value={date}
                    onChange={e => setDate(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-xl pl-9 pr-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  />
                </div>
              </div>

              {/* Credit Limit */}
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                  Credit Limit <span className="text-slate-600 normal-case font-normal">(optional)</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm font-medium select-none">K</span>
                  <input
                    type="number"
                    value={creditLimit}
                    onChange={e => setCreditLimit(e.target.value)}
                    placeholder="Leave blank for no limit"
                    min="0"
                    className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-xl pl-8 pr-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/50 placeholder:text-slate-600"
                  />
                </div>
                <p className="text-xs text-slate-600 mt-1">Triggers an alert when balance exceeds this amount.</p>
              </div>

              {/* Payment Due Date */}
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                  Payment Due Date <span className="text-slate-600 normal-case font-normal">(optional)</span>
                </label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" />
                  <input
                    type="date"
                    value={paymentDueDate}
                    onChange={e => setPaymentDueDate(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-xl pl-9 pr-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  />
                </div>
                <p className="text-xs text-slate-600 mt-1">Triggers an alert when today is past this date and debt remains.</p>
              </div>

              {/* Starting Debt / Fuel Fields */}
              {isSimpleRelation ? (
                /* Family / Own — simple amount only */
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                    Starting Amount <span className="text-slate-600 normal-case font-normal">(optional)</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm font-medium select-none">K</span>
                    <input type="number" value={totalDebt} onChange={e => setTotalDebt(e.target.value)}
                      placeholder="Leave blank if unknown" min="0"
                      className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-xl pl-8 pr-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/50 placeholder:text-slate-600" />
                  </div>
                  <p className="text-xs text-slate-600 mt-1">Can be updated later via transactions.</p>
                </div>
              ) : (
                /* Standard customers — full fuel details */
                <div className="space-y-3">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Initial Debt (Fuel Details)</p>

                  {/* Product type */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Product Type</label>
                    <select value={createFuelProduct} onChange={e => setCreateFuelProduct(e.target.value as typeof createFuelProduct)}
                      className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/50">
                      <option value="92 RON">92 RON</option>
                      <option value="PD">PD (Premium Diesel)</option>
                      <option value="95">95 RON</option>
                      <option value="HSD">Diesel</option>
                    </select>
                  </div>

                  {/* Total Amount */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                      Total Amount <span className="text-slate-600 normal-case font-normal">(optional)</span>
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm font-medium select-none">K</span>
                      <input type="text" inputMode="decimal" value={totalDebt} onChange={e => handleCreateAmountChange(e.target.value)}
                        placeholder="0"
                        className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-xl pl-8 pr-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/50 placeholder:text-slate-600" />
                    </div>
                  </div>

                  {/* Liters & Gallons — cross-calculating */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Liters (L)</label>
                      <input type="text" inputMode="decimal" value={createFuelLiters}
                        onChange={e => handleCreateLitersChange(e.target.value)}
                        placeholder="0.000"
                        className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/50 placeholder:text-slate-600" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Gallons (G)</label>
                      <input type="text" inputMode="decimal" value={createFuelGallons}
                        onChange={e => handleCreateGallonsChange(e.target.value)}
                        placeholder="0.0000"
                        className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/50 placeholder:text-slate-600" />
                    </div>
                  </div>

                  {/* Price Per Liter — user-entered, optional */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                      Price Per Liter <span className="text-slate-600 normal-case font-normal">(optional)</span>
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm font-medium select-none">K</span>
                      <input type="text" inputMode="decimal" value={createFuelPrice}
                        onChange={e => handleCreatePriceChange(e.target.value)}
                        placeholder="e.g. 1650"
                        className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-xl pl-8 pr-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/50 placeholder:text-slate-600" />
                    </div>
                  </div>

                  {/* Remarks */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                      Remarks <span className="text-slate-600 normal-case font-normal">(optional)</span>
                    </label>
                    <input type="text" value={createFuelRemarks} onChange={e => setCreateFuelRemarks(e.target.value)}
                      placeholder="e.g. Plate no., vehicle type…"
                      className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/50 placeholder:text-slate-600" />
                  </div>
                </div>
              )}

              {createError && (
                <div className="flex items-start gap-2 bg-red-900/30 border border-red-700/40 rounded-xl px-4 py-3 text-xs text-red-300">
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
    </div>
  );
}
