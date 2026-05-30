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
    diesel_cash: number;
    diesel_price: number;
  };
  total_expenses: number;
  expenses_breakdown?: { name: string; amount: number }[];
  expected_total: number;
  actual_cash: number;
  variance: number;
}

export async function submitShift(payload: ShiftPayload) {
  const { error } = await supabase.from("daily_sales_reports").insert(payload);

  // Graceful fallback: if the expenses_breakdown column doesn't exist yet,
  // retry without it so the shift still saves.
  if (error && error.message?.includes("expenses_breakdown")) {
    const { expenses_breakdown: _omit, ...fallbackPayload } = payload;
    const { error: fallbackError } = await supabase
      .from("daily_sales_reports")
      .insert(fallbackPayload);
    return { error: fallbackError };
  }

  return { error };
}
