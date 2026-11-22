import { useEffect, useState } from "react";
import { BellRing, Check, Cylinder, Languages, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { makeT, setLang, useLang, type Lang } from "@/lib/app-i18n";
import { messageDialog, typeToConfirm } from "@/components/confirm-dialog";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { usePPSettings, type PPSettings } from "@/lib/pp-settings";

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
  ppTitle: { en: "P-P Ledger & profit", my: "P-P စာရင်း နှင့် အမြတ်" },
  ppHelp: { en: "Only owners can change these. They apply to everyone using the P-P Ledger.", my: "ပိုင်ရှင်သာ ပြောင်းနိုင်ပါသည်။ P-P စာရင်း သုံးသူအားလုံးအတွက် သက်ရောက်ပါသည်။" },
  ppSize: { en: "Default P-P size", my: "မူလ P-P အရွယ်အစား" },
  ppSizeHelp: { en: "Litres in one P-P, used for new entries and for P-P sold in shifts. Past entries keep their own size.", my: "P-P တစ်ခုရှိ လီတာ — အသစ်ထည့်သည့်အခါ နှင့် ဆိုင်းတွင် ရောင်းသော P-P အတွက် သုံးပါသည်။ အဟောင်းများ ၎င်းတို့၏ အရွယ်အစားအတိုင်း ကျန်ပါမည်။" },
  ppSizeSave: { en: "Save", my: "သိမ်းရန်" },
  ppSizeErr: { en: "Enter litres between 1 and 10,000.", my: "1 မှ 10,000 ကြား လီတာ ထည့်ပါ။" },
  autoDeduct: { en: "Deduct shifts automatically", my: "ဆိုင်းများကို အလိုအလျောက် နုတ်ရန်" },
  autoDeductHelp: { en: "Each shift's litres come off P-P stock as soon as it is submitted (and again if it is edited). Turn off to deduct by hand.", my: "ဆိုင်း တင်တာနဲ့ လီတာကို P-P လက်ကျန်မှ နုတ်ပါသည် (ပြင်လျှင်လည်း ပြန်နုတ်)။ လက်ဖြင့် နုတ်လိုပါက ပိတ်ပါ။" },
  seePrices: { en: "Managers and accountants see purchase prices", my: "မန်နေဂျာ နှင့် စာရင်းကိုင် ဝယ်စျေး မြင်ရမည်" },
  seePricesHelp: { en: "Off: they still record purchases with a price, but can't see prices afterwards. They never see sales money or profit.", my: "ပိတ်ထားလျှင်: ဝယ်စျေးနှင့် မှတ်နိုင်သော်လည်း နောက်ပိုင်း စျေး မမြင်ရပါ။ ရောင်းရငွေ နှင့် အမြတ်ကို ဘယ်တော့မှ မမြင်ရပါ။" },
  profitAuto: { en: "Profit page opens with", my: "အမြတ် စာမျက်နှာ ဖွင့်လျှင်" },
  pa_off: { en: "Nothing (calculate when I ask)", my: "ဘာမှမဟုတ် (တောင်းမှ တွက်)" },
  pa_week: { en: "This week, calculated", my: "ဤအပတ် တွက်ပြီး" },
  pa_month: { en: "This month, calculated", my: "ဤလ တွက်ပြီး" },
  report: { en: "Profit report on Telegram (owners)", my: "Telegram အမြတ် အစီရင်ခံစာ (ပိုင်ရှင်)" },
  reportHelp: { en: "Sent at 8:30 in the morning: weekly on Mondays for the week before, monthly on the 1st for the month before.", my: "နံနက် 8:30 တွင် ပို့ပါမည်: အပတ်စဉ် — တနင်္လာနေ့တွင် ပြီးခဲ့သည့်အပတ်၊ လစဉ် — ၁ ရက်နေ့တွင် ပြီးခဲ့သည့်လ။" },
  rp_off: { en: "Off", my: "ပိတ်" },
  rp_weekly: { en: "Weekly", my: "အပတ်စဉ်" },
  rp_monthly: { en: "Monthly", my: "လစဉ်" },
  ppMissing: { en: "Not set up in the database yet — run the pp_profit_engine SQL in the Supabase SQL Editor.", my: "Database တွင် မထည့်ရသေးပါ — Supabase SQL Editor တွင် pp_profit_engine SQL ကို run ပါ။" },
  ppSaved: { en: "Saved for everyone.", my: "အားလုံးအတွက် သိမ်းပြီး။" },
  resetTitle: { en: "Start over", my: "အစမှ ပြန်စရန်" },
  resetHelp: { en: "Deletes all P-P data: every purchase and official PO, stock count, lending and borrowing, shift deduction, and the Deleted list. Shift reports, stations and these settings stay.", my: "P-P ဒေတာ အားလုံး ဖျက်ပါမည်: အဝယ်နှင့် တရားဝင် PO အားလုံး၊ လက်ကျန်စစ်ချက်၊ ချေး/ငှား၊ ဆိုင်း နုတ်ချက်၊ ဖျက်ထားသည်များ စာရင်း။ ဆိုင်း စာရင်းများ၊ ဆိုင်/ဂိုဒေါင်များ နှင့် ဤဆက်တင်များ ကျန်ပါမည်။" },
  resetBtn: { en: "Delete all P-P data", my: "P-P ဒေတာ အားလုံး ဖျက်ရန်" },
  resetConfirm: {
    en: "Delete ALL P-P data and start over?\n\nEvery P-P line, purchase, official PO, stock count, lending / borrowing and shift deduction is removed, and the Deleted list is emptied. Profit for past days can't be worked out afterwards.\n\nShifts from before now won't be deducted. Count the stock right after this.\n\nType DELETE to confirm.",
    my: "P-P ဒေတာ အားလုံး ဖျက်ပြီး အစမှ ပြန်စမလား?\n\nP-P စာကြောင်း၊ အဝယ်၊ တရားဝင် PO၊ လက်ကျန်စစ်ချက်၊ ချေး/ငှား နှင့် ဆိုင်း နုတ်ချက် အားလုံး ပျက်ပြီး ဖျက်ထားသည်များ စာရင်းလည်း ရှင်းပါမည်။ ယခင်ရက်များ၏ အမြတ်ကို နောက်ပိုင်း တွက်၍ မရတော့ပါ။\n\nယခုမတိုင်မီ ဆိုင်းများကို မနုတ်တော့ပါ။ ဖျက်ပြီးတာနဲ့ လက်ကျန် ချက်ချင်း စစ်ပါ။\n\nအတည်ပြုရန် DELETE (သို့) ဖျက်မည် ဟု ရိုက်ပါ။",
  },
  resetGo: { en: "Delete everything", my: "အားလုံး ဖျက်မည်" },
  resetDone: {
    en: "All P-P data deleted ({lines} lines, {shifts} shift deductions).\n\nNext: P-P Ledger → Count stock. Enter what you have now and tick “Opening stock — enter the price paid” so profit is right from today.",
    my: "P-P ဒေတာ အားလုံး ဖျက်ပြီး (စာကြောင်း {lines}၊ ဆိုင်း နုတ်ချက် {shifts})။\n\nနောက်တစ်ဆင့်: P-P စာရင်း → လက်ကျန် စစ်ရန်။ ယခုရှိသည်ကို ထည့်ပြီး “စတင်လက်ကျန် — ဝယ်စျေး ထည့်ရန်” ကို ရွေးပါ — ယနေ့ကစ အမြတ် မှန်ပါမည်။",
  },
  resetLast: { en: "Last started over: {when}", my: "နောက်ဆုံး အစမှ ပြန်စခဲ့ချိန်: {when}" },
  resetMissing: { en: "This needs the latest database update — run the pp_reset SQL in the Supabase SQL Editor.", my: "နောက်ဆုံး database update လိုပါသည် — Supabase SQL Editor တွင် pp_reset SQL ကို run ပါ။" },
  resetFailed: { en: "Nothing was deleted: {e}", my: "ဘာမှ မဖျက်ရသေးပါ: {e}" },
});

type PPKey = "default_pp_liters" | "auto_deduct" | "managers_see_prices" | "profit_auto" | "profit_report";

/** Owner-only: P-P size, automatic deduction, price visibility, profit options (pp_settings). */
function PPSettingsSection() {
  const t = useT();
  const { settings, state, setSettings, reload } = usePPSettings();
  const [size, setSize] = useState("");
  const [saving, setSaving] = useState<PPKey | "reset" | null>(null);
  const [note, setNote] = useState("");
  useEffect(() => { if (state === "ready") setSize(String(settings.default_pp_liters)); }, [state, settings.default_pp_liters]);

  async function save<K extends PPKey>(key: K, value: PPSettings[K]) {
    setSaving(key); setNote("");
    const { data, error } = await supabase.from("pp_settings").update({ [key]: value }).eq("id", true).select("*");
    setSaving(null);
    if (error || !data?.length) { setNote(t("staffFailed")); return; }
    setSettings({ ...settings, ...(data[0] as Partial<PPSettings>), default_pp_liters: Number((data[0] as PPSettings).default_pp_liters) });
    setNote(t("ppSaved"));
  }
  function saveSize() {
    const v = parseFloat(size);
    if (!(v >= 1 && v <= 10000)) { setNote(t("ppSizeErr")); return; }
    save("default_pp_liters", v);
  }

  // Owners only — the database checks that again, and wants the exact phrase.
  async function resetAll() {
    setNote("");
    if (!(await typeToConfirm(t("resetConfirm"), ["DELETE", "ဖျက်မည်"], { confirmLabel: t("resetGo") }))) return;
    setSaving("reset");
    const { data, error } = await supabase.rpc("pp_reset_all", { p_confirm: "DELETE ALL P-P" });
    setSaving(null);
    if (error) {
      await messageDialog(error.code === "PGRST202" || error.code === "42883" ? t("resetMissing") : t("resetFailed", { e: error.message }));
      return;
    }
    const r = (data ?? {}) as { lines?: number; shift_deductions?: number };
    await reload();
    await messageDialog(t("resetDone", { lines: String(r.lines ?? 0), shifts: String(r.shift_deductions ?? 0) }));
  }

  const seg = (on: boolean) => `px-3 py-2 rounded-xl text-xs font-semibold border text-left transition-colors ${on ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-700 border-slate-200"}`;
  const toggle = (key: "auto_deduct" | "managers_see_prices", label: string, help: string) => (
    <label className="flex items-start gap-3 px-4 py-3 cursor-pointer">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-slate-900">{label}</span>
        <span className="block text-xs text-slate-500 mt-0.5">{help}</span>
      </span>
      {saving === key ? <Loader2 className="w-5 h-5 mt-0.5 text-slate-400 animate-spin shrink-0" />
        : <input type="checkbox" role="switch" checked={settings[key]} onChange={() => save(key, !settings[key])} disabled={!!saving}
            aria-label={label} className="mt-0.5 w-5 h-5 accent-blue-600 shrink-0" />}
    </label>
  );

  return (
    <section className="bg-white border border-slate-100 shadow-sm rounded-2xl overflow-hidden" data-testid="pp-settings">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
        <Cylinder className="w-4 h-4 text-pale-blue-foreground" />
        <h2 className="text-slate-900 font-semibold text-sm">{t("ppTitle")}</h2>
      </div>
      <div className="p-5 space-y-4">
        <p className="text-slate-500 text-xs">{t("ppHelp")}</p>
        {state === "loading" && <Loader2 className="w-5 h-5 text-slate-300 animate-spin" />}
        {state === "missing" && <p className="text-xs text-amber-700">{t("ppMissing")}</p>}
        {state === "ready" && (
          <>
            <div>
              <label htmlFor="pp-size" className="block text-sm font-semibold text-slate-900">{t("ppSize")}</label>
              <p className="text-xs text-slate-500 mt-0.5 mb-2">{t("ppSizeHelp")}</p>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input id="pp-size" type="number" inputMode="decimal" min="1" step="any" value={size} onChange={e => setSize(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl pl-3 pr-8 py-2 text-sm text-slate-900" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">L</span>
                </div>
                <button type="button" onClick={saveSize} disabled={!!saving || parseFloat(size) === settings.default_pp_liters}
                  className="shrink-0 bg-blue-600 disabled:opacity-50 text-white text-sm font-semibold rounded-xl px-4">
                  {saving === "default_pp_liters" ? <Loader2 className="w-4 h-4 animate-spin" /> : t("ppSizeSave")}
                </button>
              </div>
            </div>
            <div className="divide-y divide-slate-100 border border-slate-100 rounded-xl">
              {toggle("auto_deduct", t("autoDeduct"), t("autoDeductHelp"))}
              {toggle("managers_see_prices", t("seePrices"), t("seePricesHelp"))}
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900 mb-2">{t("profitAuto")}</p>
              <div className="grid gap-2" role="radiogroup" aria-label={t("profitAuto")}>
                {(["off", "week", "month"] as const).map(v => (
                  <button key={v} type="button" role="radio" aria-checked={settings.profit_auto === v} disabled={!!saving}
                    onClick={() => save("profit_auto", v)} className={seg(settings.profit_auto === v)}>{t(`pa_${v}`)}</button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">{t("report")}</p>
              <p className="text-xs text-slate-500 mt-0.5 mb-2">{t("reportHelp")}</p>
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t("report")}>
                {(["off", "weekly", "monthly"] as const).map(v => (
                  <button key={v} type="button" role="radio" aria-checked={settings.profit_report === v} disabled={!!saving}
                    onClick={() => save("profit_report", v)} className={`${seg(settings.profit_report === v)} text-center`}>{t(`rp_${v}`)}</button>
                ))}
              </div>
            </div>
            <div className="border border-red-200 bg-red-50/60 rounded-xl p-4" data-testid="pp-reset">
              <p className="flex items-center gap-2 text-sm font-semibold text-red-700"><RotateCcw className="w-4 h-4" /> {t("resetTitle")}</p>
              <p className="text-xs text-slate-600 mt-1">{t("resetHelp")}</p>
              {settings.reset_at && (
                <p className="text-[11px] text-slate-500 mt-1" data-testid="pp-reset-last">{t("resetLast", { when: new Date(settings.reset_at).toLocaleString("en-GB", { timeZone: "Asia/Yangon", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) })}</p>
              )}
              <button type="button" onClick={resetAll} disabled={!!saving} data-testid="pp-reset-btn"
                className="mt-3 w-full flex items-center justify-center gap-2 bg-white border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50 text-sm font-semibold rounded-xl px-4 py-2.5">
                {saving === "reset" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} {t("resetBtn")}
              </button>
            </div>
          </>
        )}
        {note && <p className="text-[11px] text-slate-500" role="status">{note}</p>}
      </div>
    </section>
  );
}

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
        {profile?.role === "ceo" && <PPSettingsSection />}
        {profile?.role === "ceo" && <StaffNotifications />}
      </div>
    </div>
  );
}
