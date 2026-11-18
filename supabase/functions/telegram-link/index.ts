// CEO portal → "Connect Telegram". Called with the signed-in user's session
// (supabase.functions.invoke). Who may connect is decided by the database, not
// here: create_telegram_link_code() only succeeds for a CEO session.
//
//   POST { action: "link" } → { url: "https://t.me/<bot>?start=<one-time code>" }
//   POST { action: "test" } → test message to the caller's own linked chat
//
// Secret: TELEGRAM_BOT_TOKEN (Dashboard → Edge Functions → Secrets).

import { createClient } from "npm:@supabase/supabase-js@2";
import { tg, webhookSecret } from "../_shared/telegram.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

let botUsername: string | null = null;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token) return json({ error: "The Telegram bot isn't set up yet (TELEGRAM_BOT_TOKEN is missing)." }, 503);

  const authorization = req.headers.get("Authorization");
  if (!authorization) return json({ error: "Sign in first." }, 401);

  // Acts as the caller, so RLS and current_app_role() see their verified JWT.
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const asUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") || req.headers.get("apikey") || "", {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });

  const { action } = await req.json().catch(() => ({}));

  if (action === "link") {
    const { data: code, error } = await asUser.rpc("create_telegram_link_code");
    if (error || !code) return json({ error: "Only the CEO can connect Telegram alerts." }, 403);

    // (Re-)point the bot at our webhook so the /start reaches us. Idempotent,
    // and self-heals if the bot token is ever regenerated.
    const set = await tg(token, "setWebhook", {
      url: `${supabaseUrl}/functions/v1/telegram-webhook`,
      secret_token: await webhookSecret(token),
      allowed_updates: ["message"],
    });
    if (!set.ok) return json({ error: `Telegram rejected the bot setup: ${set.data?.description ?? set.status}` }, 502);

    if (!botUsername) {
      const me = await tg(token, "getMe", {});
      if (!me.ok) return json({ error: "Telegram rejected the bot token." }, 502);
      botUsername = me.data.result.username;
    }
    return json({ url: `https://t.me/${botUsername}?start=${code}` });
  }

  if (action === "test") {
    const { data: role } = await asUser.rpc("current_app_role");
    if (role !== "ceo") return json({ error: "Only the CEO can send a test alert." }, 403);
    // RLS returns only the caller's own link.
    const { data: link } = await asUser.from("telegram_links").select("chat_id").maybeSingle();
    if (!link) return json({ error: "Telegram isn't connected for your account." }, 404);
    const sent = await tg(token, "sendMessage", {
      chat_id: link.chat_id,
      text: "✅ Test from STM Financial — shift alerts will arrive in this chat.",
    });
    return sent.ok ? json({ sent: true }) : json({ error: sent.data?.description ?? "Telegram refused the message." }, 502);
  }

  return json({ error: "unknown action" }, 400);
});
