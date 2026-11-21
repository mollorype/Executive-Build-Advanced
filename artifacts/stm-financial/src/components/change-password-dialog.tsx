import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { CheckCircle, Eye, EyeOff, KeyRound, Loader2, X } from "lucide-react";
import { makeT, tr, useLang, type Lang } from "@/lib/app-i18n";

const S = {
  samePw: { en: "The new password must be different from the current one.", my: "စကားဝှက်အသစ်သည် လက်ရှိနှင့် မတူရပါ။" },
  weakPw: { en: "That password is too weak. Use a longer one with letters and numbers.", my: "စကားဝှက် အားနည်းနေသည်။ စာလုံးနှင့် ဂဏန်းပါ ပိုရှည်သည်ကို သုံးပါ။" },
  reauth: { en: "For security, sign out and sign back in, then try again.", my: "လုံခြုံရေးအတွက် ထွက်ပြီး ပြန်ဝင်ကာ ထပ်ကြိုးစားပါ။" },
  notSignedIn: { en: "You're not signed in.", my: "ဝင်ထားခြင်း မရှိပါ။" },
  tooShort: { en: "The new password must be at least {n} characters.", my: "စကားဝှက်အသစ်သည် အနည်းဆုံး {n} လုံး ရှိရမည်။" },
  noMatch: { en: "The new passwords don't match.", my: "စကားဝှက်အသစ် နှစ်ခု မတူပါ။" },
  wrongCurrent: { en: "Your current password is incorrect.", my: "လက်ရှိ စကားဝှက် မှားနေသည်။" },
  title: { en: "Change password", my: "စကားဝှက် ပြောင်းရန်" },
  close: { en: "Close", my: "ပိတ်ရန်" },
  hide: { en: "Hide passwords", my: "စကားဝှက် ဝှက်ရန်" },
  show: { en: "Show passwords", my: "စကားဝှက် ပြရန်" },
  done: { en: "Password changed. Any other devices signed in to this account have been signed out.", my: "စကားဝှက် ပြောင်းပြီးပါပြီ။ ဤအကောင့်ဖြင့် ဝင်ထားသော အခြားစက်များ ထွက်သွားပါပြီ။" },
  ok: { en: "Done", my: "ပြီးပါပြီ" },
  current: { en: "Current password", my: "လက်ရှိ စကားဝှက်" },
  next: { en: "New password (min {n})", my: "စကားဝှက်အသစ် (အနည်းဆုံး {n})" },
  confirm: { en: "Confirm new password", my: "စကားဝှက်အသစ် ထပ်ရိုက်ပါ" },
};
const useT = makeT(S);

export const MIN_PASSWORD_LENGTH = 8;

/** Maps Supabase's password errors to plain messages. */
export function passwordErrorMessage(err: { code?: string; message: string }, lang: Lang = "en"): string {
  if (err.code === "same_password") return tr(S, lang, "samePw");
  if (err.code === "weak_password") return tr(S, lang, "weakPw");
  if (err.code === "reauthentication_needed") return tr(S, lang, "reauth");
  return err.message;
}

const inputCls =
  "w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 pr-12 text-base sm:text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-300/50 focus:border-blue-300";

/**
 * Change the signed-in user's password. The current password is checked
 * first, so an unattended signed-in device can't be used to take over the
 * account. Other devices are signed out afterwards.
 */
export default function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const t = useT();
  const lang = useLang();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!user?.email) return setError(t("notSignedIn"));
    if (next.length < MIN_PASSWORD_LENGTH) return setError(t("tooShort", { n: MIN_PASSWORD_LENGTH }));
    if (next !== confirm) return setError(t("noMatch"));
    if (next === current) return setError(t("samePw"));

    setBusy(true);
    // Re-check the current password — also gives Supabase a fresh sign-in.
    const { error: authErr } = await supabase.auth.signInWithPassword({ email: user.email, password: current });
    if (authErr) { setBusy(false); return setError(t("wrongCurrent")); }

    const { error: updErr } = await supabase.auth.updateUser({ password: next });
    if (updErr) { setBusy(false); return setError(passwordErrorMessage(updErr, lang)); }

    // Any other phone or computer still signed in with the old password is signed out.
    await supabase.auth.signOut({ scope: "others" });
    setBusy(false);
    setDone(true);
  }

  const field = (id: string, label: string, value: string, set: (v: string) => void, auto: string) => (
    <div>
      <label htmlFor={id} className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">{label}</label>
      <div className="relative">
        <input id={id} type={show ? "text" : "password"} value={value} onChange={e => set(e.target.value)}
          autoComplete={auto} required className={inputCls} />
        <button type="button" onClick={() => setShow(s => !s)} aria-label={show ? t("hide") : t("show")}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
      <div className="absolute inset-0 bg-black/60" onClick={() => !busy && onClose()} />
      <div role="dialog" aria-modal="true" aria-labelledby="chpw-title"
        className="relative w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-pale-blue flex items-center justify-center"><KeyRound className="w-4 h-4 text-pale-blue-foreground" /></div>
            <div>
              <h2 id="chpw-title" className="text-slate-900 font-bold text-base">{t("title")}</h2>
              <p className="text-slate-500 text-xs truncate">{user?.email}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label={t("close")} className="p-1.5 -m-1.5 rounded-lg text-slate-500 hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        {done ? (
          <div className="space-y-4">
            <div className="flex items-start gap-2.5 bg-pale-green border border-emerald-200 rounded-xl px-4 py-3 text-sm text-pale-green-foreground">
              <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{t("done")}</span>
            </div>
            <button type="button" onClick={onClose} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl py-3 text-sm">{t("ok")}</button>
          </div>
        ) : (
          <form onSubmit={save} className="space-y-4">
            {field("chpw-current", t("current"), current, setCurrent, "current-password")}
            {field("chpw-new", t("next", { n: MIN_PASSWORD_LENGTH }), next, setNext, "new-password")}
            {field("chpw-confirm", t("confirm"), confirm, setConfirm, "new-password")}
            {error && <div role="alert" className="rounded-xl bg-pale-red border border-red-100 px-4 py-3 text-pale-red-foreground text-sm">{error}</div>}
            <button type="submit" disabled={busy}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold rounded-xl py-3 text-sm">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} {t("title")}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
