// Forwards each new STM Team Chat message to the CEOs on Telegram.
//
// Called by the chat_messages AFTER INSERT trigger (pg_net) with
// { message_id }. Nothing in the request is trusted beyond that id: the
// message is re-read with the service role, and claimed by setting
// telegram_sent_at, so calling this again for the same message sends nothing.

import { adminClient, json, CORS } from "../_shared/admin.ts";
import { tg } from "../_shared/telegram.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token) return json({ skipped: "no bot token" });

  const { message_id } = await req.json().catch(() => ({}));
  if (typeof message_id !== "string" || !UUID_RE.test(message_id)) return json({ error: "message_id required" }, 400);

  const admin = adminClient();

  // Claim it: only the first call for a message gets a row back.
  const { data: msg, error } = await admin
    .from("chat_messages")
    .update({ telegram_sent_at: new Date().toISOString() })
    .eq("id", message_id)
    .is("telegram_sent_at", null)
    .select("id, sender_id, sender_name, sender_role, body, photo_path")
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!msg) return json({ skipped: "already sent or not found" });

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

  const who = `${msg.sender_name}${msg.sender_role === "ceo" ? " (CEO)" : ""}`;
  const portal = (Deno.env.get("PORTAL_URL") || "https://powerstm.netlify.app").replace(/\/$/, "");
  const reply_markup = { inline_keyboard: [[{ text: "Open team chat", url: `${portal}/chat` }]] };

  // Photos are sent as photos through a link that works for 10 minutes —
  // long enough for Telegram to fetch it once.
  let photoUrl: string | null = null;
  if (msg.photo_path) {
    const { data } = await admin.storage.from("chat-photos").createSignedUrl(msg.photo_path, 600);
    photoUrl = data?.signedUrl ?? null;
  }

  let sent = 0;
  await Promise.all(chatIds.map(async (chat_id: number) => {
    let res;
    if (photoUrl) {
      const caption = clip(`💬 ${who} — STM Team Chat${msg.body ? `\n\n${msg.body}` : ""}`, 1000);
      res = await tg(token, "sendPhoto", { chat_id, photo: photoUrl, caption, reply_markup }).catch(() => null);
    }
    if (!res?.ok) {
      const text = clip(`💬 ${who} — STM Team Chat\n\n${msg.body ?? ""}${msg.photo_path ? `${msg.body ? "\n" : ""}📷 Photo` : ""}`, 3500);
      res = await tg(token, "sendMessage", { chat_id, text, reply_markup }).catch(() => null);
    }
    if (res?.ok) sent++;
  }));

  return json({ sent });
});
