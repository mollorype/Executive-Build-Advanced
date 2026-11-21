import { useMemo, useState } from "react";
import {
  X, Pencil, Trash2, Loader2, ChevronLeft, ChevronRight, AlertTriangle, Plus, Undo2, Smartphone, Clock, CheckCircle2, Banknote,
} from "lucide-react";
import { mmkFmt } from "@/lib/debt-supabase";
import { useDebtLang } from "@/lib/debt-i18n";
import DebtLangToggle from "@/components/debt-lang-toggle";
import { useSalaryT, typeLabel } from "@/lib/salary-i18n";
import {
  summarizeMonth, pendingItems, monthHistory, monthLabel, monthName, defaultDayIn, signedAmount, dailyNote,
  summaryFromPayment, sameSummary, type SalaryItem, type SalaryItemType, type SalaryPayment,
} from "@/lib/salary-math";
import { addItem, decideItem, deleteItem, deleteEmployee, updateEmployee, payMonth, undoPayment, type Employee } from "@/lib/salary";

const inputCls = "w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-300/50 placeholder:text-slate-400";
const labelCls = "block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5";

const TYPE_STYLE: Record<SalaryItemType, string> = {
  Overtime: "bg-sky-50 text-sky-700 border-sky-100",
  Bonus: "bg-emerald-50 text-emerald-700 border-emerald-100",
  Refund: "bg-teal-50 text-teal-700 border-teal-100",
  Deduction: "bg-red-50 text-red-700 border-red-100",
};

function fmtDay(d: string) {
  return new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

type EntryType = "Overtime" | "Bonus" | "Deduction";

export default function SalaryEmployeeDetail({ employee, month, items, payment, onMonthChange, onChanged, onClose }: {
  employee: Employee;
  month: string;
  /** This month's saved payment, if it was marked paid. */
  payment: SalaryPayment | null;
  /** This employee's items for `month` plus all their pending ones. */
  items: SalaryItem[];
  onMonthChange: (delta: number) => void;
  onChanged: () => void;
  onClose: () => void;
}) {
  const t = useSalaryT();
  const lang = useDebtLang();
  const live = useMemo(() => summarizeMonth(employee.base_salary, items, month), [employee.base_salary, items, month]);
  // A paid month shows what was paid — the history — even if entries change later.
  const sum = payment ? summaryFromPayment(payment) : live;
  const changedSincePaid = !!payment && !sameSummary(live, sum);
  const pending = useMemo(() => pendingItems(items), [items]);
  const history = useMemo(() => monthHistory(items, month), [items, month]);
  const mLabel = monthLabel(month, lang);
  const mName = monthName(month, lang);

  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function run(key: string, fn: () => Promise<string | null>) {
    setBusy(key);
    setError("");
    const err = await fn();
    setBusy(null);
    if (err) setError(err);
    else onChanged();
    return !err;
  }

  // ── Edit employee ──
  const [editing, setEditing] = useState(false);
  const [eName, setEName] = useState(employee.name);
  const [ePhone, setEPhone] = useState(employee.phone_number ?? "");
  const [eBase, setEBase] = useState(String(employee.base_salary || ""));
  const [eEmail, setEEmail] = useState(employee.staff_email ?? "");
  function openEdit() {
    setEEmail(employee.staff_email ?? "");
    setEName(employee.name);
    setEPhone(employee.phone_number ?? "");
    setEBase(String(employee.base_salary || ""));
    setEditing(true);
  }
  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!eName.trim()) { setError(t("nameRequired")); return; }
    if (await run("edit", () => updateEmployee(employee.id, eName, ePhone, Number(eBase) || 0, eEmail))) setEditing(false);
  }
  async function removeEmployee() {
    if (!window.confirm(t("confirmDelete", { name: employee.name }))) return;
    setBusy("delete");
    const err = await deleteEmployee(employee.id);
    setBusy(null);
    if (err) { setError(err); return; }
    onChanged();
    onClose();
  }

  // ── Add entry ──
  const [type, setType] = useState<EntryType>("Overtime");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => defaultDayIn(month));
  const [note, setNote] = useState("");
  const [dateMonth, setDateMonth] = useState(month);
  if (dateMonth !== month) { setDateMonth(month); setDate(defaultDayIn(month)); }   // follow the month being viewed

  async function submitEntry(e: React.FormEvent) {
    e.preventDefault();
    const a = Number(amount);
    if (!(a > 0)) { setError(t("enterAmount")); return; }
    const ok = await run("add", () => addItem({
      profile_id: employee.id, type, amount: a, date: date || defaultDayIn(month), salary_month: month, label: note.trim() || null,
    }));
    if (ok) { setAmount(""); setNote(""); }
  }

  const addLabel = type === "Overtime" ? t("addOvertime") : type === "Bonus" ? t("addBonus") : t("addDeduction");

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={employee.name}
        className="relative w-full max-w-[520px] bg-white border-l border-slate-100 h-full overflow-y-auto shadow">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-slate-100 px-5 py-4 flex items-start justify-between gap-3 z-10">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 font-bold text-lg shrink-0">
              {employee.name[0]?.toUpperCase()}
            </div>
            <div className="min-w-0">
              <h2 className="text-slate-900 font-bold text-base leading-tight truncate">{employee.name}</h2>
              <p className="text-slate-500 text-xs">{t("employeeOn", { date: fmtDay(employee.date) })}</p>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <DebtLangToggle />
            <button onClick={openEdit} title={t("editEmployee")} aria-label={t("editEmployee")}
              className="text-slate-400 hover:text-slate-900 p-1.5 rounded-lg hover:bg-slate-100"><Pencil className="w-4 h-4" /></button>
            <button onClick={removeEmployee} disabled={busy === "delete"} title={t("deleteEmployee")} aria-label={t("deleteEmployee")}
              className="text-slate-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 disabled:opacity-40">
              {busy === "delete" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            </button>
            <button onClick={onClose} aria-label={t("close")} className="text-slate-500 hover:text-slate-900 p-1.5 rounded-lg hover:bg-slate-100"><X className="w-5 h-5" /></button>
          </div>
        </div>

        <div className="p-5 space-y-5">
          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-700">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
            </div>
          )}

          {editing && (
            <form onSubmit={saveEdit} className="bg-slate-50 border border-slate-100 rounded-xl p-4 space-y-3">
              <div><label className={labelCls} htmlFor="sal-e-name">{t("name")}</label>
                <input id="sal-e-name" className={inputCls} value={eName} onChange={e => setEName(e.target.value)} autoFocus /></div>
              <div><label className={labelCls} htmlFor="sal-e-phone">{t("phone")}</label>
                <input id="sal-e-phone" className={inputCls} value={ePhone} onChange={e => setEPhone(e.target.value)} inputMode="tel" /></div>
              <div><label className={labelCls} htmlFor="sal-e-base">{t("baseSalary")}</label>
                <input id="sal-e-base" className={inputCls} type="number" min="0" value={eBase} onChange={e => setEBase(e.target.value)} placeholder="0" /></div>
              <div><label className={labelCls} htmlFor="sal-e-email">{t("staffEmail")} <span className="normal-case font-normal">{t("optional")}</span></label>
                <input id="sal-e-email" className={inputCls} type="email" inputMode="email" autoComplete="off" value={eEmail} onChange={e => setEEmail(e.target.value)} placeholder="name@stm" />
                <p className="text-[11px] text-slate-400 mt-1">{t("staffEmailHelp")}</p></div>
              <div className="flex gap-2">
                <button type="submit" disabled={busy === "edit"} className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold rounded-xl py-2.5">
                  {busy === "edit" ? t("saving") : t("save")}
                </button>
                <button type="button" onClick={() => setEditing(false)} className="px-4 text-sm font-semibold text-slate-500 hover:text-slate-900 rounded-xl border border-slate-200">{t("cancel")}</button>
              </div>
            </form>
          )}

          {/* Month */}
          <div className="flex items-center justify-between gap-2">
            <button onClick={() => onMonthChange(-1)} aria-label={t("prevMonth")} className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-900 hover:bg-slate-50"><ChevronLeft className="w-4 h-4" /></button>
            <p className="text-sm font-bold text-slate-900">{mLabel}</p>
            <button onClick={() => onMonthChange(1)} aria-label={t("nextMonth")} className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-900 hover:bg-slate-50"><ChevronRight className="w-4 h-4" /></button>
          </div>

          {/* Salary pool */}
          <div className="bg-slate-50 border border-slate-100 rounded-xl p-4">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">{t("poolTitle", { month: mLabel })}</p>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-slate-500">{t("baseLine")}</dt>
                <dd className="font-semibold tabular-nums text-slate-900">{employee.base_salary > 0 ? mmkFmt(sum.base) : <span className="text-amber-600 font-normal text-xs">{t("noBase")}</span>}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">+ {t("overtime")}</dt><dd className="tabular-nums text-sky-700">{mmkFmt(sum.overtime)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">+ {t("bonus")}</dt><dd className="tabular-nums text-emerald-700">{mmkFmt(sum.bonus)}</dd></div>
              {sum.refund > 0 && <div className="flex justify-between gap-3"><dt className="text-slate-500">+ {t("refund")}</dt><dd className="tabular-nums text-teal-700">{mmkFmt(sum.refund)}</dd></div>}
              <div className="flex justify-between gap-3"><dt className="text-slate-500">− {t("deduction")}</dt><dd className="tabular-nums text-red-600">{mmkFmt(sum.deductions)}</dd></div>
              <div className="flex justify-between gap-3 border-t border-slate-200 pt-2.5 mt-1">
                <dt className="font-bold text-slate-900">{t("net")}</dt>
                <dd data-testid="salary-net" className={`text-xl font-black tabular-nums ${sum.net < 0 ? "text-red-600" : "text-slate-900"}`}>{mmkFmt(sum.net)}</dd>
              </div>
            </dl>
            {sum.net < 0 && <p className="text-xs text-red-600 mt-2">{t("overDeducted", { a: mmkFmt(-sum.net) })}</p>}
          </div>

          {/* Paid / mark paid */}
          {payment ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4" data-testid="salary-paid">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-emerald-800 flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" /> {t("paidTitle", { month: mName })} · {mmkFmt(payment.net)}</p>
                  <p className="text-xs text-emerald-800/80 mt-0.5">{t("paidOn", { date: new Date(payment.paid_at).toLocaleString("en-GB", { timeZone: "Asia/Yangon", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) })}{payment.paid_by ? ` · ${payment.paid_by}` : ""}</p>
                </div>
                <button onClick={() => { if (window.confirm(t("confirmUndoPay"))) run("unpay", () => undoPayment(payment.id)); }} disabled={busy === "unpay"}
                  className="shrink-0 text-xs font-semibold text-emerald-800 hover:text-emerald-950 border border-emerald-200 bg-white rounded-lg px-2.5 py-1.5 disabled:opacity-50">
                  {busy === "unpay" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t("undoPay")}
                </button>
              </div>
              {changedSincePaid && <p className="text-xs text-amber-700 mt-2">{t("changedAfterPay", { a: mmkFmt(live.net) })}</p>}
            </div>
          ) : (
            <button
              onClick={() => {
                const msg = t("confirmPay", { name: employee.name, month: mLabel, a: mmkFmt(live.net) }) + (pending.length ? t("confirmPayPending", { n: pending.length }) : "");
                if (window.confirm(msg)) run("pay", () => payMonth(employee.id, month, live));
              }}
              disabled={busy === "pay"}
              className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-bold rounded-xl py-3">
              {busy === "pay" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Banknote className="w-4 h-4" />} {t("markPaid", { month: mName, a: mmkFmt(live.net) })}
            </button>
          )}

          {/* Pending from STM Daily */}
          {pending.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4" data-testid="salary-pending">
              <p className="text-sm font-bold text-amber-800 flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> {t("pendingTitle")}</p>
              <p className="text-xs text-amber-800/80 mt-1 mb-3">{t("pendingHelp")}</p>
              <div className="space-y-2.5">
                {pending.map(p => {
                  const took = p.type === "Deduction";
                  return (
                    <div key={p.id} className="bg-white border border-amber-100 rounded-lg p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900">{took ? t("tookCash") : t("paidBack")}</p>
                          {dailyNote(p.label) && <p className="text-sm text-slate-700 mt-0.5 break-words">“{dailyNote(p.label)}”</p>}
                          <p className="text-xs text-slate-500 mt-0.5">{fmtDay(p.date)}{p.reported_by ? ` · ${t("byStaff", { name: p.reported_by })}` : ""}</p>
                        </div>
                        <p className={`text-sm font-bold tabular-nums whitespace-nowrap ${took ? "text-red-600" : "text-teal-700"}`}>{took ? "−" : "+"}{mmkFmt(p.amount)}</p>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-2.5">
                        <button onClick={() => run(p.id, () => decideItem(p.id, "applied", month))} disabled={busy === p.id}
                          className={`flex-1 min-w-[9rem] flex items-center justify-center gap-1.5 text-white text-xs font-bold rounded-lg px-3 py-2 disabled:opacity-50 ${took ? "bg-red-600 hover:bg-red-500" : "bg-teal-600 hover:bg-teal-500"}`}>
                          {busy === p.id && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                          {took ? t("deductFrom", { month: mName }) : t("addBackTo", { month: mName })}
                        </button>
                        <button onClick={() => { if (window.confirm(t("confirmDismiss"))) run(p.id, () => decideItem(p.id, "dismissed")); }} disabled={busy === p.id}
                          className="px-3 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg bg-white disabled:opacity-50">
                          {t("dismiss")}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Add to salary */}
          <form onSubmit={submitEntry} className="bg-white border border-slate-100 rounded-xl p-4 space-y-3">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">{t("addEntry")}</p>
            <div className="grid grid-cols-3 gap-1.5 bg-slate-50 p-1 rounded-xl" role="radiogroup" aria-label={t("addEntry")}>
              {(["Overtime", "Bonus", "Deduction"] as EntryType[]).map(ty => (
                <button key={ty} type="button" role="radio" aria-checked={type === ty} onClick={() => setType(ty)}
                  className={`text-xs font-bold rounded-lg py-2 transition-colors ${type === ty
                    ? ty === "Deduction" ? "bg-red-600 text-white" : ty === "Bonus" ? "bg-emerald-600 text-white" : "bg-sky-600 text-white"
                    : "text-slate-500 hover:text-slate-900"}`}>
                  {typeLabel(ty, lang)}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls} htmlFor="sal-amount">{t("amount")}</label>
                <input id="sal-amount" className={inputCls} type="number" min="0" inputMode="numeric" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" /></div>
              <div><label className={labelCls} htmlFor="sal-date">{t("date")}</label>
                <input id="sal-date" className={inputCls} type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
            </div>
            <div><label className={labelCls} htmlFor="sal-note">{t("note")} <span className="normal-case font-normal">{t("optional")}</span></label>
              <input id="sal-note" className={inputCls} value={note} onChange={e => setNote(e.target.value)} placeholder={t("notePh")} maxLength={300} /></div>
            <button type="submit" disabled={busy === "add"}
              className={`w-full flex items-center justify-center gap-2 text-white text-sm font-bold rounded-xl py-2.5 disabled:opacity-50 ${type === "Deduction" ? "bg-red-600 hover:bg-red-500" : type === "Bonus" ? "bg-emerald-600 hover:bg-emerald-500" : "bg-sky-600 hover:bg-sky-500"}`}>
              {busy === "add" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} {addLabel}
            </button>
            <p className="text-[11px] text-slate-400 text-center">{t("countsIn", { month: mName })}</p>
          </form>

          {/* History */}
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2"><Clock className="w-3.5 h-3.5" /> {t("history", { month: mLabel })}</p>
            {history.length === 0 ? (
              <div className="bg-slate-50 border border-slate-100 rounded-xl p-5 text-center text-sm text-slate-500">{t("noHistory")}</div>
            ) : (
              <div className="bg-slate-50 border border-slate-100 rounded-xl divide-y divide-slate-100 overflow-hidden">
                {history.map(h => {
                  const dismissed = h.status === "dismissed";
                  const amt = signedAmount(h);
                  return (
                    <div key={h.id} className={`px-4 py-3 flex items-start justify-between gap-3 ${dismissed ? "opacity-60" : ""}`}>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`text-[10px] font-bold border rounded px-1.5 py-0.5 ${TYPE_STYLE[h.type]}`}>{typeLabel(h.type, lang)}</span>
                          {h.source === "daily_app" && <span className="text-[10px] text-amber-700 bg-amber-50 border border-amber-100 rounded px-1.5 py-0.5 flex items-center gap-0.5"><Smartphone className="w-2.5 h-2.5" /> {t("dailyTag")}</span>}
                          {dismissed && <span className="text-[10px] text-slate-500 border border-slate-200 rounded px-1.5 py-0.5">{t("dismissedTag")}</span>}
                        </div>
                        <p className="text-xs text-slate-500 mt-1">
                          {fmtDay(h.date)}
                          {h.source === "daily_app"
                            ? `${dailyNote(h.label) ? ` · ${dailyNote(h.label)}` : ""}${h.reported_by ? ` · ${t("byStaff", { name: h.reported_by })}` : ""}`
                            : h.label ? ` · ${h.label}` : ""}
                          {h.decided_by ? ` · ${t("decidedBy", { who: h.decided_by })}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <p className={`text-sm font-bold tabular-nums whitespace-nowrap ${dismissed ? "line-through text-slate-400" : amt < 0 ? "text-red-600" : "text-emerald-700"}`}>
                          {amt < 0 ? "−" : "+"}{mmkFmt(Math.abs(amt))}
                        </p>
                        {h.source === "daily_app" ? (
                          <button onClick={() => run(h.id, () => decideItem(h.id, "pending"))} disabled={busy === h.id}
                            title={t("undoHelp")} aria-label={`${t("undo")} — ${t("undoHelp")}`}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-white disabled:opacity-40">
                            {busy === h.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Undo2 className="w-3.5 h-3.5" />}
                          </button>
                        ) : (
                          <button onClick={() => { if (window.confirm(t("confirmDeleteEntry"))) run(h.id, () => deleteItem(h.id)); }} disabled={busy === h.id}
                            title={t("deleteEntry")} aria-label={t("deleteEntry")}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-white disabled:opacity-40">
                            {busy === h.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                          </button>
                        )}
                      </div>
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
