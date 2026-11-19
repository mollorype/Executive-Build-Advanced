import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Crown, Eye, EyeOff, Loader2, RefreshCw, Trash2, UserPlus, X } from "lucide-react";

type Ceo = { email: string; added_at: string; has_login: boolean; last_sign_in: string | null; is_you: boolean };
type Dialog = { mode: "add" } | { mode: "remove"; email: string } | null;

/** Calls the ceo-access Edge Function, surfacing its own error text. */
async function callCeoAccess(body: Record<string, unknown>): Promise<{ ceos?: Ceo[]; created?: boolean; already?: boolean }> {
  const { data, error } = await supabase.functions.invoke("ceo-access", { body });
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
const inputCls =
  "w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 pr-12 text-base sm:text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-300/50 focus:border-blue-300";

/**
 * CEO Access on the Staff Access page. Everything goes through the ceo-access
 * Edge Function, which re-checks CEO status in the database and the caller's
 * password on every change, and announces changes on Telegram.
 */
export default function CeoAccessSection() {
  const [ceos, setCeos] = useState<Ceo[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const { ceos: list } = await callCeoAccess({ action: "list" });
      setCeos(list ?? []);
      setLoadError("");
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="bg-white border border-slate-100 shadow-sm rounded-2xl overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-2">
        <span className="text-slate-900 font-semibold text-sm">
          CEOs
          {ceos && ceos.length > 0 && (
            <span className="ml-2 bg-slate-100 text-slate-600 text-xs font-bold rounded-full px-2 py-0.5">{ceos.length}</span>
          )}
        </span>
        <div className="flex items-center gap-3">
          <button onClick={load} disabled={refreshing} aria-label="Refresh CEO list" className="text-slate-400 hover:text-slate-600">
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          </button>
          <button onClick={() => { setNotice(""); setDialog({ mode: "add" }); }} disabled={!ceos}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-bold rounded-lg px-3 py-2">
            <UserPlus className="w-3.5 h-3.5" /> Add CEO
          </button>
        </div>
      </div>

      {notice && <p className="px-6 pt-3 text-sm text-pale-green-foreground font-medium">{notice}</p>}

      {loadError ? (
        <p role="alert" className="px-6 py-6 text-sm text-pale-red-foreground">{loadError}</p>
      ) : !ceos ? (
        <div className="px-6 py-8 text-center"><Loader2 className="w-5 h-5 text-slate-300 animate-spin mx-auto" /></div>
      ) : (
        <div className="divide-y divide-slate-100">
          {ceos.map(c => (
            <div key={c.email} className="px-6 py-3.5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-7 h-7 rounded-lg bg-pale-gold flex items-center justify-center shrink-0">
                  <Crown className="w-3.5 h-3.5 text-pale-gold-foreground" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-slate-900 font-medium truncate">
                    {c.email}
                    {c.is_you && <span className="ml-2 text-[10px] font-bold text-pale-blue-foreground bg-pale-blue rounded px-1.5 py-0.5 align-middle">YOU</span>}
                  </p>
                  <p className="text-xs text-slate-400">
                    {!c.has_login ? "No login yet" : c.last_sign_in ? `Last sign-in ${fmtDay(c.last_sign_in)}` : "Never signed in"}
                  </p>
                </div>
              </div>
              {!c.is_you && (
                <button onClick={() => { setNotice(""); setDialog({ mode: "remove", email: c.email }); }}
                  aria-label={`Remove CEO access for ${c.email}`} title="Remove CEO access"
                  className="shrink-0 text-slate-300 hover:text-red-500 p-1">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {dialog && (
        <CeoChangeDialog
          dialog={dialog}
          onClose={() => setDialog(null)}
          onDone={(list, message) => { setCeos(list); setDialog(null); setNotice(message); }}
        />
      )}
    </div>
  );
}

function CeoChangeDialog({ dialog, onClose, onDone }: {
  dialog: NonNullable<Dialog>;
  onClose: () => void;
  onDone: (ceos: Ceo[], message: string) => void;
}) {
  const adding = dialog.mode === "add";
  const [email, setEmail] = useState(adding ? "" : dialog.email);
  const [tempPassword, setTempPassword] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await callCeoAccess(adding
        ? { action: "add", email, temp_password: tempPassword, current_password: password }
        : { action: "remove", email, current_password: password });
      const who = email.trim().toLowerCase();
      onDone(res.ceos ?? [], adding
        ? res.already ? `${who} is already a CEO.`
          : res.created ? `${who} is now a CEO. Give them the temporary password; they should change it from Menu → Change password.`
          : `${who} is now a CEO and can sign in with their existing password.`
        : `${who} no longer has CEO access.`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const eye = (
    <button type="button" onClick={() => setShow(s => !s)} aria-label={show ? "Hide passwords" : "Show passwords"}
      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
      {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
    </button>
  );
  const label = "block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
      <div className="absolute inset-0 bg-black/60" onClick={() => !busy && onClose()} />
      <form onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="ceo-dlg-title"
        className="relative w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow p-5 space-y-4 max-h-[92vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="ceo-dlg-title" className="text-slate-900 font-bold text-base">{adding ? "Add a CEO" : "Remove CEO access"}</h2>
            <p className="text-slate-500 text-xs mt-0.5">
              {adding
                ? "A CEO can see and change everything in STM Financial."
                : `${dialog.email} will lose CEO access straight away. Their login isn't deleted.`}
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="p-1.5 -m-1.5 rounded-lg text-slate-500 hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        {adding && (
          <>
            <div>
              <label htmlFor="ceo-email" className={label}>Their email</label>
              <input id="ceo-email" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus
                className={inputCls} placeholder="name@gmail.com" />
            </div>
            <div>
              <label htmlFor="ceo-temp" className={label}>Temporary password for them</label>
              <div className="relative">
                <input id="ceo-temp" type={show ? "text" : "password"} value={tempPassword} onChange={e => setTempPassword(e.target.value)}
                  autoComplete="new-password" className={inputCls} placeholder="At least 8 characters" />
                {eye}
              </div>
              <p className="text-[11px] text-slate-400 mt-1">Only used if this email doesn't have a login yet. Tell it to them in person.</p>
            </div>
          </>
        )}

        <div className="bg-slate-50 border border-slate-100 rounded-xl p-3">
          <label htmlFor="ceo-mypw" className={label}>Your password, to confirm</label>
          <div className="relative">
            <input id="ceo-mypw" type={show ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)}
              autoComplete="current-password" required className={`${inputCls} bg-white`} />
            {eye}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Every CEO connected to Telegram is notified of this change.</p>
        </div>

        {error && <div role="alert" className="rounded-xl bg-pale-red border border-red-100 px-4 py-3 text-pale-red-foreground text-sm">{error}</div>}

        <button type="submit" disabled={busy}
          className={`w-full flex items-center justify-center gap-2 disabled:opacity-50 text-white font-semibold rounded-xl py-3 text-sm ${adding ? "bg-blue-600 hover:bg-blue-500" : "bg-red-600 hover:bg-red-500"}`}>
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          {adding ? "Add CEO" : "Remove CEO access"}
        </button>
      </form>
    </div>
  );
}
