import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { KeyRound, Loader2, RefreshCw } from "lucide-react";

type StaffLogin = { email: string; has_login: boolean; last_sign_in: string | null; portal_login: boolean };

/** Calls the staff-auth Edge Function as the signed-in CEO, surfacing its own error text. */
async function callStaffAuth(body: Record<string, unknown>): Promise<{ logins?: StaffLogin[]; already?: boolean }> {
  const { data, error } = await supabase.functions.invoke("staff-auth", { body });
  if (error) {
    let message = "Couldn't reach the server. Check your connection and try again.";
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
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function reset(email: string) {
    if (!window.confirm(`Reset the STM Daily password for ${email}?\n\nThey'll be signed out and choose a new password the next time they sign in.`)) return;
    setResetting(email);
    setNotice("");
    try {
      await callStaffAuth({ action: "reset", email });
      setNotice(`${email} will choose a new password the next time they sign in.`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setResetting(null);
    }
  }

  return (
    <div className="bg-white border border-slate-100 shadow-sm rounded-2xl overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-2">
        <span className="text-slate-900 font-semibold text-sm flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-slate-400" /> STM Daily passwords
        </span>
        <button onClick={load} disabled={refreshing} aria-label="Refresh password list" className="text-slate-400 hover:text-slate-600">
          <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
        </button>
      </div>
      <p className="px-6 pt-3 text-xs text-slate-500">
        Each employee chooses their own password the first time they sign in to STM Daily. You're told on Telegram whenever one is set.
      </p>

      {notice && <p className="px-6 pt-3 text-sm text-pale-green-foreground font-medium">{notice}</p>}
      {error && <p role="alert" className="px-6 pt-3 text-sm text-pale-red-foreground">{error}</p>}

      {!logins ? (
        !error && <div className="px-6 py-8 text-center"><Loader2 className="w-5 h-5 text-slate-300 animate-spin mx-auto" /></div>
      ) : logins.length === 0 ? (
        <p className="px-6 py-6 text-sm text-slate-400">No employees on the list yet.</p>
      ) : (
        <div className="divide-y divide-slate-100 mt-3">
          {logins.map(l => (
            <div key={l.email} className="px-6 py-3.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-slate-900 font-medium truncate">{l.email}</p>
                <p className="text-xs text-slate-400">
                  {l.portal_login ? "Uses their STM Financial password"
                    : !l.has_login ? "No password yet — they'll set one when they sign in"
                    : l.last_sign_in ? `Password set · last sign-in ${fmtDay(l.last_sign_in)}`
                    : "Password set"}
                </p>
              </div>
              {l.has_login && !l.portal_login && (
                <button onClick={() => reset(l.email)} disabled={resetting !== null}
                  className="shrink-0 flex items-center gap-1.5 text-xs font-semibold text-slate-600 border border-slate-200 hover:border-red-200 hover:text-red-600 disabled:opacity-40 rounded-lg px-3 py-1.5">
                  {resetting === l.email && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Reset
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
