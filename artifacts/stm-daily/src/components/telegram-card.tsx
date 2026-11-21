// Telegram notices for STM Daily staff: connect the bot, choose whether chat
// messages are included, send a test, disconnect.
//
// Linking uses the same bot and flow owners use (telegram-link → /start <code>).
// The link row is the staff member's own (RLS); notices themselves are sent by
// the staff-telegram-notify Edge Function.

import { useCallback, useEffect, useRef, useState } from "react";
import { authClient, storedStaffUser } from "../lib/supabase";
import { confirmDialog } from "./confirm-dialog";

type Lang = "en" | "my";
type Link = { telegram_username: string | null; telegram_first_name: string | null; notify_chat: boolean };

const S = {
  title:      { en: "Telegram notifications", my: "Telegram အသိပေးချက်" },
  desc:       { en: "Get salary, leave and emergency notices on Telegram.", my: "လစာ၊ ခွင့်၊ အရေးပေါ် အသိပေးချက်များကို Telegram တွင် ရယူပါ။" },
  connect:    { en: "Connect Telegram", my: "Telegram ချိတ်ရန်" },
  open:       { en: "Open Telegram", my: "Telegram ဖွင့်ရန်" },
  waiting:    { en: "In Telegram, tap Start — this page updates by itself.", my: "Telegram တွင် Start ကို နှိပ်ပါ — ဒီစာမျက်နှာ အလိုလို ပြောင်းပါမည်။" },
  connected:  { en: "Connected", my: "ချိတ်ပြီး" },
  chatToggle: { en: "Also tell me about new chat messages", my: "Chat စာအသစ်များကိုလည်း အသိပေးရန်" },
  chatHelp:   { en: "Only who sent it — never the message.", my: "ပို့သူကိုသာ ပြမည် — စာကို မပြပါ။" },
  test:       { en: "Send test", my: "စမ်းပို့ရန်" },
  testSent:   { en: "Sent — check Telegram.", my: "ပို့ပြီး — Telegram ကို ကြည့်ပါ။" },
  disconnect: { en: "Disconnect", my: "ဖြုတ်ရန်" },
  confirmOff: { en: "Stop Telegram notifications on this account?", my: "Telegram အသိပေးချက်များ ရပ်မလား?" },
  failed:     { en: "Something went wrong. Check the connection and try again.", my: "မအောင်မြင်ပါ။ အင်တာနက် စစ်ပြီး ထပ်ကြိုးစားပါ။" },
} as const;
const t = (lang: Lang, k: keyof typeof S) => S[k][lang];

async function linkFn(body: Record<string, unknown>): Promise<{ url?: string; sent?: boolean; error?: string }> {
  const { data, error } = await authClient.functions.invoke("telegram-link", { body });
  if (!error) return data ?? {};
  const ctx = (error as { context?: unknown }).context;
  let message = "";
  try { message = (await (ctx as Response)?.json?.())?.error ?? ""; } catch { /* not JSON */ }
  return { error: message || "failed" };
}

export default function TelegramCard({ lang }: { lang: Lang }) {
  const me = storedStaffUser();
  const [link, setLink] = useState<Link | null | undefined>(undefined);   // undefined = loading
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<"" | "connect" | "test" | "off" | "chat">("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const poll = useRef<number | null>(null);

  const load = useCallback(async () => {
    let res = await authClient.from("telegram_links").select("telegram_username, telegram_first_name, notify_chat").maybeSingle();
    if (res.error && /notify_chat/.test(res.error.message)) {   // before the staff Telegram migration
      res = await authClient.from("telegram_links").select("telegram_username, telegram_first_name").maybeSingle() as typeof res;
    }
    if (res.error) { setLink(null); return null; }
    const d = res.data as Partial<Link> | null;
    const row: Link | null = d ? { telegram_username: d.telegram_username ?? null, telegram_first_name: d.telegram_first_name ?? null, notify_chat: !!d.notify_chat } : null;
    setLink(row);
    return row;
  }, []);

  useEffect(() => { if (me) load(); return () => { if (poll.current) window.clearInterval(poll.current); }; }, [me?.id, load]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!me) return null;

  async function connect() {
    setBusy("connect"); setError(""); setNote("");
    const r = await linkFn({ action: "link" });
    setBusy("");
    if (!r.url) { setError(r.error && r.error !== "failed" ? r.error : t(lang, "failed")); return; }
    setUrl(r.url);
    // Notice the link as soon as they press Start (up to ~3 minutes).
    if (poll.current) window.clearInterval(poll.current);
    let tries = 0;
    poll.current = window.setInterval(async () => {
      tries++;
      const row = await load();
      if (row || tries > 60) { window.clearInterval(poll.current!); poll.current = null; if (row) setUrl(""); }
    }, 3000);
  }

  async function test() {
    setBusy("test"); setError(""); setNote("");
    const r = await linkFn({ action: "test" });
    setBusy("");
    if (r.sent) setNote(t(lang, "testSent")); else setError(r.error && r.error !== "failed" ? r.error : t(lang, "failed"));
  }

  async function setChat(on: boolean) {
    setBusy("chat"); setError("");
    const { error: e } = await authClient.from("telegram_links").update({ notify_chat: on }).eq("user_id", me!.id);
    setBusy("");
    if (e) setError(t(lang, "failed")); else setLink(l => (l ? { ...l, notify_chat: on } : l));
  }

  async function disconnect() {
    if (!(await confirmDialog(t(lang, "confirmOff"), { lang, theme: "dark", confirmLabel: t(lang, "disconnect") }))) return;
    setBusy("off"); setError(""); setNote("");
    const { error: e } = await authClient.from("telegram_links").delete().eq("user_id", me!.id);
    setBusy("");
    if (e) setError(t(lang, "failed")); else { setLink(null); setUrl(""); }
  }

  return (
    <div className="w-full bg-[#161b22] border border-[#30363d] rounded-2xl p-5 space-y-3" data-testid="telegram-card">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-sky-500/15 flex items-center justify-center shrink-0">
          <svg className="w-5 h-5 text-sky-400" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M21.9 4.3 18.6 20c-.2 1-.9 1.3-1.8.8l-5-3.7-2.4 2.3c-.3.3-.5.5-1 .5l.4-5.1 9.2-8.3c.4-.4-.1-.6-.6-.2L6 13.4l-4.9-1.5c-1.1-.3-1.1-1.1.2-1.6L20.5 2.9c.9-.3 1.7.2 1.4 1.4z" />
          </svg>
        </div>
        <div className="min-w-0">
          <p className="text-base font-bold text-white">{t(lang, "title")}</p>
          {link ? (
            <p className="text-sm text-emerald-400 mt-0.5">✓ {t(lang, "connected")}{link.telegram_username ? ` · @${link.telegram_username}` : link.telegram_first_name ? ` · ${link.telegram_first_name}` : ""}</p>
          ) : (
            <p className="text-sm text-gray-500 mt-0.5">{t(lang, "desc")}</p>
          )}
        </div>
      </div>

      {link === undefined ? null : link ? (
        <>
          <label className="flex items-start gap-3 rounded-xl border border-[#30363d] px-3 py-2.5 cursor-pointer">
            <input type="checkbox" className="mt-0.5 w-4 h-4 accent-sky-500" checked={link.notify_chat} disabled={busy === "chat"}
              onChange={e => setChat(e.target.checked)} />
            <span className="min-w-0">
              <span className="block text-sm text-gray-200">{t(lang, "chatToggle")}</span>
              <span className="block text-[11px] text-gray-500">{t(lang, "chatHelp")}</span>
            </span>
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={test} disabled={!!busy}
              className="flex-1 rounded-xl border border-[#30363d] hover:border-sky-500/60 text-sm font-semibold text-sky-300 py-2.5 disabled:opacity-50">
              {busy === "test" ? "…" : t(lang, "test")}
            </button>
            <button type="button" onClick={disconnect} disabled={!!busy}
              className="px-4 rounded-xl border border-[#30363d] hover:border-red-500/60 text-sm font-semibold text-gray-400 hover:text-red-400 py-2.5 disabled:opacity-50">
              {busy === "off" ? "…" : t(lang, "disconnect")}
            </button>
          </div>
        </>
      ) : url ? (
        <div className="space-y-2">
          <a href={url} target="_blank" rel="noopener noreferrer"
            className="block w-full text-center rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-sm font-bold py-3">{t(lang, "open")}</a>
          <p className="text-[11px] text-gray-500 text-center">{t(lang, "waiting")}</p>
        </div>
      ) : (
        <button type="button" onClick={connect} disabled={busy === "connect"}
          className="w-full rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-sm font-bold py-3 disabled:opacity-50">
          {busy === "connect" ? "…" : t(lang, "connect")}
        </button>
      )}

      {note && <p role="status" className="text-xs text-emerald-400">{note}</p>}
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
