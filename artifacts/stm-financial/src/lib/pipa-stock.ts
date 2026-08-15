export const PIPA_STOCK_TABLE = "pipa_stock";

/** A Pipa container holds a fixed 215 L — matches the conversion used on the
 * STM Daily submission form and the Shift Receipt's Pipa breakdown. */
export const PIPA_LITERS_PER_CONTAINER = 215;

export type PipaProductType = "92" | "95" | "PD" | "D";

export const PIPA_PRODUCT_TYPES: PipaProductType[] = ["92", "95", "PD", "D"];

export const PIPA_PRODUCT_LABELS: Record<PipaProductType, string> = {
  "92": "Fuel 92", "95": "Fuel 95", "PD": "Premium Diesel", "D": "Diesel",
};

export type PipaStockRow = {
  id: string;
  product_type: PipaProductType;
  remaining_containers: number;
  wholesale_assignment: string | null;
  updated_at: string;
};

export function pipaTotalLiters(containers: number): number {
  return containers * PIPA_LITERS_PER_CONTAINER;
}

export const PIPA_STOCK_SETUP_SQL = `-- Run this once in your Supabase SQL Editor:
CREATE TABLE IF NOT EXISTS pipa_stock (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  product_type text UNIQUE NOT NULL,
  remaining_containers integer NOT NULL DEFAULT 0,
  wholesale_assignment text,
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE pipa_stock ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read" ON pipa_stock FOR SELECT TO anon USING (true);
CREATE POLICY "auth_manage" ON pipa_stock FOR ALL TO authenticated USING (true);`;
