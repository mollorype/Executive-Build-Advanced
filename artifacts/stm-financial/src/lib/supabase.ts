import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  import.meta.env.NEXT_PUBLIC_SUPABASE_URL ||
  import.meta.env.VITE_SUPABASE_URL ||
  "https://ryubjollofribrvrwqtz.supabase.co";

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
};

export function mapRowToShift(row: Record<string, unknown>): Shift {
  const fuel = (row[COLS.FUEL_DATA] as Record<string, number> | null) ?? {};
  const breakdownRaw = row[COLS.EXPENSES_BREAKDOWN];
  let expenses_breakdown: ExpenseItem[] | null = null;
  if (Array.isArray(breakdownRaw) && breakdownRaw.length > 0) {
    expenses_breakdown = (breakdownRaw as Array<{ name: string; amount: number }>)
      .filter(item => item && typeof item.name === "string")
      .map(item => ({ name: item.name, amount: Number(item.amount) || 0 }));
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
    fuel_92_liters: fuel.fuel_92_liters ?? null,
    fuel_92_price: fuel.fuel_92_price ?? null,
    fuel_92_total: fuel.fuel_92_total ?? null,
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
    diesel_cash: fuel.diesel_cash ?? null,
    diesel_price: fuel.diesel_price ?? null,
  };
}

export type Profile = {
  id: string;
  username: string;
  role: string;
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

  diesel_cash: number | null;
  diesel_price: number | null;

  expenses: number | null;
  expenses_breakdown: ExpenseItem[] | null;
};
