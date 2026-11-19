import { setDebtLang, tr, useDebtLang } from "@/lib/debt-i18n";

/** EN / မြ switch for the Debt Tracker. */
export default function DebtLangToggle() {
  const lang = useDebtLang();
  return (
    <div role="group" aria-label={tr(lang, "language")}
      className="flex items-center gap-0.5 bg-slate-100 border border-slate-200 rounded-lg p-0.5 shrink-0">
      {(["en", "my"] as const).map(l => (
        <button key={l} type="button" onClick={() => setDebtLang(l)} aria-pressed={lang === l}
          className={`text-xs font-bold rounded-md px-2 py-1 transition-colors ${lang === l ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
          {l === "en" ? "EN" : "မြ"}
        </button>
      ))}
    </div>
  );
}
