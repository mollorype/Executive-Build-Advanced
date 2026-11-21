import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, ChevronLeft, ChevronRight, Search, AlertTriangle, Wallet, X, Loader2, RefreshCw, ChevronRight as Arrow, Users, FileSpreadsheet, CheckCircle2 } from "lucide-react";
import { mmkFmt } from "@/lib/debt-supabase";
import { useDebtLang } from "@/lib/debt-i18n";
import DebtLangToggle from "@/components/debt-lang-toggle";
import SalaryEmployeeDetail from "@/components/salary-employee-detail";
import SalaryExportDialog from "@/components/salary-export-dialog";
import { useSalaryT } from "@/lib/salary-i18n";
import { summarizeMonth, summaryFromPayment, pendingItems, monthKey, shiftMonth, monthLabel, todayKey, type SalaryItem, type SalaryPayment } from "@/lib/salary-math";
import { loadEmployees, loadItems, loadPayments, createEmployee, type Employee } from "@/lib/salary";

const inputCls = "w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-300/50 placeholder:text-slate-400";
const labelCls = "block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5";

export default function SalaryPage() {
  const t = useSalaryT();
  const lang = useDebtLang();
  const [month, setMonth] = useState(() => monthKey());
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [items, setItems] = useState<SalaryItem[]>([]);
  const [payments, setPayments] = useState<SalaryPayment[]>([]);
  const [showExport, setShowExport] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<"" | "failed" | "setup">("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [emps, its, pays] = await Promise.all([loadEmployees(), loadItems(month), loadPayments(month)]);
    setEmployees(emps.data);
    setItems(its.data);
    setPayments(pays);
    setLoadError(its.setupNeeded ? "setup" : emps.error || its.error ? "failed" : "");
    setLoading(false);
  }, [month]);

  useEffect(() => { load(); }, [load]);

  const byEmployee = useMemo(() => {
    const map = new Map<string, SalaryItem[]>();
    for (const i of items) map.set(i.profile_id, [...(map.get(i.profile_id) ?? []), i]);
    return map;
  }, [items]);

  const rows = useMemo(() => employees.map(e => {
    const its = byEmployee.get(e.id) ?? [];
    const payment = payments.find(p => p.profile_id === e.id) ?? null;
    // A paid month shows what was paid (the history); otherwise it's worked out live.
    return { e, payment, sum: payment ? summaryFromPayment(payment) : summarizeMonth(e.base_salary, its, month), pending: pendingItems(its).length };
  }), [employees, byEmployee, payments, month]);

  const totals = useMemo(() => rows.reduce((s, r) => ({
    base: s.base + r.sum.base,
    added: s.added + r.sum.overtime + r.sum.bonus + r.sum.refund,
    deducted: s.deducted + r.sum.deductions,
    net: s.net + r.sum.net,
    pending: s.pending + r.pending,
    paid: s.paid + (r.payment ? 1 : 0),
  }), { base: 0, added: 0, deducted: 0, net: 0, pending: 0, paid: 0 }), [rows]);

  const q = search.trim().toLowerCase();
  const shown = q ? rows.filter(r => r.e.name.toLowerCase().includes(q) || (r.e.phone_number ?? "").includes(q)) : rows;
  const selected = employees.find(e => e.id === selectedId) ?? null;
  const isThisMonth = month === monthKey();

  return (
    <div className="flex-1 overflow-auto bg-slate-50">
      <div className="px-6 py-5 border-b border-slate-100 bg-white">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{t("title")}</h1>
            <p className="text-slate-400 text-sm mt-0.5">{t("subtitle")}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <DebtLangToggle />
            <button onClick={() => setShowExport(true)}
              className="flex items-center gap-2 bg-white border border-slate-200 hover:border-slate-300 text-slate-700 font-semibold rounded-xl px-3.5 py-2 text-sm">
              <FileSpreadsheet className="w-4 h-4 text-emerald-600" /> {t("exportBtn")}
            </button>
            <button onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl px-4 py-2 text-sm transition-all">
              <Plus className="w-4 h-4" /> {t("newEmployee")}
            </button>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-5">
        {/* Month */}
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setMonth(m => shiftMonth(m, -1))} aria-label={t("prevMonth")}
            className="p-2 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-slate-900"><ChevronLeft className="w-4 h-4" /></button>
          <p className="text-base font-bold text-slate-900 min-w-[9rem] text-center" aria-live="polite">{monthLabel(month, lang)}</p>
          <button onClick={() => setMonth(m => shiftMonth(m, 1))} aria-label={t("nextMonth")}
            className="p-2 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-slate-900"><ChevronRight className="w-4 h-4" /></button>
          {!isThisMonth && (
            <button onClick={() => setMonth(monthKey())} className="text-xs font-semibold text-blue-600 hover:text-blue-500 px-2 py-1">{t("thisMonth")}</button>
          )}
        </div>

        {loadError === "setup" && (
          <div role="alert" className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {t("setupNeeded")}
          </div>
        )}
        {loadError === "failed" && (
          <div role="alert" className="flex items-center justify-between gap-3 bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-700">
            <span className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 shrink-0" /> {t("loadFailed")}</span>
            <button onClick={load} className="flex items-center gap-1 text-xs font-semibold"><RefreshCw className="w-3.5 h-3.5" /> {t("retry")}</button>
          </div>
        )}

        {/* Totals */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {([
            [t("totalBase"), totals.base, "text-slate-900"],
            [t("totalAdded"), totals.added, "text-emerald-700"],
            [t("totalDeducted"), totals.deducted, "text-red-600"],
            [t("totalNet"), totals.net, totals.net < 0 ? "text-red-600" : "text-blue-700"],
          ] as const).map(([label, value, color]) => (
            <div key={label} className="bg-white border border-slate-100 rounded-xl p-4 shadow-sm">
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">{label}</p>
              <p className={`text-lg md:text-xl font-black tabular-nums mt-1 ${color}`}>{mmkFmt(value)}</p>
              {label === t("totalNet") && employees.length > 0 && (
                <p className="text-[11px] text-slate-500 mt-0.5" data-testid="salary-paid-count">{t("paidCount", { p: totals.paid, n: employees.length })}</p>
              )}
            </div>
          ))}
        </div>

        {totals.pending > 0 && (
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800" data-testid="salary-pending-banner">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {t("pendingBanner", { n: totals.pending })}
          </div>
        )}

        {/* Employees */}
        <div className="bg-white border border-slate-100 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-100">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t("searchPh")} aria-label={t("searchPh")}
                className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-xl pl-9 pr-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-300/50" />
            </div>
          </div>

          <div className="hidden md:grid grid-cols-[1fr_8rem_8rem_8rem_9rem_1.5rem] gap-3 px-5 py-2.5 border-b border-slate-100 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
            <span>{t("colEmployee")}</span><span className="text-right">{t("colBase")}</span><span className="text-right">{t("colAdded")}</span>
            <span className="text-right">{t("colDeducted")}</span><span className="text-right">{t("colNet")}</span><span />
          </div>

          {loading && employees.length === 0 ? (
            <div className="py-12 text-center"><Loader2 className="w-6 h-6 text-blue-500/50 animate-spin mx-auto" /></div>
          ) : shown.length === 0 ? (
            <div className="py-12 text-center px-4">
              <Users className="w-8 h-8 text-slate-200 mx-auto mb-2" />
              <p className="text-slate-500 text-sm">{employees.length === 0 ? t("noEmployees") : t("noMatch")}</p>
              {employees.length === 0 && <p className="text-slate-400 text-xs mt-1">{t("noEmployeesHint")}</p>}
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {shown.map(({ e, sum, pending, payment }) => (
                <li key={e.id}>
                  <button onClick={() => setSelectedId(e.id)} className="w-full text-left px-5 py-3.5 hover:bg-slate-50 transition-colors group">
                    <div className="md:grid md:grid-cols-[1fr_8rem_8rem_8rem_9rem_1.5rem] md:gap-3 md:items-center">
                      <div className="flex items-center justify-between gap-3 min-w-0">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900 truncate">{e.name}</p>
                          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                            {payment && (
                              <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 rounded px-1.5 py-0.5 flex items-center gap-1">
                                <CheckCircle2 className="w-2.5 h-2.5" /> {t("paidBadge")}
                              </span>
                            )}
                            {e.base_salary <= 0 && <span className="text-[10px] text-amber-700">{t("noBase")}</span>}
                            {pending > 0 && (
                              <span className="text-[10px] font-bold text-amber-800 bg-amber-100 rounded px-1.5 py-0.5 flex items-center gap-1">
                                <AlertTriangle className="w-2.5 h-2.5" /> {t("pendingN", { n: pending })}
                              </span>
                            )}
                          </div>
                        </div>
                        {/* Phones: the amount to pay on the right */}
                        <div className="md:hidden text-right shrink-0">
                          <p className={`text-sm font-black tabular-nums ${sum.net < 0 ? "text-red-600" : "text-slate-900"}`}>{mmkFmt(sum.net)}</p>
                          <p className="text-[10px] text-slate-400">{t("colNet")}</p>
                        </div>
                      </div>
                      <p className="md:hidden text-[11px] text-slate-500 mt-1.5 tabular-nums">
                        {t("colBase")} {mmkFmt(sum.base)} · <span className="text-emerald-700">+{mmkFmt(sum.overtime + sum.bonus + sum.refund)}</span> · <span className="text-red-600">−{mmkFmt(sum.deductions)}</span>
                      </p>
                      <span className="hidden md:block text-right text-sm tabular-nums text-slate-700">{mmkFmt(sum.base)}</span>
                      <span className="hidden md:block text-right text-sm tabular-nums text-emerald-700">+{mmkFmt(sum.overtime + sum.bonus + sum.refund)}</span>
                      <span className="hidden md:block text-right text-sm tabular-nums text-red-600">−{mmkFmt(sum.deductions)}</span>
                      <span className={`hidden md:block text-right text-sm font-black tabular-nums ${sum.net < 0 ? "text-red-600" : "text-slate-900"}`}>{mmkFmt(sum.net)}</span>
                      <Arrow className="hidden md:block w-4 h-4 text-slate-300 group-hover:text-slate-500" />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {showExport && <SalaryExportDialog onClose={() => setShowExport(false)} />}

      {showCreate && <CreateEmployeeDialog onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); }} />}

      {selected && (
        <SalaryEmployeeDetail
          employee={selected}
          month={month}
          items={byEmployee.get(selected.id) ?? []}
          payment={payments.find(p => p.profile_id === selected.id) ?? null}
          onMonthChange={d => setMonth(m => shiftMonth(m, d))}
          onChanged={load}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

function CreateEmployeeDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const t = useSalaryT();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [base, setBase] = useState("");
  const [staffEmail, setStaffEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError(t("nameRequired")); return; }
    setBusy(true);
    setError("");
    const err = await createEmployee(name, phone, Number(base) || 0, todayKey(), staffEmail);
    setBusy(false);
    if (err) setError(err);
    else onCreated();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
      <div className="absolute inset-0 bg-black/60" onClick={() => !busy && onClose()} />
      <form onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="sal-new-title"
        className="relative w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 id="sal-new-title" className="text-slate-900 font-bold text-base flex items-center gap-2"><Wallet className="w-4 h-4 text-blue-600" /> {t("newEmployee")}</h2>
          <button type="button" onClick={onClose} disabled={busy} aria-label={t("close")} className="p-1.5 -m-1.5 rounded-lg text-slate-500 hover:bg-slate-100"><X className="w-5 h-5" /></button>
        </div>
        <div><label className={labelCls} htmlFor="sal-new-name">{t("name")}</label>
          <input id="sal-new-name" className={inputCls} value={name} onChange={e => setName(e.target.value)} autoFocus /></div>
        <div><label className={labelCls} htmlFor="sal-new-phone">{t("phone")} <span className="normal-case font-normal">{t("optional")}</span></label>
          <input id="sal-new-phone" className={inputCls} value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" /></div>
        <div><label className={labelCls} htmlFor="sal-new-base">{t("baseSalary")}</label>
          <input id="sal-new-base" className={inputCls} type="number" min="0" inputMode="numeric" value={base} onChange={e => setBase(e.target.value)} placeholder="0" /></div>
        <div><label className={labelCls} htmlFor="sal-new-email">{t("staffEmail")} <span className="normal-case font-normal">{t("optional")}</span></label>
          <input id="sal-new-email" className={inputCls} type="email" inputMode="email" autoComplete="off" value={staffEmail} onChange={e => setStaffEmail(e.target.value)} placeholder="name@stm" />
          <p className="text-[11px] text-slate-400 mt-1">{t("staffEmailHelp")}</p></div>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={busy}
          className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold rounded-xl py-3 text-sm">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} {busy ? t("saving") : t("addEmployee")}
        </button>
      </form>
    </div>
  );
}
