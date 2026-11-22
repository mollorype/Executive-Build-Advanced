import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  import.meta.env.NEXT_PUBLIC_SUPABASE_URL ||
  import.meta.env.VITE_SUPABASE_URL ||
  "https://api.shwethazinmoe.site";

const supabaseKey =
  import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "sb_publishable_gzut68hKDAV9cirHdk8bpw_O_yTUXZS";

export const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Staff sign-in (password) — used for the team chat and for checking who is
 * signed in. Kept separate from `supabase` above, which stays signed out so
 * shift submission and the offline queue keep working exactly as before.
 */
export const AUTH_STORAGE_KEY = "stm-daily-auth";
export const authClient = createClient(supabaseUrl, supabaseKey, {
  auth: { storageKey: AUTH_STORAGE_KEY, persistSession: true, autoRefreshToken: true },
});

/** The signed-in staff member saved on this device, read straight from storage so it works offline. */
export function storedStaffUser(): { id: string; email: string } | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    const s = raw ? JSON.parse(raw) : null;
    const id = s?.user?.id;
    const email = s?.user?.email;
    return s?.refresh_token && typeof id === "string" && typeof email === "string" ? { id, email: email.toLowerCase() } : null;
  } catch {
    return null;
  }
}

export type StaffLoginState = "not_allowed" | "needs_password" | "has_password";

/** Calls the staff-auth Edge Function, surfacing its own error text. Retries once on a server hiccup. */
export async function staffAuth<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const { data, error } = await authClient.functions.invoke("staff-auth", { body });
    if (!error) return (data ?? {}) as T;
    const ctx = (error as { context?: unknown }).context;
    const res = typeof Response !== "undefined" && ctx instanceof Response ? ctx : undefined;   // no Response = never reached the server
    let message = "";
    try { message = (await res?.json())?.error ?? ""; } catch { /* not JSON */ }
    if (attempt === 0 && (!res || res.status >= 500)) continue;
    if (!res) throw new Error("No internet connection. Connect and try again.");
    throw new Error(message || "Something went wrong. Try again.");
  }
}

export interface ShiftPayload {
  employee_name: string;
  employee_id: string;
  timestamp: string;
  fuel_data: {
    fuel_92_liters: number;
    fuel_92_price: number;
    fuel_92_total: number;
    /** Per-pump split, present only when the "new pump" was used. The fuel_92_* fields above stay the combined totals. */
    fuel_92_pumps?: { pump: "normal" | "new"; liters: number; price: number; total: number }[];
    fuel_95_liters: number;
    fuel_95_price: number;
    fuel_95_total: number;
    premium_diesel_liters: number;
    premium_diesel_price: number;
    premium_diesel_total: number;
    pipa_amount: number;
    pipa_price: number;
    pipa_total: number;
    pipa_items?: { product: string; containers: number; liters_per_pipa?: number; price: number; total: number }[];
    jelly_can_items?: { product: string; pieces: number; liters_per_can: number; total_liters: number; price: number; total: number }[];
    /** How the Pipa + Jelly Can total was paid; `cash` is what the till holds for it. Present when there was any. */
    pipa_jelly_payment?: { mode: "full" | "partial" | "advance"; total: number; cash: number; note?: string };
    diesel_cash: number;
    diesel_price: number;
  };
  total_expenses: number;
  expenses_breakdown?: { name: string; amount: number; note?: string }[];
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
