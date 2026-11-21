import { supabase, Shift } from "./supabase";

export type ProductType = "92" | "95" | "PD" | "D" | "pipa";

function pipaLitersForProduct(shift: Shift, product: string): number {
  if (!Array.isArray(shift.pipa_items) || shift.pipa_items.length === 0) return 0;
  return shift.pipa_items
    .filter(item => item.product === product)
    .reduce((sum, item) => sum + (item.containers ?? 0) * 215, 0);
}

function jellyCanLitersForProduct(shift: Shift, product: string): number {
  if (!Array.isArray(shift.jelly_can_items) || shift.jelly_can_items.length === 0) return 0;
  return shift.jelly_can_items
    .filter(item => item.product === product)
    .reduce((sum, item) => sum + (item.total_liters ?? 0), 0);
}

/** Litres of `product` a shift sold: pump sales + whole pipas sold + jelly cans.
 * Exported so the Pipa Ledger's "Deduct shift sales" uses the exact same count. */
export function shiftVolume(shift: Shift, product: ProductType): number {
  const fallback = (liters?: number | null, total?: number | null, price?: number | null) => {
    if (liters && liters > 0) return liters;
    if (total && price && price > 0) return total / price;
    return 0;
  };

  switch (product) {
    case "92":
      return fallback(shift.fuel_92_liters, shift.fuel_92_total, shift.fuel_92_price)
           + pipaLitersForProduct(shift, "92")
           + jellyCanLitersForProduct(shift, "92");
    case "95":
      return fallback(shift.fuel_95_liters, shift.fuel_95_total, shift.fuel_95_price)
           + pipaLitersForProduct(shift, "95")
           + jellyCanLitersForProduct(shift, "95");
    case "PD":
      return fallback(shift.premium_diesel_liters, shift.premium_diesel_total, shift.premium_diesel_price)
           + pipaLitersForProduct(shift, "PD")
           + jellyCanLitersForProduct(shift, "PD");
    case "D": {
      const direct = (shift.diesel_price && shift.diesel_cash)
        ? shift.diesel_cash / shift.diesel_price : 0;
      return direct + pipaLitersForProduct(shift, "D") + jellyCanLitersForProduct(shift, "D");
    }
    case "pipa": {
      // Only count old-style pipa_amount if no pipa_items exist (backward compat)
      if (Array.isArray(shift.pipa_items) && shift.pipa_items.length > 0) return 0;
      let containers = shift.pipa_amount ?? 0;
      if (containers <= 0 && shift.pipa_total && shift.pipa_price && shift.pipa_price > 0) {
        containers = shift.pipa_total / shift.pipa_price;
      }
      return containers * 215;
    }
  }
}

export async function forceClosePO(
  poId: string,
  physicalLiters: number,
  expectedRemaining: number
): Promise<{ success: boolean; error?: string }> {
  const shortage = Math.max(0, expectedRemaining - physicalLiters);
  const { data, error } = await supabase
    .from("fuel_purchase_orders")
    .update({ status: "DONE", shortage_liters: shortage, remaining_volume: physicalLiters })
    .eq("id", poId)
    .select();
  if (error) return { success: false, error: error.message };
  if (!data || data.length === 0) {
    return { success: false, error: "Update wrote 0 rows — check Supabase RLS UPDATE policy on fuel_purchase_orders." };
  }
  return { success: true };
}

export async function verifyPO(
  poId: string,
  costs: {
    wholesale_price: number;
    transportation_fees: number;
    confidential_fees: number;
  }
): Promise<{ success: boolean; error?: string }> {
  const { data, error } = await supabase
    .from("fuel_purchase_orders")
    .update({ ...costs, is_verified: true })
    .eq("id", poId)
    .select();
  if (error) return { success: false, error: error.message };
  if (!data || data.length === 0) {
    return { success: false, error: "Update wrote 0 rows — check Supabase RLS UPDATE policy on fuel_purchase_orders." };
  }
  return { success: true };
}
