import { Check, Languages } from "lucide-react";
import { makeT, setLang, useLang, type Lang } from "@/lib/app-i18n";

const useT = makeT({
  title: { en: "Settings", my: "ဆက်တင်" },
  subtitle: { en: "Preferences for STM Financial on this device", my: "ဤစက်ပေါ်ရှိ STM Financial အတွက် ရွေးချယ်မှုများ" },
  language: { en: "Language", my: "ဘာသာစကား" },
  languageHelp: { en: "Every page of STM Financial uses this language. Amounts, dates and names stay as they are.", my: "STM Financial စာမျက်နှာအားလုံး ဤဘာသာဖြင့် ပြပါမည်။ ငွေပမာဏ၊ ရက်စွဲ၊ အမည်များ မပြောင်းပါ။" },
  saved: { en: "Saved on this device.", my: "ဤစက်တွင် သိမ်းပြီး။" },
});

const OPTIONS: { id: Lang; label: string; sample: string }[] = [
  { id: "en", label: "English", sample: "Dashboard · Shifts · Salary" },
  { id: "my", label: "မြန်မာ", sample: "အကျဉ်းချုပ် · ဆိုင်းစာရင်းများ · လစာ" },
];

export default function SettingsPage() {
  const t = useT();
  const lang = useLang();
  return (
    <div className="flex-1 overflow-auto bg-slate-50">
      <div className="px-6 py-5 border-b border-slate-100 bg-white">
        <h1 className="text-2xl font-bold text-slate-900">{t("title")}</h1>
        <p className="text-slate-400 text-sm mt-0.5">{t("subtitle")}</p>
      </div>
      <div className="p-6 max-w-xl space-y-5">
        <section className="bg-white border border-slate-100 shadow-sm rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
            <Languages className="w-4 h-4 text-pale-blue-foreground" />
            <h2 className="text-slate-900 font-semibold text-sm">{t("language")}</h2>
          </div>
          <div className="p-5 space-y-3">
            <p className="text-slate-500 text-xs">{t("languageHelp")}</p>
            <div className="grid sm:grid-cols-2 gap-3" role="radiogroup" aria-label={t("language")}>
              {OPTIONS.map(o => {
                const on = lang === o.id;
                return (
                  <button key={o.id} type="button" role="radio" aria-checked={on} onClick={() => setLang(o.id)}
                    className={`text-left rounded-xl border-2 px-4 py-3 transition-colors ${on ? "border-blue-600 bg-blue-50" : "border-slate-200 hover:border-slate-300"}`}>
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-sm font-bold text-slate-900">{o.label}</span>
                      {on && <Check className="w-4 h-4 text-blue-600" />}
                    </span>
                    <span className="block text-xs text-slate-500 mt-1">{o.sample}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-slate-400" role="status">{t("saved")}</p>
          </div>
        </section>
      </div>
    </div>
  );
}
