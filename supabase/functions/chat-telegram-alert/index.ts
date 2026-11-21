// Telegram alerts from STM Team Chat — only for day-off requests and
// emergencies. Ordinary chat messages never alert anyone.
//
// Called by the chat_messages AFTER INSERT trigger (pg_net) with
// { message_id }; the trigger only fires for those two kinds. Nothing in the
// request is trusted beyond that id: the row is re-read with the service role,
// and claimed by setting telegram_sent_at, so calling this again sends nothing.
//
// The reason / details are end-to-end encrypted, so they're never included;
// the dates and the emergency type are readable on purpose, for this alert.

import { adminClient, json, CORS } from "../_shared/admin.ts";
import { tg } from "../_shared/telegram.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EMERGENCY: Record<string, string> = {
  fire: "🔥 Fire",
  fuel_leak: "⛽ Fuel leak / spill",
  accident: "🚑 Accident / injury",
  robbery: "🚨 Robbery / theft",
  equipment: "⚡ Power / pump failure",
  other: "❗ Other emergency",
};

const day = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token) return json({ skipped: "no bot token" });

  const { message_id } = await req.json().catch(() => ({}));
  if (typeof message_id !== "string" || !UUID_RE.test(message_id)) return json({ error: "message_id required" }, 400);

  const admin = adminClient();

  // Claim it: only the first call for a request gets a row back.
  const { data: msg, error } = await admin
    .from("chat_messages")
    .update({ telegram_sent_at: new Date().toISOString() })
    .eq("id", message_id)
    .in("kind", ["leave", "emergency"])
    .is("telegram_sent_at", null)
    .select("id, created_at, sender_id, sender_name, sender_role, kind, leave_from, leave_to, emergency_type, ciphertext")
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!msg) return json({ skipped: "not a request, already sent, or not found" });

  const [{ data: recipients }, { data: ownLinks }] = await Promise.all([
    admin.rpc("shift_alert_recipients"),
    msg.sender_id
      ? admin.from("telegram_links").select("chat_id").eq("user_id", msg.sender_id)
      : Promise.resolve({ data: [] as { chat_id: number }[] }),
  ]);
  const skip = new Set((ownLinks ?? []).map((l: { chat_id: number }) => String(l.chat_id)));
  const chatIds = (recipients ?? [])
    .map((r: { chat_id: number }) => r.chat_id)
    .filter((id: number) => !skip.has(String(id)));
  if (!chatIds.length) return json({ sent: 0 });

  const who = `${msg.sender_name}${msg.sender_role === "ceo" ? " (Owner)" : ""}`;
  const at = new Date(msg.created_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Yangon" });
  const portal = (Deno.env.get("PORTAL_URL") || "https://powerstm.netlify.app").replace(/\/$/, "");
  const reply_markup = { inline_keyboard: [[{ text: "Open team chat", url: `${portal}/chat` }]] };

  let text: string;
  if (msg.kind === "emergency") {
    text = [
      `🆘 EMERGENCY: ${EMERGENCY[msg.emergency_type] ?? EMERGENCY.other}`,
      `👤 ${who}`,
      `🕒 ${at}`,
      "",
      msg.ciphertext ? "Open Team Chat for the details (end-to-end encrypted)." : "Open Team Chat now.",
    ].join("\n");
  } else {
    const n = Math.round((Date.parse(msg.leave_to) - Date.parse(msg.leave_from)) / 86_400_000) + 1;
    const range = msg.leave_from === msg.leave_to ? day(msg.leave_from) : `${day(msg.leave_from)} – ${day(msg.leave_to)}`;
    text = [
      "🗓 Day-off request",
      `👤 ${who}`,
      `📅 ${range} (${n} day${n === 1 ? "" : "s"})`,
      "",
      "Approve or decline it in Team Chat.",
    ].join("\n");
  }

  let sent = 0;
  await Promise.all(chatIds.map(async (chat_id: number) => {
    const res = await tg(token, "sendMessage", { chat_id, text, reply_markup }).catch(() => null);
    if (res?.ok) sent++;
  }));

  return json({ sent });
});
