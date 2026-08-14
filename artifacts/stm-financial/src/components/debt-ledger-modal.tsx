import { useState, useEffect, useMemo } from "react";
import { supabase, DebtProfile, DebtTransaction, DEBT_TABLES, mmkFmt, getDisplayPhones } from "@/lib/debt-supabase";
import { buildLedger, exportLedgerExcel } from "@/lib/ledger";
import { X, Download, Loader2, FileSpreadsheet, Calendar } from "lucide-react";

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function DebtLedgerModal({ profile, onClose }: { profile: DebtProfile; onClose: () => void }) {
  const [transactions, setTransactions] = useState<DebtTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(profile.date || todayStr());
  const [to, setTo] = useState(todayStr());
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from(DEBT_TABLES.TRANSACTIONS)
        .select("*")
        .eq("profile_id", profile.id)
        .order("date", { ascending: true });
      if (!cancelled) {
        setTransactions((data ?? []) as DebtTransaction[]);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [profile.id]);

  const phones = getDisplayPhones(profile);
  const ledger = useMemo(() => buildLedger(transactions, from || null, to || null), [transactions, from, to]);

  async function handleExport() {
    setExporting(true);
    try {
      await exportLedgerExcel(profile, phones, from, to, ledger);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-white border border-slate-100 rounded-xl w-full max-w-3xl shadow max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-pale-blue flex items-center justify-center shrink-0">
              <FileSpreadsheet className="w-4 h-4 text-pale-blue-foreground" />
            </div>
            <div>
              <p className="text-slate-900 font-bold text-sm">Debtors Ledger</p>
              <p className="text-slate-400 text-xs mt-0.5">{profile.name}{phones.length > 0 ? ` · ${phones.join(", ")}` : ""}</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-slate-500 hover:text-slate-900 p-1.5 rounded-lg hover:bg-slate-100 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Date range */}
        <div className="px-6 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2 shrink-0">
          <Calendar className="w-4 h-4 text-slate-500 shrink-0" />
          <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider mr-1">Period:</span>
          <input
            type="date"
            value={from}
            onChange={e => setFrom(e.target.value)}
            aria-label="From date"
            className="bg-white border border-slate-100 text-slate-900 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <span className="text-slate-500 text-xs">→</span>
          <input
            type="date"
            value={to}
            onChange={e => setTo(e.target.value)}
            aria-label="To date"
            className="bg-white border border-slate-100 text-slate-900 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            onClick={handleExport}
            disabled={exporting || loading}
            className="ml-auto flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-xs rounded-lg px-3.5 py-2 transition-all"
          >
            {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            {exporting ? "Preparing…" : "Download Excel"}
          </button>
        </div>

        {/* Preview */}
        <div className="flex-1 overflow-auto p-6">
          {loading ? (
            <div className="py-16 text-center">
              <Loader2 className="w-6 h-6 text-blue-500/50 animate-spin mx-auto mb-3" />
              <p className="text-slate-500 text-sm">Loading transactions…</p>
            </div>
          ) : (
            <div className="bg-white rounded-lg overflow-hidden">
              <div className="px-5 py-4 text-center border-b border-slate-200">
                <p className="text-slate-900 font-bold text-base tracking-wide">DEBTORS LEDGER</p>
                <p className="text-slate-500 text-xs mt-0.5">STM Financial</p>
              </div>
              <div className="px-5 py-3 grid grid-cols-3 gap-3 text-xs border-b border-slate-200">
                <div>
                  <p className="text-slate-500 font-semibold">Customer Name</p>
                  <p className="text-slate-900 font-medium mt-0.5">{profile.name}</p>
                </div>
                <div>
                  <p className="text-slate-500 font-semibold">Phone Number</p>
                  <p className="text-slate-900 font-medium mt-0.5">{phones.length > 0 ? phones.join(", ") : "—"}</p>
                </div>
                <div>
                  <p className="text-slate-500 font-semibold">Statement Period</p>
                  <p className="text-slate-900 font-medium mt-0.5">{from} to {to}</p>
                </div>
              </div>

              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-white text-slate-900">
                    <th className="px-3 py-2.5 text-left font-semibold">Date</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Description</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Debit (MMK)</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Credit (MMK)</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Running Balance (MMK)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  <tr className="italic text-slate-500 bg-slate-50">
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2">Opening Balance</td>
                    <td className="px-3 py-2 text-right" />
                    <td className="px-3 py-2 text-right" />
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{mmkFmt(ledger.openingBalance)}</td>
                  </tr>
                  {ledger.rows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center text-slate-400 italic">No transactions in this period</td>
                    </tr>
                  ) : (
                    ledger.rows.map((r, i) => (
                      <tr key={i} className="text-slate-800">
                        <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                          {new Date(r.date).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}
                        </td>
                        <td className="px-3 py-2">{r.description}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-red-600">{r.debit ? mmkFmt(r.debit) : ""}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-emerald-600">{r.credit ? mmkFmt(r.credit) : ""}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium">{mmkFmt(r.balance)}</td>
                      </tr>
                    ))
                  )}
                  <tr className="italic text-slate-500 bg-slate-50">
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2">Period Totals</td>
                    <td className="px-3 py-2 text-right tabular-nums text-red-600">{ledger.totalDebit ? mmkFmt(ledger.totalDebit) : ""}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-600">{ledger.totalCredit ? mmkFmt(ledger.totalCredit) : ""}</td>
                    <td className="px-3 py-2 text-right" />
                  </tr>
                </tbody>
                <tfoot>
                  <tr className="bg-slate-100 font-bold text-slate-900 border-t-2 border-slate-800">
                    <td className="px-3 py-2.5" colSpan={4}>Closing Balance</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{mmkFmt(ledger.closingBalance)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
