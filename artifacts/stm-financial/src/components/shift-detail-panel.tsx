import { X, User, Clock, Fuel, Receipt, BadgeDollarSign, AlertTriangle } from "lucide-react";
import { Shift } from "@/lib/supabase";

type Props = {
  shift: Shift;
  onClose: () => void;
};

function mmk(val: number | null | undefined) {
  if (val == null || val === 0) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(val) + " MMK";
}

function liters(val: number | null | undefined) {
  if (val == null) return "—";
  return val.toLocaleString() + " L";
}

function fmt0(val: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(val);
}

function pricePerLiter(total: number, totalLiters: number): string {
  if (!totalLiters) return "—";
  return `${fmt0(total / totalLiters)} MMK/L`;
}

// A Pipa container holds a fixed 215 L — matches the conversion used on the
// STM Daily submission form (Pipa entries only ever record container count,
// never liters directly), so receipts can derive Price/L consistently.
const PIPA_LITERS_PER_CONTAINER = 215;

function fuelProductLabel(code: string): string {
  return code === "92" ? "Fuel 92" : code === "95" ? "Fuel 95" : code === "PD" ? "Premium Diesel" : "Diesel";
}

type ItemizedEntry = {
  key: string | number;
  product: string;
  unitCount: number;
  unitNoun: string;
  litersPerUnit: number;
  totalLiters: number;
  unitPrice: number;
  unitPriceNoun: string;
  total: number;
};

function ItemizedBreakdown({ title, entries }: { title: string; entries: ItemizedEntry[] }) {
  if (entries.length === 0) return null;
  const grandTotal = entries.reduce((s, e) => s + e.total, 0);
  const grandLiters = entries.reduce((s, e) => s + e.totalLiters, 0);
  return (
    <div className="mt-3">
      <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-2 flex items-center gap-2">
        <span className="flex-1 h-px bg-slate-100 block" />
        {title}
        <span className="flex-1 h-px bg-slate-100 block" />
      </p>
      <div className="bg-slate-50 border border-slate-100 rounded-xl overflow-hidden">
        <div className="divide-y divide-slate-100">
          {entries.map(item => (
            <div key={item.key} className="px-4 py-3 flex items-start justify-between gap-3 text-sm">
              <div className="min-w-0">
                <span className="text-pale-blue-foreground font-semibold">{item.product}</span>
                <p className="text-slate-500 text-xs mt-0.5 tabular-nums">
                  {item.unitCount} {item.unitNoun} &nbsp;·&nbsp; {item.litersPerUnit.toLocaleString("en-US", { maximumFractionDigits: 1 })} L/{item.unitPriceNoun} &nbsp;·&nbsp; {item.totalLiters.toLocaleString("en-US", { maximumFractionDigits: 1 })} L total
                </p>
                <p className="text-slate-500 text-xs mt-0.5 tabular-nums">
                  {fmt0(item.unitPrice)} MMK/{item.unitPriceNoun} &nbsp;·&nbsp; <span className="text-slate-400">{pricePerLiter(item.total, item.totalLiters)}</span>
                </p>
              </div>
              <span className="text-pale-blue-foreground font-bold tabular-nums shrink-0">{fmt0(item.total)} MMK</span>
            </div>
          ))}
        </div>
        <div className="px-4 py-3 border-t border-slate-100 bg-white flex items-center justify-between text-sm">
          <span className="text-slate-500 font-semibold">Total {title.replace(" — Itemized", "")}</span>
          <div className="text-right">
            <span className="text-pale-blue-foreground font-bold tabular-nums block">{mmk(grandTotal)}</span>
            <span className="text-slate-400 text-xs tabular-nums">{pricePerLiter(grandTotal, grandLiters)} avg</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="w-6 h-6 rounded-md bg-slate-100 flex items-center justify-center text-slate-400">
        {icon}
      </div>
      <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">{label}</span>
    </div>
  );
}

type ProductRowProps = {
  label: string;
  litersVal?: number | null;
  price?: number | null;
  total?: number | null;
  isCashOnly?: boolean;
};

function ProductRow({ label, litersVal, price, total, isCashOnly }: ProductRowProps) {
  const hasAnyData = isCashOnly ? (total != null && total !== 0) : (litersVal != null || price != null || total != null);
  return (
    <div className={`rounded-lg border px-4 py-3 mb-2 last:mb-0 ${
      hasAnyData
        ? "bg-slate-50 border-slate-100"
        : "bg-slate-50/60 border-slate-100 opacity-50"
    }`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-slate-900 text-sm font-semibold">{label}</span>
        <span className={`font-bold text-sm tabular-nums ${hasAnyData ? "text-pale-blue-foreground" : "text-slate-400"}`}>
          {hasAnyData ? mmk(total) : "No data"}
        </span>
      </div>
      {!isCashOnly && (
        <div className="flex gap-5 text-xs text-slate-500 mt-0.5">
          <span>Qty: <span className="text-slate-700">{liters(litersVal)}</span></span>
          <span>Price: <span className="text-slate-700">{price != null ? mmk(price) + "/L" : "—"}</span></span>
        </div>
      )}
      {isCashOnly && hasAnyData && (
        <p className="text-xs text-slate-500 mt-0.5">Raw cash collected</p>
      )}
    </div>
  );
}

export default function ShiftDetailPanel({ shift, onClose }: Props) {
  const diff = shift.difference ?? 0;
  const isRedFlag = Math.abs(diff) >= 10_000;

  const submissionTime = shift.created_at
    ? new Date(shift.created_at).toLocaleString("en-US", {
        weekday: "long", year: "numeric", month: "long",
        day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
      })
    : "—";

  const hasBreakdown = Array.isArray(shift.expenses_breakdown) && shift.expenses_breakdown.length > 0;

  const pipaEntries: ItemizedEntry[] = Array.isArray(shift.pipa_items) && shift.pipa_items.length > 0
    ? shift.pipa_items.map((item, i) => ({
        key: i,
        product: fuelProductLabel(item.product),
        unitCount: item.containers,
        unitNoun: "containers",
        litersPerUnit: PIPA_LITERS_PER_CONTAINER,
        totalLiters: item.containers * PIPA_LITERS_PER_CONTAINER,
        unitPrice: item.price,
        unitPriceNoun: "pipa",
        total: item.total,
      }))
    // Older shifts recorded only the blended pipa_amount/price/total, with no per-product breakdown.
    : shift.pipa_amount
    ? [{
        key: "legacy",
        product: "Pipa",
        unitCount: shift.pipa_amount,
        unitNoun: "containers",
        litersPerUnit: PIPA_LITERS_PER_CONTAINER,
        totalLiters: shift.pipa_amount * PIPA_LITERS_PER_CONTAINER,
        unitPrice: shift.pipa_price ?? 0,
        unitPriceNoun: "pipa",
        total: shift.pipa_total ?? 0,
      }]
    : [];

  const jellyEntries: ItemizedEntry[] = (shift.jelly_can_items ?? []).map((item, i) => ({
    key: i,
    product: fuelProductLabel(item.product),
    unitCount: item.pieces,
    unitNoun: "cans",
    litersPerUnit: item.liters_per_can,
    totalLiters: item.total_liters,
    unitPrice: item.price,
    unitPriceNoun: "can",
    total: item.total,
  }));

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div className="relative w-full max-w-[490px] bg-white border-l border-slate-100 h-full overflow-y-auto shadow">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-start justify-between z-10">
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-widest font-semibold mb-1">Shift Receipt</p>
            <h2 className="text-slate-900 font-bold text-base font-mono">#{String(shift.id).slice(0, 8).toUpperCase()}</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close panel"
            className="text-slate-500 hover:text-slate-900 transition-colors p-1.5 rounded-lg hover:bg-slate-100 mt-0.5"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Red Flag Banner */}
          {isRedFlag && (
            <div className="flex items-start gap-3 bg-pale-red border border-red-100 rounded-xl px-4 py-3">
              <AlertTriangle className="w-5 h-5 text-pale-red-foreground shrink-0 mt-0.5" />
              <div>
                <p className="text-pale-red-foreground font-bold text-sm">Red Flag — Large Cash Discrepancy</p>
                <p className="text-pale-red-foreground/80 text-xs mt-0.5">
                  Difference of {mmk(Math.abs(diff))} exceeds the 10,000 MMK threshold.
                </p>
              </div>
            </div>
          )}

          {/* Submission Info */}
          <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 space-y-2.5">
            <SectionHeader icon={<Clock className="w-3.5 h-3.5" />} label="Submission Details" />
            <div className="flex justify-between text-sm">
              <span className="text-slate-400 flex items-center gap-1.5">
                <Clock className="w-3 h-3" /> Submitted
              </span>
              <span className="text-slate-900 font-medium text-right max-w-[55%] leading-snug">{submissionTime}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-400 flex items-center gap-1.5">
                <User className="w-3 h-3" /> Employee
              </span>
              <span className="text-slate-900 font-semibold">{shift.employee_username || "—"}</span>
            </div>
          </div>

          {/* Product Matrix */}
          <div>
            <SectionHeader icon={<Fuel className="w-3.5 h-3.5" />} label="Product Matrix" />
            <ProductRow
              label="Fuel 92"
              litersVal={shift.fuel_92_liters}
              price={shift.fuel_92_price}
              total={shift.fuel_92_total}
            />
            <ProductRow
              label="Fuel 95"
              litersVal={shift.fuel_95_liters}
              price={shift.fuel_95_price}
              total={shift.fuel_95_total}
            />
            <ProductRow
              label="Premium Diesel"
              litersVal={shift.premium_diesel_liters}
              price={shift.premium_diesel_price}
              total={shift.premium_diesel_total}
            />
            <ProductRow
              label="Diesel"
              total={shift.diesel_cash}
              isCashOnly
            />

            <ItemizedBreakdown title="Pipa — Itemized" entries={pipaEntries} />
            <ItemizedBreakdown title="Jelly Can — Itemized" entries={jellyEntries} />
          </div>

          {/* Operational Expenses */}
          <div>
            <SectionHeader icon={<Receipt className="w-3.5 h-3.5" />} label="Operational Expenses" />

            {hasBreakdown ? (
              <div className="bg-slate-50 border border-slate-100 rounded-xl overflow-hidden">
                {/* Itemized list */}
                <div className="divide-y divide-slate-100">
                  {shift.expenses_breakdown!.map((item, i) => (
                    <div key={i} className="px-4 py-3 flex items-center justify-between text-sm">
                      <span className="text-slate-700 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-pale-gold-foreground/70 shrink-0" />
                        {item.name}
                      </span>
                      <span className="text-pale-gold-foreground font-semibold tabular-nums">
                        {new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(item.amount)} MMK
                      </span>
                    </div>
                  ))}
                </div>
                {/* Total row */}
                <div className="px-4 py-3 border-t border-slate-100 bg-white flex justify-between text-sm">
                  <span className="text-slate-500 font-semibold">Total Expenses</span>
                  <span className="text-pale-gold-foreground font-bold tabular-nums">{mmk(shift.expenses)}</span>
                </div>
              </div>
            ) : (
              <div className="bg-slate-50 border border-slate-100 rounded-xl p-4">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Total Expenses</span>
                  <span className={`font-semibold tabular-nums ${shift.expenses ? "text-pale-gold-foreground" : "text-slate-400"}`}>
                    {shift.expenses ? mmk(shift.expenses) : "None recorded"}
                  </span>
                </div>
                {!shift.expenses && (
                  <p className="text-slate-600 text-xs mt-2">
                    No itemized breakdown — add an{" "}
                    <code className="text-slate-500">expenses_breakdown</code> JSONB column to your Supabase table to see line items here.
                  </p>
                )}
              </div>
            )}
          </div>


          {/* Cash Summary */}
          <div>
            <SectionHeader icon={<BadgeDollarSign className="w-3.5 h-3.5" />} label="Cash Summary" />
            <div className="bg-slate-50 border border-slate-100 rounded-xl overflow-hidden divide-y divide-slate-100">
              <div className="px-4 py-3 flex justify-between text-sm">
                <span className="text-slate-400">Expected Total</span>
                <span className="text-slate-900 font-medium tabular-nums">{mmk(shift.expected_cash_total)}</span>
              </div>
              <div className="px-4 py-3 flex justify-between text-sm">
                <span className="text-slate-400">Actual Collected</span>
                <span className="text-slate-900 font-semibold tabular-nums">{mmk(shift.actual_cash_collected)}</span>
              </div>
              <div className={`px-4 py-3 flex justify-between text-sm ${isRedFlag ? "bg-pale-red" : ""}`}>
                <span className={`font-bold ${isRedFlag ? "text-pale-red-foreground" : "text-slate-700"}`}>
                  Difference
                </span>
                <span className={`font-bold text-base tabular-nums ${
                  isRedFlag ? "text-pale-red-foreground" : diff >= 0 ? "text-pale-green-foreground" : "text-pale-gold-foreground"
                }`}>
                  {diff >= 0 ? "+" : ""}{mmk(diff)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
