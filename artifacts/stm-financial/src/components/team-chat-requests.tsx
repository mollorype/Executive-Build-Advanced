// STM Team Chat — day-off requests and emergency alerts (the only chat items
// that alert the CEOs on Telegram). Kept identical in both apps (a test checks this).

import { useState } from "react";
import {
  CHAT_STRINGS, EMERGENCY_TYPES, MAX_BODY, addDays, fmtLeaveRange, leaveDays, leaveProblem, todayKey,
  type ChatLang, type ChatMessage, type ChatStringKey, type EmergencyType,
} from "../lib/team-chat-core";

type Theme = "dark" | "light";

const SHEET = {
  dark: {
    panel: "bg-[#161b22] border border-[#30363d] text-white",
    muted: "text-gray-400",
    label: "text-gray-500",
    field: "bg-[#0d1117] border border-[#30363d] text-white placeholder:text-gray-600 focus:border-blue-500 [color-scheme:dark]",
    chip: "bg-[#0d1117] border border-[#30363d] text-gray-200",
    chipOn: "bg-red-600/20 border-red-500 text-white ring-2 ring-red-500/40",
    ghost: "bg-[#21262d] border border-[#30363d] text-gray-300",
    error: "bg-red-500/10 border border-red-500/30 text-red-300",
    note: "bg-blue-500/10 border border-blue-500/30 text-blue-200",
  },
  light: {
    panel: "bg-white border border-slate-200 text-slate-900",
    muted: "text-slate-500",
    label: "text-slate-500",
    field: "bg-slate-50 border border-slate-200 text-slate-900 placeholder:text-slate-400 focus:border-blue-300",
    chip: "bg-slate-50 border border-slate-200 text-slate-700",
    chipOn: "bg-red-50 border-red-500 text-red-800 ring-2 ring-red-200",
    ghost: "bg-white border border-slate-200 text-slate-700",
    error: "bg-red-50 border border-red-100 text-red-700",
    note: "bg-blue-50 border border-blue-100 text-blue-800",
  },
} as const;

function Sheet({ theme, title, onClose, busy, children }: {
  theme: Theme; title: string; onClose: () => void; busy: boolean; children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
      <div className="absolute inset-0 bg-black/60" onClick={() => !busy && onClose()} />
      <div role="dialog" aria-modal="true" aria-label={title}
        className={`relative w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] space-y-4 max-h-[92dvh] overflow-y-auto ${SHEET[theme].panel}`}>
        <h2 className="text-base font-bold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

const labelCls = "block text-xs font-semibold uppercase tracking-wider mb-1.5";
const fieldCls = "w-full rounded-xl px-3.5 py-2.5 text-base sm:text-sm focus:outline-none";

/** Staff: ask for one or more days off. */
export function LeaveDialog({ theme, lang, canAddReason, onSend, onClose }: {
  theme: Theme; lang: ChatLang; canAddReason: boolean;
  onSend: (r: { from: string; to: string; reason: string }) => Promise<string | null>;
  onClose: () => void;
}) {
  const S = SHEET[theme];
  const s = (k: ChatStringKey) => CHAT_STRINGS[k][lang];
  const tomorrow = addDays(todayKey(), 1);
  const [from, setFrom] = useState(tomorrow);
  const [to, setTo] = useState(tomorrow);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const problem = leaveProblem(from, to);
  const n = problem ? 0 : leaveDays(from, to);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (problem) { setError(s(problem)); return; }
    setBusy(true);
    setError("");
    const err = await onSend({ from, to, reason: reason.trim().slice(0, MAX_BODY) });
    if (err) { setError(err); setBusy(false); }
  }

  return (
    <Sheet theme={theme} title={`🗓 ${s("askDayOff")}`} onClose={onClose} busy={busy}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="leave-from" className={`${labelCls} ${S.label}`}>{s("from")}</label>
            <input id="leave-from" type="date" value={from} min={todayKey()} required
              onChange={e => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value); setError(""); }}
              className={`${fieldCls} ${S.field}`} />
          </div>
          <div>
            <label htmlFor="leave-to" className={`${labelCls} ${S.label}`}>{s("to")}</label>
            <input id="leave-to" type="date" value={to} min={from} required
              onChange={e => { setTo(e.target.value); setError(""); }}
              className={`${fieldCls} ${S.field}`} />
          </div>
        </div>
        <p className={`text-sm font-semibold ${problem ? "text-red-500" : ""}`}>
          {problem ? s(problem) : `${fmtLeaveRange(from, to)} · ${n} ${n === 1 ? s("day") : s("days")}`}
        </p>
        {canAddReason && (
          <div>
            <label htmlFor="leave-reason" className={`${labelCls} ${S.label}`}>{s("reasonOpt")}</label>
            <textarea id="leave-reason" rows={2} value={reason} maxLength={MAX_BODY} onChange={e => setReason(e.target.value)}
              className={`${fieldCls} resize-none ${S.field}`} />
          </div>
        )}
        <p className={`text-xs rounded-lg px-3 py-2 ${S.note}`}>{s("requestNote")}</p>
        {error && <p role="alert" className={`text-sm rounded-lg px-3 py-2 ${S.error}`}>{error}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} disabled={busy} className={`flex-1 rounded-xl py-3 text-sm font-semibold ${S.ghost}`}>{s("cancel")}</button>
          <button type="submit" disabled={busy || !!problem}
            className="flex-[2] rounded-xl py-3 text-sm font-bold bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50">
            {busy ? "…" : s("sendRequest")}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

/** Anyone: raise an emergency. Pick what's happening, add details, send. */
export function EmergencyDialog({ theme, lang, canAddDetails, onSend, onClose }: {
  theme: Theme; lang: ChatLang; canAddDetails: boolean;
  onSend: (r: { type: EmergencyType; details: string }) => Promise<string | null>;
  onClose: () => void;
}) {
  const S = SHEET[theme];
  const s = (k: ChatStringKey) => CHAT_STRINGS[k][lang];
  const [type, setType] = useState<EmergencyType | null>(null);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!type) return;
    if (!navigator.onLine) { setError(s("offlineCall")); return; }
    setBusy(true);
    setError("");
    const err = await onSend({ type, details: details.trim().slice(0, MAX_BODY) });
    if (err) { setError(err); setBusy(false); }
  }

  return (
    <Sheet theme={theme} title={`🚨 ${s("emergencyAlert")}`} onClose={onClose} busy={busy}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <p className={`${labelCls} ${S.label}`}>{s("whatHappened")}</p>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(EMERGENCY_TYPES) as EmergencyType[]).map(k => (
              <button key={k} type="button" onClick={() => { setType(k); setError(""); }} aria-pressed={type === k}
                className={`flex items-center gap-2 rounded-xl border px-3 py-3 text-left text-sm font-semibold ${type === k ? S.chipOn : S.chip}`}>
                <span className="text-lg leading-none">{EMERGENCY_TYPES[k].icon}</span>
                <span className="min-w-0">{EMERGENCY_TYPES[k][lang]}</span>
              </button>
            ))}
          </div>
        </div>
        {canAddDetails ? (
          <div>
            <label htmlFor="emergency-details" className={`${labelCls} ${S.label}`}>{s("detailsOpt")}</label>
            <textarea id="emergency-details" rows={2} value={details} maxLength={MAX_BODY} onChange={e => setDetails(e.target.value)}
              className={`${fieldCls} resize-none ${S.field}`} />
          </div>
        ) : (
          <p className={`text-xs ${S.muted}`}>{s("noKeyDetails")}</p>
        )}
        <p className={`text-xs ${S.muted}`}>{s("emergencyNote")}</p>
        {error && <p role="alert" className={`text-sm rounded-lg px-3 py-2 ${S.error}`}>{error}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} disabled={busy} className={`flex-1 rounded-xl py-3 text-sm font-semibold ${S.ghost}`}>{s("cancel")}</button>
          <button type="submit" disabled={busy || !type}
            className="flex-[2] rounded-xl py-3 text-sm font-bold bg-red-600 hover:bg-red-500 text-white disabled:opacity-40">
            {busy ? "…" : s("sendEmergency")}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-500",
  approved: "bg-emerald-500/15 text-emerald-500",
  declined: "bg-red-500/15 text-red-500",
  open: "bg-red-600 text-white",
  handled: "bg-emerald-500/15 text-emerald-500",
};

/** The card shown in the chat for a day-off request or an emergency. */
export function RequestCard({ m, shown, isCeo, lang, theme, onDecide }: {
  m: ChatMessage;
  shown: string | null | undefined;
  isCeo: boolean;
  lang: ChatLang;
  theme: Theme;
  onDecide: (status: "approved" | "declined" | "handled") => Promise<boolean>;
}) {
  const s = (k: ChatStringKey) => CHAT_STRINGS[k][lang];
  const [busy, setBusy] = useState(false);
  const decide = async (st: "approved" | "declined" | "handled") => {
    setBusy(true);
    if (!(await onDecide(st))) setBusy(false);
  };
  const emergency = m.kind === "emergency";
  const et = m.emergency_type ? EMERGENCY_TYPES[m.emergency_type] : EMERGENCY_TYPES.other;
  const status = m.status ?? (emergency ? "open" : "pending");
  const statusText = s(status === "pending" ? "pending" : status);
  const decided = m.decided_by_name && m.decided_at
    ? `${s("by")} ${m.decided_by_name} · ${new Date(m.decided_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
    : "";
  const box = emergency
    ? status === "open" ? "bg-red-600/15 border-2 border-red-500" : theme === "dark" ? "bg-[#161b22] border border-red-500/40" : "bg-white border border-red-200"
    : theme === "dark" ? "bg-[#161b22] border border-blue-500/40" : "bg-white border border-blue-200";
  const n = m.leave_from && m.leave_to ? leaveDays(m.leave_from, m.leave_to) : 0;

  return (
    <div className={`w-72 max-w-full rounded-2xl p-3.5 space-y-2 text-left ${box}`}>
      <div className="flex items-center justify-between gap-2">
        <p className={`text-xs font-bold uppercase tracking-wider ${emergency ? "text-red-500" : "text-blue-500"}`}>
          {emergency ? `🚨 ${s("emergency")}` : `🗓 ${s("dayOffRequest")}`}
        </p>
        <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 whitespace-nowrap ${STATUS_STYLE[status]}`}>{statusText}</span>
      </div>
      {emergency ? (
        <p className="text-base font-bold">{et.icon} {et[lang]}</p>
      ) : m.leave_from && m.leave_to ? (
        <p className="text-base font-bold">{fmtLeaveRange(m.leave_from, m.leave_to)} <span className="text-sm font-semibold opacity-60">· {n} {n === 1 ? s("day") : s("days")}</span></p>
      ) : null}
      {shown === undefined ? (
        <p className="text-[13px] italic opacity-70">{s("locked")}</p>
      ) : shown === null ? (
        <p className="text-[13px] italic opacity-70">{s("cantOpen")}</p>
      ) : shown ? (
        <p className="text-[15px] leading-snug whitespace-pre-wrap break-words">{shown}</p>
      ) : null}
      {decided && <p className="text-[11px] opacity-60">{statusText} {decided}</p>}
      {isCeo && !m.pending && status === "pending" && (
        <div className="flex gap-2 pt-1">
          <button type="button" disabled={busy} onClick={() => decide("declined")}
            className="flex-1 rounded-xl py-2 text-sm font-semibold border border-red-400/60 text-red-500 disabled:opacity-50">{s("decline")}</button>
          <button type="button" disabled={busy} onClick={() => decide("approved")}
            className="flex-1 rounded-xl py-2 text-sm font-bold bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50">{s("approve")}</button>
        </div>
      )}
      {isCeo && !m.pending && status === "open" && (
        <button type="button" disabled={busy} onClick={() => decide("handled")}
          className="w-full rounded-xl py-2 text-sm font-bold bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50">✓ {s("markHandled")}</button>
      )}
    </div>
  );
}
