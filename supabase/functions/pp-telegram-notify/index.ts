// P-P Ledger → owners' Telegram.
//
//   { "event": "archived", "id": <pp_archive id> }
//       Sent by the pp_archive_notify trigger when an accountant or manager
//       deletes a P-P line or undoes a shift deduction (with their reason).
//   { "event": "profit_report" }
//       Sent every morning by pg_cron. Sends last week's / last month's profit
//       when that is switched on in STM Financial → Settings and one is due.
//
// Nothing in the request is trusted beyond an id: the row is re-read with the
// service-role key and claimed before sending, so each notice goes out at
// most once and a stray call can't invent or repeat one.
// Recipients: shift_alert_recipients() — connected chats of current owners.
//
// Secrets: TELEGRAM_BOT_TOKEN; PORTAL_URL optional (https://powerstm.netlify.app).

import { createClient } from "npm:@supabase/supabase-js@2";
import { tg } from "../_shared/telegram.ts";
import { buildArchiveMessage, buildReportMessage, reportPeriod, type ArchiveRow, type Profit } from "./message.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const body = await req.json().catch(() => null) as { event?: unknown; id?: unknown } | null;
  const event = body?.event;
  if (event !== "archived" && event !== "profit_report") return json({ error: "bad event" }, 400);

  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token) return json({ error: "TELEGRAM_BOT_TOKEN not set" }, 500);
  const portal = Deno.env.get("PORTAL_URL") || "https://powerstm.netlify.app";
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  const { data: recipients, error: recErr } = await db.rpc("shift_alert_recipients");
  if (recErr) return json({ error: recErr.message }, 500);
  const chatIds: number[] = (recipients ?? []).map((r: { chat_id: number }) => r.chat_id);

  async function send(text: string, release: () => Promise<unknown>) {
    const results = await Promise.all(chatIds.map(chat_id => tg(token!, "sendMessage", { chat_id, text })));
    const gone = chatIds.filter((_, i) => results[i].status === 403);   // blocked the bot: stop trying them
    if (gone.length) await db.from("telegram_links").delete().in("chat_id", gone);
    const sent = results.filter(r => r.ok).length;
    if (sent === 0) {
      await release();   // so it can be sent again once fixed
      return json({ error: "telegram refused every recipient", details: results.map(r => r.data?.description) }, 502);
    }
    return json({ sent, of: chatIds.length });
  }

  if (event === "archived") {
    const id = body?.id;
    if (typeof id !== "string" || !UUID_RE.test(id)) return json({ error: "bad id" }, 400);
    if (chatIds.length === 0) return json({ skipped: "no owner has connected Telegram" });
    // Claim: only a row that should be announced and hasn't been yet.
    const { data: rows, error } = await db.from("pp_archive")
      .update({ notified_at: new Date().toISOString() })
      .eq("id", id).eq("notify", true).is("notified_at", null)
      .select("kind, summary, snapshot, reason, archived_by, actor_role, archived_at");
    if (error) return json({ error: error.message }, 500);
    if (!rows?.length) return json({ skipped: "not found or already sent" });
    return send(buildArchiveMessage(rows[0] as ArchiveRow),
      () => db.from("pp_archive").update({ notified_at: null }).eq("id", id));
  }

  // profit_report
  const { data: cfg, error: cfgErr } = await db.from("pp_settings").select("profit_report").maybeSingle();
  if (cfgErr) return json({ error: cfgErr.message }, 500);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Yangon" });
  const due = reportPeriod(today, cfg?.profit_report ?? "off");
  if (!due) return json({ skipped: "no report due today" });
  if (chatIds.length === 0) return json({ skipped: "no owner has connected Telegram" });
  const { error: claimErr } = await db.from("pp_report_sent").insert({ period: due.key });
  if (claimErr) return claimErr.code === "23505" ? json({ skipped: "already sent" }) : json({ error: claimErr.message }, 500);
  const { data: profit, error: pErr } = await db.rpc("pp_profit_calc", { p_from: due.from, p_to: due.to });
  if (pErr || !profit) {
    await db.from("pp_report_sent").delete().eq("period", due.key);
    return json({ error: pErr?.message ?? "no profit data" }, 500);
  }
  return send(buildReportMessage(profit as Profit, due.from, due.to, portal),
    () => db.from("pp_report_sent").delete().eq("period", due.key));
});
