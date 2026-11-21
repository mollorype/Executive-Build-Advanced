import { useMemo, useState } from "react";
import { X, Download, Loader2, FileSpreadsheet } from "lucide-react";
import { useDebtLang } from "@/lib/debt-i18n";
import { useSalaryT, type SalaryKey } from "@/lib/salary-i18n";
import { monthKey, monthLabel, monthsBetween, presetRange, type RangePreset } from "@/lib/salary-math";
import { exportSalariesExcel } from "@/lib/salary-export";

const PRESETS: { id: RangePreset; key: SalaryKey }[] = [
  { id: "this", key: "presetThis" },
  { id: "last", key: "presetLast" },
  { id: "last3", key: "presetLast3" },
  { id: "last6", key: "presetLast6" },
  { id: "year", key: "presetYear" },
  { id: "custom", key: "presetCustom" },
];

/** Salary history to Excel — all employees, month by month. Defaults to this month. */
export default function SalaryExportDialog({ onClose }: { onClose: () => void }) {
  const t = useSalaryT();
  const lang = useDebtLang();
  const [preset, setPreset] = useState<RangePreset>("this");
  const [from, setFrom] = useState(() => monthKey().slice(0, 7));
  const [to, setTo] = useState(() => monthKey().slice(0, 7));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const range = useMemo(() => {
    if (preset !== "custom") return presetRange(preset);
    const f = `${from || to}-01`, tt = `${to || from}-01`;
    return f <= tt ? { from: f, to: tt } : { from: tt, to: f };
  }, [preset, from, to]);
  const months = monthsBetween(range.from, range.to);
  const label = range.from === range.to ? monthLabel(range.from, lang) : `${monthLabel(range.from, lang)} – ${monthLabel(range.to, lang)}`;

  async function download() {
    setBusy(true);
    setError("");
    try {
      await exportSalariesExcel(range.from, range.to);
    } catch {
      setError(t("exportFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
      <div className="absolute inset-0 bg-black/60" onClick={() => !busy && onClose()} />
      <div role="dialog" aria-modal="true" aria-labelledby="sal-export-title" className="relative w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="sal-export-title" className="text-slate-900 font-bold text-base flex items-center gap-2"><FileSpreadsheet className="w-4 h-4 text-emerald-600" /> {t("exportTitle")}</h2>
            <p className="text-slate-500 text-xs mt-1">{t("exportHelp")}</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label={t("close")} className="p-1.5 -m-1.5 rounded-lg text-slate-500 hover:bg-slate-100"><X className="w-5 h-5" /></button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5" role="radiogroup" aria-label={t("exportTitle")}>
          {PRESETS.map(p => (
            <button key={p.id} type="button" role="radio" aria-checked={preset === p.id} onClick={() => setPreset(p.id)}
              className={`text-xs font-semibold rounded-lg px-2 py-2 border transition-colors ${preset === p.id ? "bg-blue-600 border-blue-600 text-white" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}>
              {t(p.key)}
            </button>
          ))}
        </div>

        {preset === "custom" && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="sal-exp-from" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">{t("fromMonth")}</label>
              <input id="sal-exp-from" type="month" value={from} onChange={e => setFrom(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-300/50" />
            </div>
            <div>
              <label htmlFor="sal-exp-to" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">{t("toMonth")}</label>
              <input id="sal-exp-to" type="month" value={to} onChange={e => setTo(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-300/50" />
            </div>
          </div>
        )}

        <p className="text-sm text-slate-700 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2.5" data-testid="sal-export-range">
          {t("monthsN", { n: months.length, range: label })}
        </p>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <button type="button" onClick={download} disabled={busy}
          className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold rounded-xl py-3 text-sm">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} {busy ? t("preparing") : t("download")}
        </button>
        {lang === "my" && <p className="text-[11px] text-slate-400 text-center">{t("excelEnglish")}</p>}
      </div>
    </div>
  );
}
