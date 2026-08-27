export const HOME_IC_LEDGER_TABLE = "home_ic_ledger";

export type IcEntryType = "income" | "expense";

export type IcRole = "mom" | "kitchen" | "dad" | "bro" | "me" | "am" | "bank_transfer" | "saving";

export const IC_ROLES: IcRole[] = ["mom", "kitchen", "dad", "bro", "me", "am", "bank_transfer", "saving"];

export const IC_ROLE_LABELS: Record<IcRole, string> = {
  mom: "Mom",
  kitchen: "Kitchen",
  dad: "Dad",
  bro: "Bro",
  me: "Me",
  am: "AM",
  bank_transfer: "Bank Transfer",
  saving: "Saving",
};

/** Saving entries are still deducted from the running balance (money set
 * aside is no longer on hand), but aren't counted as spending. */
export const IC_NON_EXPENSE_ROLES = new Set<IcRole>(["saving"]);

export type IcLedgerEntry = {
  id: string;
  entry_type: IcEntryType;
  role: IcRole;
  amount: number;
  note: string | null;
  entry_date: string; // "YYYY-MM-DD"
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

export const HOME_IC_SETUP_SQL = `-- Safe to run more than once — existing tables/policies are left as-is.
CREATE TABLE IF NOT EXISTS home_ic_ledger (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  entry_type text NOT NULL CHECK (entry_type IN ('income', 'expense')),
  role text NOT NULL,
  amount numeric NOT NULL,
  note text,
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE home_ic_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_read" ON home_ic_ledger;
CREATE POLICY "anon_read" ON home_ic_ledger FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "auth_manage" ON home_ic_ledger;
CREATE POLICY "auth_manage" ON home_ic_ledger FOR ALL TO authenticated USING (true);`;
