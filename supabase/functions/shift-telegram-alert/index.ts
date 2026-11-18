// STM Daily → Telegram: one message for every submitted shift, flagged 🚨 when
// the cash difference is ≥ 10,000 MMK, with a button that opens the shift in
// the CEO portal.
//
// Called by the `shift_telegram_alert` trigger on daily_sales_reports
// (supabase/migrations/*_shift_telegram_alerts.sql) with { shift_id } only.
// Nothing else in the request is trusted: the shift is re-read with the
// service-role key, then claimed in shift_telegram_notifications before
// sending, so each real shift is announced at most once and a stray call can
// neither invent a shift nor repeat one.
//
// Secrets (Dashboard → Edge Functions → Secrets):
//   TELEGRAM_BOT_TOKEN  token from @BotFather
//   TELEGRAM_CHAT_ID    chat or group that receives the alerts
//   PORTAL_URL          optional; defaults to https://powerstm.netlify.app

import { createClient } from "npm:@supabase/supabase-js@2";
import { buildShiftMessage, yangonDayBounds, type ShiftRow } from "./message.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let shiftId: unknown;
  try { shiftId = (await req.json())?.shift_id; } catch { /* rejected below */ }
  if (typeof shiftId !== "string" || !UUID_RE.test(shiftId)) return json({ error: "bad shift_id" }, 400);

  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID");
  if (!token || !chatId) return json({ error: "TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set" }, 500);
  const portal = Deno.env.get("PORTAL_URL") || "https://powerstm.netlify.app";

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  const { data: shift, error: readErr } = await db
    .from("daily_sales_reports").select("*").eq("id", shiftId).maybeSingle();
  if (readErr) return json({ error: readErr.message }, 500);
  if (!shift) return json({ error: "shift not found" }, 404);

  // Once-only gate: the primary key rejects a second claim for the same shift.
  const { error: claimErr } = await db.from("shift_telegram_notifications").insert({ shift_id: shiftId });
  if (claimErr) {
    return claimErr.code === "23505" ? json({ skipped: "already notified" }) : json({ error: claimErr.message }, 500);
  }

  // Only one shift a day is expected — count this day's submissions (Yangon time).
  const { start, end } = yangonDayBounds(shift.timestamp ?? new Date().toISOString());
  const { count } = await db
    .from("daily_sales_reports")
    .select("id", { count: "exact", head: true })
    .gte("timestamp", start)
    .lt("timestamp", end);

  const tg = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, ...buildShiftMessage(shift as ShiftRow, count ?? 1, portal) }),
  });
  if (!tg.ok) {
    // Release the claim so this shift can be re-sent once the problem is fixed.
    await db.from("shift_telegram_notifications").delete().eq("shift_id", shiftId);
    return json({ error: `telegram ${tg.status}: ${await tg.text()}` }, 502);
  }
  return json({ sent: true });
});
