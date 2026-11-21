import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  import.meta.env.NEXT_PUBLIC_SUPABASE_URL ||
  import.meta.env.VITE_SUPABASE_URL ||
  "https://api.shwethazinmoe.site";

const supabaseAnonKey =
  import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "sb_publishable_gzut68hKDAV9cirHdk8bpw_O_yTUXZS";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export const TABLES = {
  SHIFTS: "daily_sales_reports",
  PO: "fuel_purchase_orders",
  PROFILES: "profiles",
} as const;

export type Fuel92Pump = { pump: "normal" | "new"; liters: number; price: number; total: number };

export const COLS = {
  TIMESTAMP: "timestamp",
  EMPLOYEE_NAME: "employee_name",
  EMPLOYEE_ID: "employee_id",
  FUEL_DATA: "fuel_data",
  TOTAL_EXPENSES: "total_expenses",
  EXPENSES_BREAKDOWN: "expenses_breakdown",
  EXPECTED_TOTAL: "expected_total",
  ACTUAL_CASH: "actual_cash",
  VARIANCE: "variance",
} as const;

export type ExpenseItem = {
  name: string;
  amount: number;
  /** Optional note typed in STM Daily. */
  note?: string;
};

export function mapRowToShift(row: Record<string, unknown>): Shift {
  const fuel = (row[COLS.FUEL_DATA] as Record<string, number> | null) ?? {};
  const breakdownRaw = row[COLS.EXPENSES_BREAKDOWN];
  let expenses_breakdown: ExpenseItem[] | null = null;
  if (Array.isArray(breakdownRaw) && breakdownRaw.length > 0) {
    expenses_breakdown = (breakdownRaw as Array<{ name: string; amount: number; note?: unknown }>)
      .filter(item => item && typeof item.name === "string")
      .map(item => ({
        name: item.name,
        amount: Number(item.amount) || 0,
        ...(typeof item.note === "string" && item.note.trim() ? { note: item.note.trim() } : {}),
      }));
  }

  return {
    id: row.id as string,
    created_at: (row[COLS.TIMESTAMP] as string) ?? (row.created_at as string) ?? "",
    employee_username: (row[COLS.EMPLOYEE_NAME] as string) ?? "",
    expected_cash_total: (row[COLS.EXPECTED_TOTAL] as number) ?? 0,
    actual_cash_collected: (row[COLS.ACTUAL_CASH] as number) ?? 0,
    difference: (row[COLS.VARIANCE] as number) ?? 0,
    expenses: (row[COLS.TOTAL_EXPENSES] as number) ?? null,
    expenses_breakdown,
    additional_cash_items: Array.isArray(row.additional_cash_items) ? (row.additional_cash_items as { name: string; amount: number }[]) : null,
    additional_cash_total: typeof row.additional_cash_total === "number" ? row.additional_cash_total : null,
    fuel_92_liters: fuel.fuel_92_liters ?? null,
    fuel_92_price: fuel.fuel_92_price ?? null,
    fuel_92_total: fuel.fuel_92_total ?? null,
    fuel_92_pumps: Array.isArray((fuel as Record<string, unknown>).fuel_92_pumps)
      ? (fuel as Record<string, unknown>).fuel_92_pumps as Fuel92Pump[] : null,
    fuel_95_liters: fuel.fuel_95_liters ?? null,
    fuel_95_price: fuel.fuel_95_price ?? null,
    fuel_95_total: fuel.fuel_95_total ?? null,
    premium_diesel_liters: fuel.premium_diesel_liters ?? null,
    premium_diesel_price: fuel.premium_diesel_price ?? null,
    premium_diesel_total: fuel.premium_diesel_total ?? null,
    pipa_amount: fuel.pipa_amount ?? null,
    pipa_price: fuel.pipa_price ?? null,
    pipa_total: fuel.pipa_total ?? null,
    pipa_items: Array.isArray(fuel.pipa_items) ? fuel.pipa_items : null,
    jelly_can_items: Array.isArray(fuel.jelly_can_items) ? fuel.jelly_can_items : null,
    pipa_jelly_payment: parsePipaJellyPayment((fuel as Record<string, unknown>).pipa_jelly_payment),
    diesel_cash: fuel.diesel_cash ?? null,
    diesel_price: fuel.diesel_price ?? null,
  };
}

export type Role = "ceo" | "accountant";

/** What each role is called on screen. The stored role names (and every check on them) stay the same. */
export const ROLE_LABELS: Record<Role, string> = { ceo: "Owner", accountant: "Accountant" };

export type Profile = {
  id: string;
  username: string;
  role: Role;
};

export type FuelPurchaseOrder = {
  id: string;
  created_at: string;
  name: string | null;
  product_type: "92" | "95" | "PD" | "D" | "pipa";
  status: "ACTIVE" | "QUEUED" | "DONE";
  initial_volume: number;
  remaining_volume: number;
  calibration_factor: number;
  wholesale_price: number | null;
  transportation_fees: number | null;
  confidential_fees: number | null;
  retail_price_set: number | null;
  is_verified: boolean;
  shortage_liters: number | null;
  total_volume_sold: number | null;
};

export async function updateShift(id: string, data: {
  fuel_data: Record<string, unknown>;
  total_expenses: number;
  expenses_breakdown: ExpenseItem[];
  expected_total: number;
  actual_cash: number;
  variance: number;
  timestamp?: string;
}): Promise<{ error: string | null }> {
  const payload: Record<string, unknown> = {
    [COLS.FUEL_DATA]: data.fuel_data,
    [COLS.TOTAL_EXPENSES]: data.total_expenses,
    [COLS.EXPENSES_BREAKDOWN]: data.expenses_breakdown,
    [COLS.EXPECTED_TOTAL]: data.expected_total,
    [COLS.ACTUAL_CASH]: data.actual_cash,
    [COLS.VARIANCE]: data.variance,
  };
  if (data.timestamp) payload[COLS.TIMESTAMP] = data.timestamp;

  const { data: updated, error } = await supabase
    .from(TABLES.SHIFTS)
    .update(payload)
    .eq("id", id)
    .select("id");

  if (error) return { error: error.message };
  if (!updated || updated.length === 0) {
    return { error: "Update was blocked by the database — check that your Supabase UPDATE policy allows changes to this table." };
  }
  return { error: null };
}

/** Update the date of all debt_transactions that were auto-created by a shift. */
export async function updateDebtTransactionDates(
  originalDateStr: string, // "YYYY-MM-DD"
  newDateStr: string,       // "YYYY-MM-DD"
  employeeName: string,
): Promise<void> {
  if (!originalDateStr || !newDateStr || originalDateStr === newDateStr) return;

  // Build the end of the original day to handle both `date` and `timestamptz` columns
  const nextDay = new Date(originalDateStr);
  nextDay.setDate(nextDay.getDate() + 1);
  const nextDayStr = nextDay.toISOString().slice(0, 10);

  await supabase
    .from("debt_transactions")
    .update({ date: newDateStr })
    .eq("source", "daily_app")
    .gte("date", originalDateStr)
    .lt("date", nextDayStr)
    .ilike("note", `%${employeeName}%`);
}

export type Shift = {
  id: string;
  created_at: string;

  employee_username: string;

  expected_cash_total: number;
  actual_cash_collected: number;
  difference: number;

  fuel_92_liters: number | null;
  fuel_92_price: number | null;
  fuel_92_total: number | null;
  /** STM Daily's per-pump split for Fuel 92 (normal / new pump); null when only one pump was used. */
  fuel_92_pumps: Fuel92Pump[] | null;

  fuel_95_liters: number | null;
  fuel_95_price: number | null;
  fuel_95_total: number | null;

  premium_diesel_liters: number | null;
  premium_diesel_price: number | null;
  premium_diesel_total: number | null;

  pipa_amount: number | null;
  pipa_price: number | null;
  pipa_total: number | null;
  pipa_items: { product: string; containers: number; price: number; total: number }[] | null;
  jelly_can_items: { product: string; pieces: number; liters_per_can: number; total_liters: number; price: number; total: number }[] | null;
  /** How STM Daily recorded the Pipa + Jelly Can total being paid (newer shifts only). */
  pipa_jelly_payment: PipaJellyPayment | null;

  diesel_cash: number | null;
  diesel_price: number | null;

  expenses: number | null;
  expenses_breakdown: ExpenseItem[] | null;

  additional_cash_items: { name: string; amount: number }[] | null;
  additional_cash_total: number | null;
};

export const RED_FLAG_THRESHOLD = 10_000;

/** Pipa + Jelly Can: paid in full, partly paid (cash < total) or with extra paid in advance (cash > total). */
export type PipaJellyPayment = { mode: "full" | "partial" | "advance"; total: number; cash: number; note?: string };

function parsePipaJellyPayment(raw: unknown): PipaJellyPayment | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const mode = r.mode === "partial" || r.mode === "advance" ? r.mode : "full";
  const total = Number(r.total) || 0;
  const cash = Number(r.cash);
  return {
    mode, total, cash: Number.isFinite(cash) ? cash : total,
    ...(typeof r.note === "string" && r.note.trim() ? { note: r.note.trim() } : {}),
  };
}

/**
 * Cash the till should hold for Pipa + Jelly Can when their total is `total` —
 * same rule as STM Daily: everything, only what was received, or plus the advance.
 */
export function pipaJellyCash(total: number, pay: PipaJellyPayment | null): number {
  if (total <= 0) return 0;
  if (pay?.mode === "partial") return Math.min(total, Math.max(0, pay.cash));
  if (pay?.mode === "advance") return total + Math.max(0, pay.cash - pay.total);
  return total;
}

/** Grand total sales for a shift, including pipa & jelly can (for display/reporting). */
export function shiftTotalSales(shift: Shift): number {
  const jellyTotal = (shift.jelly_can_items ?? []).reduce((s, i) => s + i.total, 0);
  return (shift.fuel_92_total ?? 0) + (shift.fuel_95_total ?? 0)
    + (shift.premium_diesel_total ?? 0) + (shift.pipa_total ?? 0)
    + jellyTotal + (shift.diesel_cash ?? 0);
}
