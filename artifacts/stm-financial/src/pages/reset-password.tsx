import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { supabase } from "@/lib/supabase";
import { MIN_PASSWORD_LENGTH, passwordErrorMessage } from "@/components/change-password-dialog";
import { AlertTriangle, CheckCircle, Eye, EyeOff, KeyRound, Loader2 } from "lucide-react";

/** True only for a session created by a password-reset email, not an ordinary sign-in. */
function isRecoverySession(accessToken: string): boolean {
  try {
    const payload = JSON.parse(atob(accessToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return Array.isArray(payload.amr)
      && payload.amr.some((a: { method?: string }) => ["recovery", "otp", "magiclink"].includes(a?.method ?? ""));
  } catch {
    return false;
  }
}

type State = "checking" | "ready" | "invalid" | "done";

/**
 * Landing page for the "Forgot password?" email. Accepts either link format:
 *  - ?token_hash=…&type=recovery — verified here through the app's own API
 *    domain, so it works even where *.supabase.co is blocked (see the email
 *    template note in the PR / setup steps);
 *  - Supabase's default link, which arrives as #access_token…&type=recovery
 *    and is picked up by supabase-js on start-up.
 * Either way, the new password can only be set from a session that came from
 * a reset email — not from an ordinary signed-in session (that's what
 * "Change password", which asks for the current password, is for).
 */
export default function ResetPassword() {
  const [, setLocation] = useLocation();
  const [state, setState] = useState<State>("checking");
  const [email, setEmail] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const query = new URLSearchParams(window.location.search);
      const hash = new URLSearchParams(window.location.hash.slice(1));
      if (query.get("error") || hash.get("error")) { setState("invalid"); return; }   // expired / already used

      const tokenHash = query.get("token_hash");
      if (tokenHash) {
        const { data, error: vErr } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
        window.history.replaceState(null, "", window.location.pathname);   // don't leave the token in the address bar
        if (cancelled) return;
        if (vErr || !data.session) { setState("invalid"); return; }
        setEmail(data.user?.email ?? "");
        setState("ready");
        return;
      }

      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session && isRecoverySession(data.session.access_token)) {
        setEmail(data.session.user.email ?? "");
        setState("ready");
      } else {
        setState("invalid");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (next.length < MIN_PASSWORD_LENGTH) return setError(`The password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    if (next !== confirm) return setError("The passwords don't match.");
    setBusy(true);
    const { error: updErr } = await supabase.auth.updateUser({ password: next });
    if (updErr) { setBusy(false); return setError(passwordErrorMessage(updErr)); }
    await supabase.auth.signOut({ scope: "others" });
    setBusy(false);
    setState("done");
  }

  const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 pr-12 text-base sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-300/50 focus:border-blue-300";

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white border border-slate-100 rounded-2xl shadow-sm p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-pale-blue flex items-center justify-center"><KeyRound className="w-5 h-5 text-pale-blue-foreground" /></div>
          <div>
            <h1 className="text-slate-900 font-bold text-lg">Set a new password</h1>
            <p className="text-slate-500 text-xs">STM Financial · Executive Portal</p>
          </div>
        </div>

        {state === "checking" && (
          <div className="py-6 text-center"><Loader2 className="w-6 h-6 text-blue-500/60 animate-spin mx-auto" /></div>
        )}

        {state === "invalid" && (
          <div className="space-y-4">
            <div role="alert" className="flex items-start gap-2 bg-pale-red border border-red-100 rounded-xl px-4 py-3 text-sm text-pale-red-foreground">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>This reset link is invalid, expired or already used. Request a new one from the sign-in page. If you're signed in and know your password, use <b>Change password</b> in the menu instead.</span>
            </div>
            <button type="button" onClick={() => setLocation("/")} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl py-3 text-sm">Back to sign in</button>
          </div>
        )}

        {state === "ready" && (
          <form onSubmit={save} className="space-y-4">
            {email && <p className="text-sm text-slate-600">For <span className="font-semibold text-slate-900">{email}</span></p>}
            {[
              { id: "rp-new", label: `New password (min ${MIN_PASSWORD_LENGTH})`, value: next, set: setNext },
              { id: "rp-confirm", label: "Confirm new password", value: confirm, set: setConfirm },
            ].map(f => (
              <div key={f.id}>
                <label htmlFor={f.id} className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">{f.label}</label>
                <div className="relative">
                  <input id={f.id} type={show ? "text" : "password"} value={f.value} onChange={e => f.set(e.target.value)}
                    autoComplete="new-password" required className={inputCls} />
                  <button type="button" onClick={() => setShow(s => !s)} aria-label={show ? "Hide passwords" : "Show passwords"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                    {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            ))}
            {error && <div role="alert" className="rounded-xl bg-pale-red border border-red-100 px-4 py-3 text-pale-red-foreground text-sm">{error}</div>}
            <button type="submit" disabled={busy}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold rounded-xl py-3 text-sm">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} Save new password
            </button>
          </form>
        )}

        {state === "done" && (
          <div className="space-y-4">
            <div className="flex items-start gap-2 bg-pale-green border border-emerald-200 rounded-xl px-4 py-3 text-sm text-pale-green-foreground">
              <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Password updated. Other devices signed in to this account have been signed out.</span>
            </div>
            <button type="button" onClick={() => setLocation("/")} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl py-3 text-sm">Continue to portal</button>
          </div>
        )}
      </div>
    </div>
  );
}
