import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { AlertTriangle, BellRing, CheckCircle, ExternalLink, Loader2, Send } from "lucide-react";
import { makeT } from "@/lib/app-i18n";

const useT = makeT({
  unreachable: { en: "Couldn't reach the Telegram service. Check your connection and try again.", my: "Telegram ဝန်ဆောင်မှုကို မချိတ်နိုင်ပါ။ အင်တာနက် စစ်ပြီး ထပ်ကြိုးစားပါ။" },
  connectedNotice: { en: "Connected — you'll get a private Telegram message for every shift.", my: "ချိတ်ပြီး — ဆိုင်းတိုင်းအတွက် Telegram မှ သီးသန့် စာ ရပါမည်။" },
  expired: { en: "That connect link expired. Tap Connect Telegram to get a new one.", my: "ချိတ်ဆက် link သက်တမ်းကုန်သွားပြီ။ အသစ်ရယူရန် Telegram ချိတ်ရန် ကို နှိပ်ပါ။" },
  testSent: { en: "Test message sent — check Telegram.", my: "စမ်းသပ်စာ ပို့ပြီး — Telegram ကို ကြည့်ပါ။" },
  confirmOff: { en: "Turn off Telegram shift alerts for your account?", my: "သင့်အကောင့်အတွက် Telegram ဆိုင်း အသိပေးချက် ပိတ်မလား?" },
  turnedOff: { en: "Telegram alerts turned off.", my: "Telegram အသိပေးချက် ပိတ်ပြီး။" },
  yourTelegram: { en: "your Telegram", my: "သင့် Telegram" },
  alertsOn: { en: "Telegram alerts on · ", my: "Telegram အသိပေးချက် ဖွင့်ထား · " },
  alerts: { en: "Telegram alerts", my: "Telegram အသိပေးချက်" },
  checking: { en: "Checking…", my: "စစ်နေသည်…" },
  connectedOn: { en: "Connected {date} · every shift, 🚨 for red flags", my: "{date} တွင် ချိတ်ခဲ့ · ဆိုင်းတိုင်း၊ သတိပေးချက်များအတွက် 🚨" },
  pitch: { en: "Get every shift submission — and 🚨 red flags — privately in Telegram.", my: "ဆိုင်း တင်သွင်းမှုတိုင်း နှင့် 🚨 သတိပေးချက်များကို Telegram တွင် သီးသန့် ရယူပါ။" },
  sendTest: { en: "Send test", my: "စမ်းပို့ရန်" },
  turnOff: { en: "Turn off", my: "ပိတ်ရန်" },
  connect: { en: "Connect Telegram", my: "Telegram ချိတ်ရန်" },
  step1: { en: "Open the bot in Telegram", my: "Telegram တွင် bot ကို ဖွင့်ပါ" },
  step2a: { en: "Press ", my: "" },
  step2b: { en: "", my: " ကို နှိပ်ပါ" },
  open: { en: "Open Telegram", my: "Telegram ဖွင့်ရန်" },
  waiting: { en: "Waiting for you to press Start…", my: "Start နှိပ်သည်ကို စောင့်နေသည်…" },
  cancel: { en: "Cancel", my: "မလုပ်တော့ပါ" },
});

type TelegramLink = { telegram_username: string | null; telegram_first_name: string | null; linked_at: string };

const POLL_MS = 3_000;
const CODE_TTL_MS = 10 * 60_000; // matches create_telegram_link_code()

/** Calls the telegram-link Edge Function, surfacing its own error text. */
async function callTelegramLink(action: "link" | "test"): Promise<{ url?: string; sent?: boolean }> {
  const { data, error } = await supabase.functions.invoke("telegram-link", { body: { action } });
  if (error) {
    let message = "";   // empty → the card shows its own (translated) message
    try {
      const body = await (error as { context?: Response }).context?.json();
      if (body?.error) message = body.error;
    } catch { /* keep the generic message */ }
    throw new Error(message);
  }
  return data ?? {};
}

/**
 * Connect / disconnect private Telegram shift alerts for the signed-in CEO.
 * The link itself is created server-side when the user presses Start in the
 * bot chat; this card just waits for it to appear.
 */
export default function TelegramAlertsCard() {
  const t = useT();
  const { user } = useAuth();
  const [link, setLink] = useState<TelegramLink | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"" | "link" | "test" | "unlink">("");
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadLink = useCallback(async () => {
    // RLS returns only the caller's own row.
    const { data } = await supabase
      .from("telegram_links")
      .select("telegram_username, telegram_first_name, linked_at")
      .maybeSingle();
    const found = (data as TelegramLink | null) ?? null;
    setLink(found);
    return found;
  }, []);

  useEffect(() => { loadLink().finally(() => setLoading(false)); }, [loadLink]);

  // While waiting for Start to be pressed in Telegram, poll until the link
  // appears or the one-time code expires.
  useEffect(() => {
    if (!pendingUrl) return;
    const startedAt = Date.now();
    const timer = setInterval(async () => {
      if (await loadLink()) {
        setPendingUrl(null);
        setNotice(t("connectedNotice"));
      } else if (Date.now() - startedAt > CODE_TTL_MS) {
        setPendingUrl(null);
        setError(t("expired"));
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [pendingUrl, loadLink, t]);

  function reset() { setError(""); setNotice(""); }

  async function connect() {
    reset();
    setBusy("link");
    try {
      const { url } = await callTelegramLink("link");
      if (url) setPendingUrl(url);
    } catch (e) {
      setError((e as Error).message || t("unreachable"));
    } finally {
      setBusy("");
    }
  }

  async function sendTest() {
    reset();
    setBusy("test");
    try {
      await callTelegramLink("test");
      setNotice(t("testSent"));
    } catch (e) {
      setError((e as Error).message || t("unreachable"));
    } finally {
      setBusy("");
    }
  }

  async function disconnect() {
    if (!user || !window.confirm(t("confirmOff"))) return;
    reset();
    setBusy("unlink");
    const { error: delErr } = await supabase.from("telegram_links").delete().eq("user_id", user.id);
    setBusy("");
    if (delErr) setError(delErr.message);
    else { setLink(null); setNotice(t("turnedOff")); }
  }

  const who = link?.telegram_username ? `@${link.telegram_username}` : link?.telegram_first_name ?? t("yourTelegram");
  const btn = "flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-50";

  return (
    <div className="bg-white border border-slate-100 rounded-xl p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${link ? "bg-emerald-500/15" : "bg-blue-500/15"}`}>
          {link
            ? <CheckCircle className="w-4 h-4 text-pale-green-foreground" />
            : <BellRing className="w-4 h-4 text-pale-blue-foreground" />}
        </div>
        <div className="flex-1 min-w-[12rem]">
          <p className="text-slate-900 font-semibold text-sm">
            {link ? <>{t("alertsOn")}<span className="font-normal text-slate-600">{who}</span></> : t("alerts")}
          </p>
          <p className="text-slate-500 text-xs mt-0.5">
            {loading
              ? t("checking")
              : link
                ? t("connectedOn", { date: new Date(link.linked_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) })
                : t("pitch")}
          </p>
        </div>

        {!loading && !pendingUrl && (
          link ? (
            <div className="flex gap-2">
              <button type="button" onClick={sendTest} disabled={!!busy}
                className={`${btn} text-slate-700 bg-slate-100 hover:bg-slate-200`}>
                {busy === "test" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} {t("sendTest")}
              </button>
              <button type="button" onClick={disconnect} disabled={!!busy}
                className={`${btn} text-pale-red-foreground hover:bg-pale-red border border-red-200`}>
                {busy === "unlink" && <Loader2 className="w-4 h-4 animate-spin" />} {t("turnOff")}
              </button>
            </div>
          ) : (
            <button type="button" onClick={connect} disabled={!!busy}
              className={`${btn} text-white bg-blue-600 hover:bg-blue-500`}>
              {busy === "link" ? <Loader2 className="w-4 h-4 animate-spin" /> : <BellRing className="w-4 h-4" />} {t("connect")}
            </button>
          )
        )}
      </div>

      {pendingUrl && (
        <div className="bg-slate-50 border border-slate-100 rounded-lg p-3 space-y-2.5">
          <ol className="text-sm text-slate-700 space-y-1 list-decimal list-inside">
            <li>{t("step1")}</li>
            <li>{t("step2a")}<span className="font-semibold">Start</span>{t("step2b")}</li>
          </ol>
          <div className="flex flex-wrap items-center gap-2">
            {/* A real link, not window.open after an await, so phones don't block it. */}
            <a href={pendingUrl} target="_blank" rel="noopener noreferrer"
              className={`${btn} text-white bg-[#229ED9] hover:opacity-90`}>
              <ExternalLink className="w-4 h-4" /> {t("open")}
            </a>
            <span className="flex items-center gap-1.5 text-xs text-slate-500">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t("waiting")}
            </span>
            <button type="button" onClick={() => setPendingUrl(null)}
              className="ml-auto text-xs font-semibold text-slate-500 hover:text-slate-900">
              {t("cancel")}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div role="alert" className="flex items-start gap-2 bg-pale-red border border-red-200 rounded-lg px-3 py-2 text-xs text-pale-red-foreground">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {error}
        </div>
      )}
      {notice && !error && <p className="text-xs text-pale-green-foreground font-medium">{notice}</p>}
    </div>
  );
}
