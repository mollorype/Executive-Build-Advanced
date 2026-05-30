import { supabase, Shift, FuelPurchaseOrder, TABLES, COLS, mapRowToShift } from "./supabase";

export type ProductType = "92" | "95" | "PD" | "D" | "pipa";

type WorkingPO = FuelPurchaseOrder & { _volumeSold: number };

export type FIFORunResult = {
  success: boolean;
  error?: string;
  processedShifts: number;
  updatedPOs: number;
  failedPOs: number;
  failures: string[];
  productVolumes: Record<string, number>;
};

function shiftVolume(shift: Shift, product: ProductType): number {
  const fallback = (liters?: number | null, total?: number | null, price?: number | null) => {
    if (liters && liters > 0) return liters;
    if (total && price && price > 0) return total / price;
    return 0;
  };

  switch (product) {
    case "92":  return fallback(shift.fuel_92_liters, shift.fuel_92_total, shift.fuel_92_price);
    case "95":  return fallback(shift.fuel_95_liters, shift.fuel_95_total, shift.fuel_95_price);
    case "PD":  return fallback(shift.premium_diesel_liters, shift.premium_diesel_total, shift.premium_diesel_price);
    case "pipa": {
      let containers = shift.pipa_amount ?? 0;
      if (containers <= 0 && shift.pipa_total && shift.pipa_price && shift.pipa_price > 0) {
        containers = shift.pipa_total / shift.pipa_price;
      }
      return containers * 215;
    }
    case "D": {
      if (!shift.diesel_price || !shift.diesel_cash) return 0;
      return shift.diesel_cash / shift.diesel_price;
    }
  }
}

export async function runFIFOEngine(
  onProgress?: (msg: string) => void
): Promise<FIFORunResult> {
  const result: FIFORunResult = {
    success: false,
    processedShifts: 0,
    updatedPOs: 0,
    failedPOs: 0,
    failures: [],
    productVolumes: {},
  };

  try {
    onProgress?.("Fetching purchase orders…");
    const { data: posRaw, error: posErr } = await supabase
      .from("fuel_purchase_orders")
      .select("*")
      .order("created_at", { ascending: true });
    if (posErr) throw posErr;

    onProgress?.("Fetching shifts…");
    const { data: shiftsRaw, error: shiftErr } = await supabase
      .from(TABLES.SHIFTS)
      .select("*")
      .order(COLS.TIMESTAMP, { ascending: true });
    if (shiftErr) throw shiftErr;

    const pos: WorkingPO[] = (posRaw ?? []).map(p => ({
      ...p,
      remaining_volume: p.shortage_liters != null ? p.remaining_volume : p.initial_volume,
      status: p.shortage_liters != null
        ? "DONE"
        : (p.status === "ACTIVE" ? "ACTIVE" : "QUEUED"),
      _volumeSold: 0,
    }));

    const queues: Record<string, WorkingPO[]> = {};
    for (const po of pos) {
      (queues[po.product_type] ??= []).push(po);
    }

    for (const q of Object.values(queues)) {
      const userActives = q.filter(p => p.shortage_liters == null && p.status === "ACTIVE");
      if (userActives.length > 0) {
        const keep = userActives[0];
        for (const po of q) {
          if (po.shortage_liters != null) continue;
          po.status = po === keep ? "ACTIVE" : "QUEUED";
        }
      } else {
        const first = q.find(p => p.shortage_liters == null);
        if (first) first.status = "ACTIVE";
      }
    }

    const shifts = (shiftsRaw ?? []).map(r => mapRowToShift(r as Record<string, unknown>)) as Shift[];
    result.processedShifts = shifts.length;

    for (const shift of shifts) {
      for (const [product, queue] of Object.entries(queues)) {
        let liters = shiftVolume(shift, product as ProductType);
        if (!liters) continue;

        result.productVolumes[product] = (result.productVolumes[product] ?? 0) + liters;

        let idx = queue.findIndex(p => p.status === "ACTIVE");
        if (idx === -1) continue;

        while (liters > 0 && idx < queue.length) {
          const po = queue[idx];
          if (po.status !== "ACTIVE") break;

          const deduction = liters * po.calibration_factor;

          if (deduction >= po.remaining_volume) {
            const litersConsumed = po.remaining_volume / po.calibration_factor;
            po._volumeSold += litersConsumed;
            po.remaining_volume = 0;
            po.status = "DONE";
            liters -= litersConsumed;
            idx++;
            while (idx < queue.length && queue[idx].status === "DONE") idx++;
            if (idx < queue.length) queue[idx].status = "ACTIVE";
          } else {
            po.remaining_volume -= deduction;
            po._volumeSold += liters;
            if (po.remaining_volume < 10) {
              po.status = "DONE";
              po.remaining_volume = 0;
              idx++;
              while (idx < queue.length && queue[idx].status === "DONE") idx++;
              if (idx < queue.length) queue[idx].status = "ACTIVE";
            }
            liters = 0;
          }
        }
      }
    }

    onProgress?.("Writing results…");
    for (const po of pos) {
      if (po.shortage_liters != null) continue;

      const { data, error } = await supabase
        .from("fuel_purchase_orders")
        .update({
          remaining_volume: Math.max(0, po.remaining_volume),
          status: po.status,
          total_volume_sold: po._volumeSold,
        })
        .eq("id", po.id)
        .select();

      if (error) {
        result.failedPOs++;
        result.failures.push(`#${po.id.slice(0, 8)}: ${error.message}`);
      } else if (!data || data.length === 0) {
        result.failedPOs++;
        result.failures.push(`#${po.id.slice(0, 8)}: 0 rows written (Supabase RLS likely blocks UPDATE on fuel_purchase_orders for authenticated users)`);
      } else {
        result.updatedPOs++;
      }
    }

    onProgress?.("Done.");
    result.success = result.failedPOs === 0;
    return result;
  } catch (err: any) {
    result.error = err?.message ?? String(err);
    return result;
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
    retail_price_set: number;
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

export function calcNetProfit(po: FuelPurchaseOrder): number | null {
  if (
    !po.is_verified ||
    po.wholesale_price == null ||
    po.retail_price_set == null ||
    po.transportation_fees == null ||
    po.confidential_fees == null ||
    po.total_volume_sold == null
  ) return null;

  const vol = po.total_volume_sold;
  const shortage = po.shortage_liters ?? 0;
  const feesPerLiter = po.transportation_fees + po.confidential_fees;
  const grossRevenue = vol * po.retail_price_set;
  return grossRevenue - (vol * po.wholesale_price) - (feesPerLiter * (vol + shortage)) - (shortage * po.wholesale_price);
}
