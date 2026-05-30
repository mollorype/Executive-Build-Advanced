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

function SectionHeader({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="w-6 h-6 rounded-md bg-slate-700/60 flex items-center justify-center text-slate-400">
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
        ? "bg-slate-800/60 border-slate-700/40"
        : "bg-slate-900/30 border-slate-800/20 opacity-40"
    }`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-white text-sm font-semibold">{label}</span>
        <span className={`font-bold text-sm tabular-nums ${hasAnyData ? "text-blue-300" : "text-slate-600"}`}>
          {hasAnyData ? mmk(total) : "No data"}
        </span>
      </div>
      {!isCashOnly && (
        <div className="flex gap-5 text-xs text-slate-500 mt-0.5">
          <span>Qty: <span className="text-slate-300">{liters(litersVal)}</span></span>
          <span>Price: <span className="text-slate-300">{price != null ? mmk(price) + "/L" : "—"}</span></span>
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

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-[490px] bg-[#0f1623] border-l border-slate-700/50 h-full overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 bg-[#0f1623]/95 backdrop-blur border-b border-slate-700/50 px-6 py-4 flex items-start justify-between z-10">
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-widest font-semibold mb-1">Shift Receipt</p>
            <h2 className="text-white font-bold text-base font-mono">#{String(shift.id).slice(0, 8).toUpperCase()}</h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-slate-700/50 mt-0.5"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Red Flag Banner */}
          {isRedFlag && (
            <div className="flex items-start gap-3 bg-red-900/30 border border-red-700/50 rounded-xl px-4 py-3">
              <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-red-300 font-bold text-sm">Red Flag — Large Cash Discrepancy</p>
                <p className="text-red-400/70 text-xs mt-0.5">
                  Difference of {mmk(Math.abs(diff))} exceeds the 10,000 MMK threshold.
                </p>
              </div>
            </div>
          )}

          {/* Submission Info */}
          <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-4 space-y-2.5">
            <SectionHeader icon={<Clock className="w-3.5 h-3.5" />} label="Submission Details" />
            <div className="flex justify-between text-sm">
              <span className="text-slate-400 flex items-center gap-1.5">
                <Clock className="w-3 h-3" /> Submitted
              </span>
              <span className="text-white font-medium text-right max-w-[55%] leading-snug">{submissionTime}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-400 flex items-center gap-1.5">
                <User className="w-3 h-3" /> Employee
              </span>
              <span className="text-white font-semibold">{shift.employee_username || "—"}</span>
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
              label="Pipa"
              litersVal={shift.pipa_amount}
              price={shift.pipa_price}
              total={shift.pipa_total}
            />
            <ProductRow
              label="Diesel"
              total={shift.diesel_cash}
              isCashOnly
            />
          </div>

          {/* Operational Expenses */}
          <div>
            <SectionHeader icon={<Receipt className="w-3.5 h-3.5" />} label="Operational Expenses" />

            {hasBreakdown ? (
              <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl overflow-hidden">
                {/* Itemized list */}
                <div className="divide-y divide-slate-700/30">
                  {shift.expenses_breakdown!.map((item, i) => (
                    <div key={i} className="px-4 py-3 flex items-center justify-between text-sm">
                      <span className="text-slate-300 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500/70 shrink-0" />
                        {item.name}
                      </span>
                      <span className="text-amber-300 font-semibold tabular-nums">
                        {new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(item.amount)} MMK
                      </span>
                    </div>
                  ))}
                </div>
                {/* Total row */}
                <div className="px-4 py-3 border-t border-slate-700/50 bg-slate-800/60 flex justify-between text-sm">
                  <span className="text-slate-400 font-semibold">Total Deductions</span>
                  <span className="text-amber-400 font-bold tabular-nums">{mmk(shift.expenses)}</span>
                </div>
              </div>
            ) : (
              <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-4">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Total Deductions</span>
                  <span className={`font-semibold tabular-nums ${shift.expenses ? "text-amber-400" : "text-slate-600"}`}>
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
            <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl overflow-hidden divide-y divide-slate-700/30">
              <div className="px-4 py-3 flex justify-between text-sm">
                <span className="text-slate-400">Expected Total</span>
                <span className="text-white font-medium tabular-nums">{mmk(shift.expected_cash_total)}</span>
              </div>
              <div className="px-4 py-3 flex justify-between text-sm">
                <span className="text-slate-400">Actual Collected</span>
                <span className="text-white font-semibold tabular-nums">{mmk(shift.actual_cash_collected)}</span>
              </div>
              <div className={`px-4 py-3 flex justify-between text-sm ${isRedFlag ? "bg-red-900/25" : ""}`}>
                <span className={`font-bold ${isRedFlag ? "text-red-300" : "text-slate-300"}`}>
                  Difference
                </span>
                <span className={`font-bold text-base tabular-nums ${
                  isRedFlag ? "text-red-300" : diff >= 0 ? "text-emerald-400" : "text-amber-400"
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
