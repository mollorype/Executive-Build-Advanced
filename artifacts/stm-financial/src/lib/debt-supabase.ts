import { supabase } from "./supabase";
export { supabase };

/*
  ══════════════════════════════════════════════════════════════
  REQUIRED SUPABASE SETUP — run these SQL statements once
  in your Supabase project → SQL Editor:

  CREATE TABLE debt_profiles (
    id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    name            text NOT NULL,
    relation        text NOT NULL DEFAULT 'Other',
    phone_number    text,
    date            date NOT NULL DEFAULT CURRENT_DATE,
    total_debt      numeric,
    current_balance numeric NOT NULL DEFAULT 0,
    score           integer NOT NULL DEFAULT 50,
    last_payment_at timestamptz,
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
    created_at         timestamptz NOT NULL DEFAULT now()
  );

  -- Enable RLS + permissive policies (adjust for production):
  ALTER TABLE debt_profiles ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "allow_all" ON debt_profiles USING (true) WITH CHECK (true);
  ALTER TABLE debt_transactions ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "allow_all" ON debt_transactions USING (true) WITH CHECK (true);
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
  relation: DebtRelation;
  phone_number: string | null;
  date: string;
  total_debt: number | null;
  current_balance: number;
  score: number;
  last_payment_at: string | null;
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
  created_at: string;
};

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
