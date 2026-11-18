// Receives the bot's incoming messages from Telegram. Registered by
// telegram-link with a secret header; any request without it is rejected.
//
//   /start <code>  link this private chat to the CEO account that made the code
//   /start         explain how to connect from the portal
//   /stop          unlink this chat (alerts stop)
//
// Secret: TELEGRAM_BOT_TOKEN (Dashboard → Edge Functions → Secrets).

import { createClient } from "npm:@supabase/supabase-js@2";
import { tg, webhookSecret } from "../_shared/telegram.ts";

const ok = () => new Response("ok"); // always 200 once authenticated, or Telegram re-sends the update

Deno.serve(async (req) => {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token) return new Response("not configured", { status: 503 });
  if (req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== (await webhookSecret(token))) {
    return new Response("forbidden", { status: 403 });
  }

  const update = await req.json().catch(() => null);
  const msg = update?.message;
  // Alerts are private: ignore groups/channels and anything that isn't text.
  if (!msg || msg.chat?.type !== "private" || typeof msg.text !== "string") return ok();

  const chatId: number = msg.chat.id;
  const reply = (text: string) => tg(token, "sendMessage", { chat_id: chatId, text });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const [command, arg] = msg.text.trim().split(/\s+/);

  if (command === "/start" && arg) {
    const { data: result, error } = await db.rpc("redeem_telegram_link_code", {
      p_code: arg,
      p_chat_id: chatId,
      p_username: msg.from?.username ?? null,
      p_first_name: msg.from?.first_name ?? null,
    });
    if (error) {
      await reply("Something went wrong connecting your account. Please try again from the CEO portal.");
    } else if (result === "linked") {
      await reply("✅ Connected. You'll get a message here for every shift submission, and 🚨 for red flags.\n\nSend /stop to turn alerts off.");
    } else if (result === "not_allowed") {
      await reply("This account isn't allowed to receive shift alerts.");
    } else {
      await reply("That connect link has expired or was already used. In the CEO portal, open Shifts → Connect Telegram for a new one.");
    }
  } else if (command === "/start") {
    await reply("To receive shift alerts, sign in to the CEO portal and open Shifts → Connect Telegram.");
  } else if (command === "/stop") {
    const { count } = await db.from("telegram_links").delete({ count: "exact" }).eq("chat_id", chatId);
    await reply(count ? "🔕 Shift alerts turned off. You can reconnect any time from the CEO portal." : "This chat isn't receiving any alerts.");
  } else {
    await reply("I only send shift alerts. Send /stop to turn them off.");
  }
  return ok();
});
