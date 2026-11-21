// Telegram notices for STM Daily staff (in Myanmar). Called by database
// triggers (notify_staff_telegram) with { event, id }:
//
//   salary_paid    a month's salary marked paid        → that employee
//   salary_item    a deduction / bonus / overtime / paid-back applied → that employee
//   leave_decided  their leave request approved or declined → the requester
//   emergency      an emergency alert in the team chat → every linked staff member
//   chat_message   a new team-chat message → staff who left chat notices on
//
// An owner chooses which of these staff get (STM Financial → Settings, table
// staff_notify_settings); a type that is switched off is skipped here.
//
// Each (event, id) is claimed in staff_telegram_sent first, so a notice goes out
// once however often this is called. Chat notices never include the message:
// the chat is end-to-end encrypted. Salary notices reach the employee whose
// Salary profile has their STM Daily email (employee_salary_pool.staff_email).
//
// Secret: TELEGRAM_BOT_TOKEN.

import { createClient } from "npm:@supabase/supabase-js@2";
import { tg } from "../_shared/telegram.ts";

const DAILY_URL = "https://shwethazinmoe.netlify.app";
const EVENTS = new Set(["salary_paid", "salary_item", "leave_decided", "emergency", "chat_message"]);
// Used until staff_notify_settings exists (same defaults as the table).
const DEFAULT_ON: Record<string, boolean> = { salary_paid: true, salary_item: true, emergency: true, chat_message: true, leave_decided: false };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTHS = ["ဇန်နဝါရီ", "ဖေဖော်ဝါရီ", "မတ်", "ဧပြီ", "မေ", "ဇွန်", "ဇူလိုင်", "ဩဂုတ်", "စက်တင်ဘာ", "အောက်တိုဘာ", "နိုဝင်ဘာ", "ဒီဇင်ဘာ"];
// Same labels as the chat's EMERGENCY_TYPES (team-chat-core.ts).
const EMERGENCY_MY: Record<string, string> = {
  fire: "🔥 မီးလောင်မှု", fuel_leak: "⛽ ဆီယိုစိမ့်မှု", accident: "🚑 မတော်တဆမှု / ဒဏ်ရာ",
  robbery: "🚨 လုယက်မှု / ခိုးမှု", equipment: "⚡ မီးပျက် / စက်ချို့ယွင်း", other: "❗ အခြား အရေးပေါ်",
};

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const mmk = (v: unknown) => `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Number(v) || 0)} ကျပ်`;
const monthMy = (m: string) => { const [y, mo] = m.split("-").map(Number); return `${y} ${MONTHS[mo - 1]}`; };
const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token) return json({ skipped: "no bot token" });

  const { event, id } = await req.json().catch(() => ({}));
  if (!EVENTS.has(event) || typeof id !== "string" || !UUID.test(id)) return json({ error: "bad request" }, 400);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  // Switched off by an owner? Then nothing to send (and nothing to claim).
  const { data: cfg } = await db.from("staff_notify_settings").select("*").maybeSingle();
  if (!(cfg ? cfg[event] === true : DEFAULT_ON[event])) return json({ skipped: "turned off" });

  // Claim it: only the first call for this (event, id) sends anything.
  const claim = await db.from("staff_telegram_sent").insert({ event, ref_id: id });
  if (claim.error) return json({ skipped: claim.error.code === "23505" ? "already sent" : claim.error.message });

  const send = (chatIds: number[], text: string) => Promise.all(chatIds.map(chat_id => tg(token, "sendMessage", {
    chat_id, text,
    reply_markup: { inline_keyboard: [[{ text: "STM Daily ဖွင့်ရန်", url: DAILY_URL }]] },
  }).catch(() => null)));
  const chatsFor = async (rpc: string, args: Record<string, unknown>) =>
    ((await db.rpc(rpc, args)).data ?? []).map((r: { chat_id: number }) => Number(r.chat_id));
  const staffEmail = async (profileId: string) =>
    (await db.from("employee_salary_pool").select("staff_email").eq("profile_id", profileId).maybeSingle()).data?.staff_email as string | null;

  if (event === "salary_paid") {
    const { data: p } = await db.from("employee_salary_payments").select("*").eq("id", id).maybeSingle();
    if (!p) return json({ skipped: "gone" });
    const email = await staffEmail(p.profile_id);
    if (!email) return json({ skipped: "no staff email" });
    const lines = [
      `💰 ${monthMy(p.salary_month)} လစာ ပေးပြီးပါပြီ`,
      "",
      `အခြေခံ လစာ  ${mmk(p.base)}`,
      ...(Number(p.overtime) ? [`+ အချိန်ပိုကြေး  ${mmk(p.overtime)}`] : []),
      ...(Number(p.bonus) ? [`+ ဆုကြေး  ${mmk(p.bonus)}`] : []),
      ...(Number(p.refund) ? [`+ ပြန်ပေးငွေ  ${mmk(p.refund)}`] : []),
      ...(Number(p.deductions) ? [`− နုတ်ငွေ  ${mmk(p.deductions)}`] : []),
      "",
      `ရရှိငွေ  ${mmk(p.net)}`,
    ];
    await send(await chatsFor("staff_chat_for_email", { p_email: email }), lines.join("\n"));
    return json({ sent: event });
  }

  if (event === "salary_item") {
    const { data: i } = await db.from("employee_salary_items").select("*").eq("id", id).maybeSingle();
    if (!i || i.status !== "applied") return json({ skipped: "not applied" });
    const email = await staffEmail(i.profile_id);
    if (!email) return json({ skipped: "no staff email" });
    const note = i.source === "daily_app" ? String(i.label ?? "").split(" — ")[0] : String(i.label ?? "");
    const extra = note && note !== "Payment via Daily Shift" ? `\n“${note}”` : "";
    const month = monthMy(i.salary_month);
    const text = i.type === "Deduction" ? `➖ ${month} လစာမှ ${mmk(i.amount)} နုတ်ပြီး (${day(i.date)})${extra}`
      : i.type === "Bonus" ? `🎁 ဆုကြေး +${mmk(i.amount)} — ${month} လစာတွင် ပေါင်းပြီး${extra}`
      : i.type === "Overtime" ? `⏱ အချိန်ပိုကြေး +${mmk(i.amount)} — ${month} လစာတွင် ပေါင်းပြီး${extra}`
      : `↩️ ပြန်ပေးငွေ +${mmk(i.amount)} — ${month} လစာတွင် ပေါင်းပြီး${extra}`;
    await send(await chatsFor("staff_chat_for_email", { p_email: email }), text);
    return json({ sent: event });
  }

  const { data: m } = await db.from("chat_messages").select("sender_id, sender_name, kind, status, leave_from, leave_to, emergency_type, decided_by_name").eq("id", id).maybeSingle();
  if (!m) return json({ skipped: "gone" });

  if (event === "leave_decided") {
    if (!m.sender_id || !["approved", "declined"].includes(m.status)) return json({ skipped: "not decided" });
    const range = m.leave_from === m.leave_to ? day(m.leave_from) : `${day(m.leave_from)} – ${day(m.leave_to)}`;
    const text = m.status === "approved"
      ? `✅ ခွင့် ${range} ကို ခွင့်ပြုပြီးပါပြီ${m.decided_by_name ? ` (${m.decided_by_name})` : ""}`
      : `❌ ခွင့် ${range} ကို ခွင့်မပြုပါ${m.decided_by_name ? ` (${m.decided_by_name})` : ""}`;
    await send(await chatsFor("staff_chat_for_user", { p_user: m.sender_id }), text);
    return json({ sent: event });
  }

  const recipients = ((await db.rpc("staff_chat_recipients", { p_except: m.sender_id })).data ?? []) as { chat_id: number; notify_chat: boolean }[];
  if (event === "emergency") {
    const kind = EMERGENCY_MY[m.emergency_type] ?? "အရေးပေါ်";
    await send(recipients.map(r => Number(r.chat_id)), `🚨 အရေးပေါ် (${kind}) — ${m.sender_name}\nTeam chat ကို ချက်ချင်း ဖွင့်ကြည့်ပါ။`);
    return json({ sent: event });
  }
  // chat_message: staff can switch it off on their card; never the content (end-to-end encrypted)
  await send(recipients.filter(r => r.notify_chat).map(r => Number(r.chat_id)), `💬 ${m.sender_name} က Team chat တွင် စာ ပို့ထားသည်။`);
  return json({ sent: event });
});
