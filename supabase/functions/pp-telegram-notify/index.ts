// P-P Ledger → owners' Telegram.
//
//   { "event": "archived", "id": <pp_archive id> }
//       Sent by the pp_archive_notify trigger when an accountant or manager
//       deletes a P-P line or undoes a shift deduction (with their reason).
//   { "event": "pool_closed", "id": <pp_pools id> }
//       Sent by pp_close_pool when a manager force closes a purchase (what was
//       left is written off as a loss).
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
import { buildArchiveMessage, buildPoolMessage, buildReportMessage, reportPeriod, type ArchiveRow, type PoolLot, type PoolRow, type Profit } from "./message.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const body = await req.json().catch(() => null) as { event?: unknown; id?: unknown } | null;
  const event = body?.event;
  if (event !== "archived" && event !== "pool_closed" && event !== "profit_report") return json({ error: "bad event" }, 400);

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

  if (event === "pool_closed") {
    const id = body?.id;
    if (typeof id !== "string" || !UUID_RE.test(id)) return json({ error: "bad id" }, 400);
    if (chatIds.length === 0) return json({ skipped: "no owner has connected Telegram" });
    // Claim: a closed pool not announced yet.
    const { data: rows, error } = await db.from("pp_pools")
      .update({ notified_at: new Date().toISOString() })
      .eq("id", id).not("closed_at", "is", null).is("notified_at", null)
      .select("product, started_on, closed_at, closed_by, close_reason, close_note, close_movement_id");
    if (error) return json({ error: error.message }, 500);
    if (!rows?.length) return json({ skipped: "not found or already sent" });
    const pool = rows[0] as PoolRow & { close_movement_id: string | null };
    let liters = 0, cost: number | null = null;
    if (pool.close_movement_id) {
      const { data: lines } = await db.from("pp_cost_lines").select("liters, cost").eq("movement_id", pool.close_movement_id);
      for (const l of lines ?? []) { liters += Number(l.liters) || 0; cost = (cost ?? 0) + (Number(l.cost) || 0); }
    }
    // Which purchase it was (each purchase stands on its own).
    let lot: PoolLot | null = null;
    const { data: lots } = await db.from("pp_lots").select("source, station_id").eq("pool_id", id)
      .order("occurred_on", { ascending: true }).order("created_at", { ascending: true }).limit(1);
    if (lots?.length) {
      let station: string | null = null;
      if (lots[0].station_id) {
        const { data: st } = await db.from("pipa_stations").select("name").eq("id", lots[0].station_id).maybeSingle();
        station = (st?.name as string | undefined) ?? null;
      }
      lot = { source: String(lots[0].source), station };
    }
    const { data: cfg } = await db.from("pp_settings").select("default_pp_liters").maybeSingle();
    return send(buildPoolMessage(pool, liters, cost, Number(cfg?.default_pp_liters) || 215, lot),
      () => db.from("pp_pools").update({ notified_at: null }).eq("id", id));
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
