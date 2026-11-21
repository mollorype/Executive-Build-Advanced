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

export function monthLabel(key: string, lang: "en" | "my"): string {
  const [y, m] = key.split("-").map(Number);
  return lang === "my" ? `${y} ${MONTHS_MY[m - 1]}` : `${MONTHS_EN[m - 1]} ${y}`;
}

export function monthName(key: string, lang: "en" | "my"): string {
  const m = Number(key.split("-")[1]);
  return lang === "my" ? MONTHS_MY[m - 1] : MONTHS_EN[m - 1];
}
