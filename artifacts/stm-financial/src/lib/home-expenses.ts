export const HOME_FAMILY_TABLE = "home_family_members";
export const HOME_EXPENSES_TABLE = "home_expenses";

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

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function monthStartStr(): string {
  return todayStr().slice(0, 7) + "-01";
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
CREATE POLICY "auth_manage" ON home_expenses FOR ALL TO authenticated USING (true);`;
