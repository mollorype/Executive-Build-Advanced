export const HOME_FAMILY_TABLE = "home_family_members";
export const HOME_EXPENSES_TABLE = "home_expenses";
export const HOME_INCOME_DEDUCTIONS_TABLE = "home_income_deductions";
export const HOME_INCOME_ENTRIES_TABLE = "home_income_entries";

export type HomeExpenseCategory = "food" | "transport" | "health" | "education" | "utilities" | "other";

export const HOME_EXPENSE_CATEGORIES: HomeExpenseCategory[] = [
  "food", "transport", "health", "education", "utilities", "other",
];

export const HOME_EXPENSE_CATEGORY_LABELS: Record<HomeExpenseCategory, string> = {
  food: "Food",
  transport: "Transport",
  health: "Health",
  education: "Education",
  utilities: "Utilities",
  other: "Other",
};

export type FamilyMember = {
  id: string;
  name: string;
  created_at: string;
};

export type HomeExpense = {
  id: string;
  member_id: string | null;
  member_name: string;
  category: HomeExpenseCategory;
  amount: number;
  note: string | null;
  expense_date: string; // "YYYY-MM-DD"
  created_at: string;
};

export type IncomeDeduction = {
  id: string;
  name: string;
  amount: number;
  note: string | null;
  deduction_date: string; // "YYYY-MM-DD"
  created_at: string;
};

export type IncomeEntry = {
  id: string;
  name: string;
  amount: number;
  note: string | null;
  income_date: string; // "YYYY-MM-DD"
  created_at: string;
};

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function todayStr(): string {
  return toDateStr(new Date());
}

export function monthStartStr(): string {
  return todayStr().slice(0, 7) + "-01";
}

export function weekStartStr(): string {
  const d = new Date();
  const day = d.getDay(); // 0 = Sunday
  const sinceMonday = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - sinceMonday);
  return toDateStr(d);
}

export function yearStartStr(): string {
  return todayStr().slice(0, 4) + "-01-01";
}

export function lastMonthRange(): { from: string; to: string } {
  const now = new Date();
  const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastOfPrevMonth = new Date(firstOfThisMonth.getTime() - 1);
  const firstOfPrevMonth = new Date(lastOfPrevMonth.getFullYear(), lastOfPrevMonth.getMonth(), 1);
  return { from: toDateStr(firstOfPrevMonth), to: toDateStr(lastOfPrevMonth) };
}

/** Converts a "YYYY-MM-DD" date range into local start-of-day/end-of-day
 * timestamp bounds, for querying a timestamptz column (e.g. shifts). */
export function dateRangeToTimestampBounds(from: string, to: string): { fromISO: string; toISO: string } {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const fromDate = new Date(fy, fm - 1, fd, 0, 0, 0, 0);
  const toDate = new Date(ty, tm - 1, td, 23, 59, 59, 999);
  return { fromISO: fromDate.toISOString(), toISO: toDate.toISOString() };
}

export const HOME_EXPENSE_SETUP_SQL = `-- Run this once in your Supabase SQL Editor:
CREATE TABLE IF NOT EXISTS home_family_members (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE home_family_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read" ON home_family_members FOR SELECT TO anon USING (true);
CREATE POLICY "auth_manage" ON home_family_members FOR ALL TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS home_expenses (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  member_id uuid REFERENCES home_family_members(id) ON DELETE SET NULL,
  member_name text NOT NULL,
  category text NOT NULL,
  amount numeric NOT NULL,
  note text,
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE home_expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read" ON home_expenses FOR SELECT TO anon USING (true);
CREATE POLICY "auth_manage" ON home_expenses FOR ALL TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS home_income_deductions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  amount numeric NOT NULL,
  note text,
  deduction_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE home_income_deductions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read" ON home_income_deductions FOR SELECT TO anon USING (true);
CREATE POLICY "auth_manage" ON home_income_deductions FOR ALL TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS home_income_entries (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  amount numeric NOT NULL,
  note text,
  income_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE home_income_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read" ON home_income_entries FOR SELECT TO anon USING (true);
CREATE POLICY "auth_manage" ON home_income_entries FOR ALL TO authenticated USING (true);`;
