import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { KeyRound, Loader2, RefreshCw } from "lucide-react";
import { makeT } from "@/lib/app-i18n";

const useT = makeT({
  unreachable: { en: "Couldn't reach the server. Check your connection and try again.", my: "server ကို မချိတ်နိုင်ပါ။ အင်တာနက် စစ်ပြီး ထပ်ကြိုးစားပါ။" },
  confirmReset: { en: "Reset the STM Daily password for {email}?\n\nThey'll be signed out and choose a new password the next time they sign in.", my: "{email} ၏ STM Daily password ကို ပြန်သတ်မှတ်မလား?\n\nထွက်သွားပြီး နောက်တစ်ကြိမ် ဝင်သည့်အခါ password အသစ် ရွေးရပါမည်။" },
  resetDone: { en: "{email} will choose a new password the next time they sign in.", my: "{email} နောက်တစ်ကြိမ် ဝင်သည့်အခါ password အသစ် ရွေးပါမည်။" },
  title: { en: "STM Daily passwords", my: "STM Daily password များ" },
  refresh: { en: "Refresh password list", my: "password စာရင်း ပြန်ဖွင့်ရန်" },
  help: { en: "Each employee chooses their own password the first time they sign in to STM Daily. You're told on Telegram whenever one is set.", my: "ဝန်ထမ်းတိုင်း STM Daily သို့ ပထမဆုံး ဝင်သည့်အခါ ကိုယ်ပိုင် password ရွေးပါသည်။ သတ်မှတ်တိုင်း Telegram မှ အသိပေးပါမည်။" },
  none: { en: "No employees on the list yet.", my: "စာရင်းတွင် ဝန်ထမ်း မရှိသေးပါ။" },
  portal: { en: "Uses their STM Financial password", my: "STM Financial password ကို သုံးသည်" },
  noPw: { en: "No password yet — they'll set one when they sign in", my: "password မရှိသေး — ဝင်သည့်အခါ သတ်မှတ်ပါမည်" },
  pwLast: { en: "Password set · last sign-in {date}", my: "password သတ်မှတ်ပြီး · နောက်ဆုံး ဝင်ချိန် {date}" },
  pwSet: { en: "Password set", my: "password သတ်မှတ်ပြီး" },
  reset: { en: "Reset", my: "ပြန်သတ်မှတ်ရန်" },
});

type StaffLogin = { email: string; has_login: boolean; last_sign_in: string | null; portal_login: boolean };

/** Calls the staff-auth Edge Function as the signed-in CEO, surfacing its own error text. */
async function callStaffAuth(body: Record<string, unknown>): Promise<{ logins?: StaffLogin[]; already?: boolean }> {
  const { data, error } = await supabase.functions.invoke("staff-auth", { body });
  if (error) {
    let message = "";   // empty → the screen shows its own (translated) message
    try {
      const b = await (error as { context?: Response }).context?.json();
      if (b?.error) message = b.error;
    } catch { /* keep the generic message */ }
    throw new Error(message);
  }
  return data ?? {};
}

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/**
 * STM Daily passwords on the Staff Access page: who has set one, and a reset
 * for anyone who forgot theirs (they choose a new one next time they sign in).
 * The staff-auth function re-checks that the caller is a CEO on every request.
 */
export default function StaffLoginsSection() {
  const t = useT();
  const [logins, setLogins] = useState<StaffLogin[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [resetting, setResetting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const { logins: list } = await callStaffAuth({ action: "logins" });
      setLogins(list ?? []);
      setError("");
    } catch (e) {
      setError((e as Error).message || t("unreachable"));
    } finally {
      setRefreshing(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  async function reset(email: string) {
    if (!window.confirm(t("confirmReset", { email }))) return;
    setResetting(email);
    setNotice("");
    try {
      await callStaffAuth({ action: "reset", email });
      setNotice(t("resetDone", { email }));
      await load();
    } catch (e) {
      setError((e as Error).message || t("unreachable"));
    } finally {
      setResetting(null);
    }
  }

  return (
    <div className="bg-white border border-slate-100 shadow-sm rounded-2xl overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-2">
        <span className="text-slate-900 font-semibold text-sm flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-slate-400" /> {t("title")}
        </span>
        <button onClick={load} disabled={refreshing} aria-label={t("refresh")} className="text-slate-400 hover:text-slate-600">
          <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
        </button>
      </div>
      <p className="px-6 pt-3 text-xs text-slate-500">
        {t("help")}
      </p>

      {notice && <p className="px-6 pt-3 text-sm text-pale-green-foreground font-medium">{notice}</p>}
      {error && <p role="alert" className="px-6 pt-3 text-sm text-pale-red-foreground">{error}</p>}

      {!logins ? (
        !error && <div className="px-6 py-8 text-center"><Loader2 className="w-5 h-5 text-slate-300 animate-spin mx-auto" /></div>
      ) : logins.length === 0 ? (
        <p className="px-6 py-6 text-sm text-slate-400">{t("none")}</p>
      ) : (
        <div className="divide-y divide-slate-100 mt-3">
          {logins.map(l => (
            <div key={l.email} className="px-6 py-3.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-slate-900 font-medium truncate">{l.email}</p>
                <p className="text-xs text-slate-400">
                  {l.portal_login ? t("portal")
                    : !l.has_login ? t("noPw")
                    : l.last_sign_in ? t("pwLast", { date: fmtDay(l.last_sign_in) })
                    : t("pwSet")}
                </p>
              </div>
              {l.has_login && !l.portal_login && (
                <button onClick={() => reset(l.email)} disabled={resetting !== null}
                  className="shrink-0 flex items-center gap-1.5 text-xs font-semibold text-slate-600 border border-slate-200 hover:border-red-200 hover:text-red-600 disabled:opacity-40 rounded-lg px-3 py-1.5">
                  {resetting === l.email && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {t("reset")}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
