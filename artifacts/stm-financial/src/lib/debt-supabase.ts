import { supabase } from "./supabase";
export { supabase };

/*
  ══════════════════════════════════════════════════════════════
  REQUIRED SUPABASE SETUP — run these SQL statements once
  in your Supabase project → SQL Editor:

  CREATE TABLE debt_profiles (
    id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    name            text NOT NULL,
    age             integer,
    relation        text NOT NULL DEFAULT 'Other',
    phone_number    text,
    phone_numbers   text[] NOT NULL DEFAULT '{}',
    date            date NOT NULL DEFAULT CURRENT_DATE,
    total_debt      numeric,
    current_balance numeric NOT NULL DEFAULT 0,
    score           integer NOT NULL DEFAULT 50,
    last_payment_at timestamptz,
    credit_limit    numeric,
    payment_due_date date,
    credit_alert_fired  boolean NOT NULL DEFAULT false,
    overdue_alert_fired boolean NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE debt_transactions (
    id                 uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    profile_id         uuid NOT NULL REFERENCES debt_profiles(id) ON DELETE CASCADE,
    amount             numeric NOT NULL,
    date               date NOT NULL DEFAULT CURRENT_DATE,
    note               text,
    transaction_number text NOT NULL,
    source             text NOT NULL DEFAULT 'manual',
    product_type       text,
    price_per_liter    numeric,
    liters             numeric,
    gallons            numeric,
    highlighted        boolean NOT NULL DEFAULT false,
    created_at         timestamptz NOT NULL DEFAULT now()
  );

  -- MIGRATION (if debt_transactions already exists, add fuel + gallons columns
  -- AND change date column to timestamptz to preserve time-of-day):
  ALTER TABLE debt_transactions
    ADD COLUMN IF NOT EXISTS product_type    text,
    ADD COLUMN IF NOT EXISTS price_per_liter numeric,
    ADD COLUMN IF NOT EXISTS liters          numeric,
    ADD COLUMN IF NOT EXISTS gallons         numeric,
    ADD COLUMN IF NOT EXISTS highlighted     boolean NOT NULL DEFAULT false;

  -- Run this separately to upgrade the date column to full timestamp:
  ALTER TABLE debt_transactions
    ALTER COLUMN date TYPE timestamptz USING (date::timestamptz);

  -- Enable RLS + permissive policies (adjust for production):
  ALTER TABLE debt_profiles ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "allow_all" ON debt_profiles USING (true) WITH CHECK (true);
  ALTER TABLE debt_transactions ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "allow_all" ON debt_transactions USING (true) WITH CHECK (true);

  -- MIGRATION (if table already exists, add new columns):
  ALTER TABLE debt_profiles
    ADD COLUMN IF NOT EXISTS age integer,
    ADD COLUMN IF NOT EXISTS phone_numbers text[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS credit_limit numeric,
    ADD COLUMN IF NOT EXISTS payment_due_date date,
    ADD COLUMN IF NOT EXISTS credit_alert_fired boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS overdue_alert_fired boolean NOT NULL DEFAULT false;
  ══════════════════════════════════════════════════════════════
*/

export const DEBT_TABLES = {
  PROFILES: "debt_profiles",
  TRANSACTIONS: "debt_transactions",
} as const;

export type DebtRelation = "Friends" | "Family" | "Own" | "Contract" | "Vendor" | "Employee" | "Other";
export const RELATIONS: DebtRelation[] = ["Friends", "Family", "Own", "Contract", "Vendor", "Employee", "Other"];

export type DebtProfile = {
  id: string;
  name: string;
  age: number | null;
  relation: DebtRelation;
  phone_number: string | null;
  phone_numbers: string[];
  date: string;
  total_debt: number | null;
  current_balance: number;
  score: number;
  last_payment_at: string | null;
  credit_limit: number | null;
  payment_due_date: string | null;
  credit_alert_fired: boolean;
  overdue_alert_fired: boolean;
  created_at: string;
};

export type DebtTransaction = {
  id: string;
  profile_id: string;
  amount: number;
  date: string;
  note: string | null;
  transaction_number: string;
  source: "manual" | "daily_app";
  product_type: string | null;
  price_per_liter: number | null;
  liters: number | null;
  gallons: number | null;
  highlighted: boolean;
  created_at: string;
};

/**
 * Combines a user-selected date (YYYY-MM-DD) with the current local time
 * so that multiple entries on the same day stay in chronological order.
 * PostgreSQL accepts the resulting ISO string in both `date` and `timestamptz` columns.
 */
export function combineDateWithCurrentTime(dateStr: string): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${dateStr}T${hh}:${mm}:${ss}`;
}

export function generateTxnNumber(): string {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const r = Math.floor(Math.random() * 90000) + 10000;
  return `TXN-${d}-${r}`;
}

export function calculateScore(transactions: DebtTransaction[], currentBalance: number): number {
  let score = 50;
  const payments = transactions.filter(t => t.amount < 0);
  score += payments.length * 5;
  if (currentBalance <= 0 && payments.length > 0) score += 10;
  if (payments.length > 0 && currentBalance > 0) {
    const sorted = [...payments].sort((a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    const daysSince = Math.floor((Date.now() - new Date(sorted[0].created_at).getTime()) / 86400000);
    if (daysSince >= 60) score -= 10;
    else if (daysSince >= 30) score -= 5;
  }
  return Math.max(0, Math.min(100, score));
}

export function scoreColor(score: number) {
  if (score >= 80) return "#10b981";
  if (score >= 40) return "#f59e0b";
  return "#ef4444";
}

export function scoreTier(score: number) {
  if (score >= 80) return "Excellent";
  if (score >= 40) return "Average";
  return "High Risk";
}

export function mmkFmt(val: number | null | undefined, showSign = false) {
  if (val == null) return "—";
  const sign = showSign && val > 0 ? "+" : "";
  return sign + new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(val) + " MMK";
}

export function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length <= 2) return digits;
  return digits.slice(0, 2) + "-" + digits.slice(2, 11);
}

export function getDisplayPhones(profile: DebtProfile): string[] {
  if (profile.phone_numbers && profile.phone_numbers.length > 0) {
    return profile.phone_numbers.filter(Boolean);
  }
  if (profile.phone_number) return [profile.phone_number];
  return [];
}
