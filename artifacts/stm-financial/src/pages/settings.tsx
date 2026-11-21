import { useEffect, useState } from "react";
import { BellRing, Check, Languages, Loader2 } from "lucide-react";
import { makeT, setLang, useLang, type Lang } from "@/lib/app-i18n";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";

const useT = makeT({
  title: { en: "Settings", my: "ဆက်တင်" },
  subtitle: { en: "Preferences for STM Financial on this device", my: "ဤစက်ပေါ်ရှိ STM Financial အတွက် ရွေးချယ်မှုများ" },
  language: { en: "Language", my: "ဘာသာစကား" },
  languageHelp: { en: "Every page of STM Financial uses this language. Amounts, dates and names stay as they are.", my: "STM Financial စာမျက်နှာအားလုံး ဤဘာသာဖြင့် ပြပါမည်။ ငွေပမာဏ၊ ရက်စွဲ၊ အမည်များ မပြောင်းပါ။" },
  saved: { en: "Saved on this device.", my: "ဤစက်တွင် သိမ်းပြီး။" },
  staffTitle: { en: "Employee Telegram notifications", my: "ဝန်ထမ်း Telegram အသိပေးချက်" },
  staffHelp: { en: "What STM Daily employees who connected Telegram are told. Only owners can change this; it applies to every employee.", my: "Telegram ချိတ်ထားသော STM Daily ဝန်ထမ်းများ ရရှိမည့် အသိပေးချက်များ။ ပိုင်ရှင်သာ ပြောင်းနိုင်ပြီး ဝန်ထမ်းအားလုံးအတွက် သက်ရောက်ပါသည်။" },
  n_salary_paid: { en: "Salary paid", my: "လစာ ပေးပြီး" },
  n_salary_paid_d: { en: "When their month's salary is marked paid, with the breakdown.", my: "လစာ ပေးပြီးဟု မှတ်သည့်အခါ အသေးစိတ်နှင့်တကွ။" },
  n_salary_item: { en: "Salary changes", my: "လစာ ပြောင်းလဲမှု" },
  n_salary_item_d: { en: "A deduction, overtime, bonus or paid-back amount added to their salary.", my: "လစာမှ နုတ်ခြင်း၊ အချိန်ပိုကြေး၊ ဆုကြေး သို့မဟုတ် ပြန်ပေးငွေ ထည့်သည့်အခါ။" },
  n_emergency: { en: "Emergency alerts", my: "အရေးပေါ် သတိပေးချက်" },
  n_emergency_d: { en: "Someone raised an emergency in the team chat.", my: "အဖွဲ့ Chat တွင် အရေးပေါ် သတိပေးသည့်အခါ။" },
  n_chat_message: { en: "Team chat messages", my: "အဖွဲ့ Chat စာများ" },
  n_chat_message_d: { en: "Who sent a message — never the message itself. Each employee can still switch it off.", my: "ပို့သူကိုသာ — စာကို မပြပါ။ ဝန်ထမ်းတစ်ဦးချင်း ပိတ်နိုင်ပါသည်။" },
  n_leave_decided: { en: "Leave decisions", my: "ခွင့် အဖြေ" },
  n_leave_decided_d: { en: "Their leave request was approved or declined.", my: "ခွင့်တောင်းခံမှုကို ခွင့်ပြု/မပြုသည့်အခါ။" },
  staffSaved: { en: "Saved for every employee.", my: "ဝန်ထမ်းအားလုံးအတွက် သိမ်းပြီး။" },
  staffChanged: { en: "Last changed {when} by {who}", my: "နောက်ဆုံး ပြောင်းချိန် {when} · {who}" },
  staffMissing: { en: "Not set up in the database yet — run the staff_notify_settings SQL in the Supabase SQL Editor.", my: "Database တွင် မထည့်ရသေးပါ — Supabase SQL Editor တွင် staff_notify_settings SQL ကို run ပါ။" },
  staffFailed: { en: "Couldn't save — refresh and try again.", my: "မသိမ်းနိုင်ပါ — ပြန်ဖွင့်ပြီး ထပ်ကြိုးစားပါ။" },
});

const NOTICES = ["salary_paid", "salary_item", "emergency", "chat_message", "leave_decided"] as const;
type Notice = (typeof NOTICES)[number];
type NotifySettings = Record<Notice, boolean> & { updated_at: string | null; updated_by: string | null };

/** Owner-only: which Telegram notices STM Daily employees get (staff_notify_settings). */
function StaffNotifications() {
  const t = useT();
  const [cfg, setCfg] = useState<NotifySettings | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [saving, setSaving] = useState<Notice | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    supabase.from("staff_notify_settings").select("*").maybeSingle().then(({ data, error }) => {
      if (error) { setState(error.code === "PGRST205" || error.code === "42P01" ? "missing" : "error"); return; }
      if (!data) { setState("missing"); return; }
      setCfg(data as NotifySettings); setState("ready");
    });
  }, []);

  async function toggle(key: Notice) {
    if (!cfg) return;
    const on = !cfg[key];
    setSaving(key); setNote("");
    const { data, error } = await supabase.from("staff_notify_settings").update({ [key]: on }).eq("id", true).select("*");
    setSaving(null);
    if (error || !data?.length) { setNote(t("staffFailed")); return; }
    setCfg(data[0] as NotifySettings);
    setNote(t("staffSaved"));
  }

  return (
    <section className="bg-white border border-slate-100 shadow-sm rounded-2xl overflow-hidden" data-testid="staff-notify">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
        <BellRing className="w-4 h-4 text-pale-blue-foreground" />
        <h2 className="text-slate-900 font-semibold text-sm">{t("staffTitle")}</h2>
      </div>
      <div className="p-5 space-y-3">
        <p className="text-slate-500 text-xs">{t("staffHelp")}</p>
        {state === "loading" && <Loader2 className="w-5 h-5 text-slate-300 animate-spin" />}
        {(state === "missing" || state === "error") && <p className="text-xs text-amber-700">{state === "missing" ? t("staffMissing") : t("staffFailed")}</p>}
        {cfg && (
          <ul className="divide-y divide-slate-100 border border-slate-100 rounded-xl">
            {NOTICES.map(key => (
              <li key={key}>
                <label className="flex items-start gap-3 px-4 py-3 cursor-pointer">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-slate-900">{t(`n_${key}`)}</span>
                    <span className="block text-xs text-slate-500 mt-0.5">{t(`n_${key}_d`)}</span>
                  </span>
                  {saving === key
                    ? <Loader2 className="w-5 h-5 mt-0.5 text-slate-400 animate-spin shrink-0" />
                    : <input type="checkbox" role="switch" checked={cfg[key]} onChange={() => toggle(key)} disabled={!!saving}
                        aria-label={t(`n_${key}`)} className="mt-0.5 w-5 h-5 accent-blue-600 shrink-0" />}
                </label>
              </li>
            ))}
          </ul>
        )}
        {cfg?.updated_by && cfg.updated_at && (
          <p className="text-[11px] text-slate-400">{t("staffChanged", { when: new Date(cfg.updated_at).toLocaleString("en-GB", { timeZone: "Asia/Yangon", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }), who: cfg.updated_by })}</p>
        )}
        {note && <p className="text-[11px] text-slate-500" role="status">{note}</p>}
      </div>
    </section>
  );
}

const OPTIONS: { id: Lang; label: string; sample: string }[] = [
  { id: "en", label: "English", sample: "Dashboard · Shifts · Salary" },
  { id: "my", label: "မြန်မာ", sample: "အကျဉ်းချုပ် · ဆိုင်းစာရင်းများ · လစာ" },
];

export default function SettingsPage() {
  const t = useT();
  const lang = useLang();
  const { profile } = useAuth();
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
        {profile?.role === "ceo" && <StaffNotifications />}
      </div>
    </div>
  );
}
