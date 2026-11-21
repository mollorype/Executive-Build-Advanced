// Salary Management — the arithmetic, kept free of app imports so it can be unit-tested.
//
// Each employee has a monthly base salary. Items change one month's pay:
// Overtime, Bonus and Refund (cash the employee paid back) add; Deduction subtracts.
// Only *applied* items count. Pending items (cash taken through STM Daily) are
// warnings until someone deducts or dismisses them.

export type SalaryItemType = "Overtime" | "Bonus" | "Deduction" | "Refund";
export type SalaryItemStatus = "pending" | "applied" | "dismissed";

export type SalaryItem = {
  id: string;
  profile_id: string;
  type: SalaryItemType;
  label: string | null;
  amount: number;
  /** The day it happened (yyyy-mm-dd). */
  date: string;
  /** The salary month it counts in (yyyy-mm-01). */
  salary_month: string;
  source: "manual" | "daily_app";
  status: SalaryItemStatus;
  transaction_number: string | null;
  reported_by: string | null;
  decided_at: string | null;
  decided_by: string | null;
  created_at: string;
};

const ADDS = new Set<SalaryItemType>(["Overtime", "Bonus", "Refund"]);

const DEFAULT_DAILY_NOTE = "Payment via Daily Shift";

/** What staff typed for an STM Daily entry ("<note> — <staff>"), or null for the default wording. */
export function dailyNote(label: string | null): string | null {
  const what = (label ?? "").split(" — ")[0].trim();
  return what && what !== DEFAULT_DAILY_NOTE ? what : null;
}

export const isAddition = (type: SalaryItemType) => ADDS.has(type);

/** + for money added to pay, − for money taken off. */
export const signedAmount = (i: Pick<SalaryItem, "type" | "amount">) => (isAddition(i.type) ? i.amount : -i.amount);

export type MonthSummary = {
  base: number;
  overtime: number;
  bonus: number;
  refund: number;
  deductions: number;
  /** base + overtime + bonus + refund − deductions. Negative = deducted more than the pay. */
  net: number;
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);

export function summarizeMonth(baseSalary: number, items: SalaryItem[], month: string): MonthSummary {
  const s: MonthSummary = { base: Math.max(0, num(baseSalary)), overtime: 0, bonus: 0, refund: 0, deductions: 0, net: 0 };
  for (const i of items) {
    if (i.status !== "applied" || i.salary_month !== month) continue;
    const a = Math.max(0, num(i.amount));
    if (i.type === "Overtime") s.overtime += a;
    else if (i.type === "Bonus") s.bonus += a;
    else if (i.type === "Refund") s.refund += a;
    else if (i.type === "Deduction") s.deductions += a;
  }
  s.net = s.base + s.overtime + s.bonus + s.refund - s.deductions;
  return s;
}

/** Waiting for a decision, oldest first — whichever month they happened in. */
export function pendingItems(items: SalaryItem[]): SalaryItem[] {
  return items
    .filter(i => i.status === "pending")
    .sort((a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at));
}

/** A month's applied and dismissed items, newest first (pending ones are listed separately). */
export function monthHistory(items: SalaryItem[], month: string): SalaryItem[] {
  return items
    .filter(i => i.status !== "pending" && i.salary_month === month)
    .sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at));
}

/** A month's pay as it was saved when marked paid (employee_salary_payments). */
export type SalaryPayment = {
  id: string; profile_id: string; salary_month: string;
  base: number; overtime: number; bonus: number; refund: number; deductions: number; net: number;
  note: string | null; paid_at: string; paid_by: string | null;
};

/** The summary a payment recorded — what the history shows for a paid month. */
export function summaryFromPayment(p: SalaryPayment): MonthSummary {
  return { base: p.base, overtime: p.overtime, bonus: p.bonus, refund: p.refund, deductions: p.deductions, net: p.net };
}

export const sameSummary = (a: MonthSummary, b: MonthSummary) =>
  a.base === b.base && a.overtime === b.overtime && a.bonus === b.bonus && a.refund === b.refund && a.deductions === b.deductions;

const pad = (n: number) => String(n).padStart(2, "0");

/** This month on this device, as yyyy-mm-01. */
export function monthKey(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
}

export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}-01`;
}

/** Today on this device, as yyyy-mm-dd. */
export function todayKey(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A day inside the month: today when it's the current month, else the 1st. */
export function defaultDayIn(month: string, now = new Date()): string {
  return monthKey(now) === month ? todayKey(now) : month;
}

const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_MY = ["ဇန်နဝါရီ", "ဖေဖော်ဝါရီ", "မတ်", "ဧပြီ", "မေ", "ဇွန်", "ဇူလိုင်", "ဩဂုတ်", "စက်တင်ဘာ", "အောက်တိုဘာ", "နိုဝင်ဘာ", "ဒီဇင်ဘာ"];

/** Every month from `from` to `to` (both yyyy-mm-01), oldest first. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  if (from > to) [from, to] = [to, from];
  for (let m = from; m <= to && out.length < 120; m = shiftMonth(m, 1)) out.push(m);
  return out;
}

export type RangePreset = "this" | "last" | "last3" | "last6" | "year" | "custom";

/** The months a preset covers, counted from `now`'s month. */
export function presetRange(preset: Exclude<RangePreset, "custom">, now = new Date()): { from: string; to: string } {
  const cur = monthKey(now);
  switch (preset) {
    case "this": return { from: cur, to: cur };
    case "last": return { from: shiftMonth(cur, -1), to: shiftMonth(cur, -1) };
    case "last3": return { from: shiftMonth(cur, -2), to: cur };
    case "last6": return { from: shiftMonth(cur, -5), to: cur };
    case "year": return { from: `${now.getFullYear()}-01-01`, to: cur };
  }
}

export function monthLabel(key: string, lang: "en" | "my"): string {
  const [y, m] = key.split("-").map(Number);
  return lang === "my" ? `${y} ${MONTHS_MY[m - 1]}` : `${MONTHS_EN[m - 1]} ${y}`;
}

export function monthName(key: string, lang: "en" | "my"): string {
  const m = Number(key.split("-")[1]);
  return lang === "my" ? MONTHS_MY[m - 1] : MONTHS_EN[m - 1];
}

export type SalaryRow<E> = { month: string; employee: E; sum: MonthSummary; payment: SalaryPayment | null };

/**
 * One row per employee per month in from..to (for the Excel export), skipping
 * months before an employee started. Paid months use the saved payment.
 */
export function buildSalaryRows<E extends { id: string; name: string; date: string; base_salary: number }>(
  employees: E[], items: SalaryItem[], payments: SalaryPayment[], from: string, to: string,
): SalaryRow<E>[] {
  const rows: SalaryRow<E>[] = [];
  const byKey = new Map(payments.map(p => [`${p.profile_id}|${p.salary_month}`, p]));
  const sorted = [...employees].sort((a, b) => a.name.localeCompare(b.name));
  for (const month of monthsBetween(from, to)) {
    for (const e of sorted) {
      if (e.date && e.date.slice(0, 7) > month.slice(0, 7)) continue;   // hadn't started yet
      const payment = byKey.get(`${e.id}|${month}`) ?? null;
      const sum = payment ? summaryFromPayment(payment) : summarizeMonth(e.base_salary, items.filter(i => i.profile_id === e.id), month);
      rows.push({ month, employee: e, sum, payment });
    }
  }
  return rows;
}
