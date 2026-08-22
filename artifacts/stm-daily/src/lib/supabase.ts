import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  import.meta.env.NEXT_PUBLIC_SUPABASE_URL ||
  import.meta.env.VITE_SUPABASE_URL ||
  "https://ryubjollofribrvrwqtz.supabase.co";

const supabaseKey =
  import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "sb_publishable_gzut68hKDAV9cirHdk8bpw_O_yTUXZS";

export const supabase = createClient(supabaseUrl, supabaseKey);

export interface ShiftPayload {
  employee_name: string;
  employee_id: string;
  timestamp: string;
  fuel_data: {
    fuel_92_liters: number;
    fuel_92_price: number;
    fuel_92_total: number;
    fuel_95_liters: number;
    fuel_95_price: number;
    fuel_95_total: number;
    premium_diesel_liters: number;
    premium_diesel_price: number;
    premium_diesel_total: number;
    pipa_amount: number;
    pipa_price: number;
    pipa_total: number;
    pipa_items?: { product: string; containers: number; price: number; total: number }[];
    jelly_can_items?: { product: string; pieces: number; liters_per_can: number; total_liters: number; price: number; total: number }[];
    diesel_cash: number;
    diesel_price: number;
  };
  total_expenses: number;
  expenses_breakdown?: { name: string; amount: number }[];
  additional_cash_items?: { name: string; amount: number }[];
  additional_cash_total?: number;
  expected_total: number;
  actual_cash: number;
  variance: number;
  client_submission_id?: string;
}

// Columns that may not exist yet on older/unmigrated `daily_sales_reports`
// tables. If Supabase rejects the insert because one of these is missing,
// drop it and retry rather than leaving the shift stuck unsynced forever.
const OPTIONAL_COLUMNS = ["client_submission_id", "expenses_breakdown"] as const;

export async function submitShift(payload: ShiftPayload) {
  let attempt: Partial<ShiftPayload> = payload;

  for (let i = 0; i <= OPTIONAL_COLUMNS.length; i++) {
    const { error } = await supabase.from("daily_sales_reports").insert(attempt);
    if (!error) return { error: null };

    const missingColumn = OPTIONAL_COLUMNS.find(
      col => col in attempt && error.message?.includes(col)
    );
    if (!missingColumn) return { error };

    const { [missingColumn]: _omit, ...rest } = attempt;
    attempt = rest;
  }

  return { error: new Error("Unable to submit shift after removing optional columns") };
}
