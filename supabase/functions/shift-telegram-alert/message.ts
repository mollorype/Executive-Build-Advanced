// Pure formatting for the shift alert — no I/O, so it can be tested outside Deno.

export const RED_FLAG_MMK = 10_000; // same threshold as the CEO portal's RED_FLAG_THRESHOLD
export const TZ = "Asia/Yangon";

export interface ShiftRow {
  id: string;
  employee_name?: string | null;
  timestamp?: string | null;
  expected_total?: number | string | null;
  total_expenses?: number | string | null;
  actual_cash?: number | string | null;
  variance?: number | string | null;
}

const num = (v: unknown) => Number(v) || 0;
const mmk = (v: number) => new Intl.NumberFormat("en-US").format(Math.round(Math.abs(v))) + " MMK";
const signed = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "") + mmk(v);
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The Yangon calendar day (UTC+06:30, no DST) containing `iso`, as [start, end) instants. */
export function yangonDayBounds(iso: string): { start: string; end: string } {
  const day = new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ }); // YYYY-MM-DD
  const start = new Date(`${day}T00:00:00+06:30`);
  return { start: start.toISOString(), end: new Date(start.getTime() + 86_400_000).toISOString() };
}

/** Telegram sendMessage fields (minus chat_id) for one shift. */
export function buildShiftMessage(s: ShiftRow, sameDayCount: number, portalUrl: string) {
  const diff = num(s.variance); // actual cash − expected; negative = cash short
  const expenses = num(s.total_expenses);
  const cashSales = num(s.expected_total) + expenses; // STM Daily stores expected_total net of expenses
  const redFlag = Math.abs(diff) >= RED_FLAG_MMK;
  const when = new Date(s.timestamp ?? Date.now()).toLocaleString("en-GB", {
    timeZone: TZ, day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });

  const lines = [
    redFlag
      ? `🚨 <b>RED FLAG — cash ${diff < 0 ? "SHORT" : "OVER"} ${mmk(diff)}</b>`
      : "✅ <b>Shift submitted</b>",
    "",
    `👤 ${esc(s.employee_name) || "—"}`,
    `🕒 ${when}`,
    "",
    `Cash sales: ${mmk(cashSales)}`,
    `Expenses: ${mmk(expenses)}`,
    `Cash counted: ${mmk(num(s.actual_cash))}`,
    `Difference: <b>${signed(diff)}</b>`,
  ];
  if (sameDayCount > 1) {
    lines.push("", `⚠️ Submission #${sameDayCount} for this day — only one shift a day is expected.`);
  }

  const link = `${portalUrl.replace(/\/+$/, "")}/shifts?shift=${encodeURIComponent(s.id)}`;
  return {
    text: lines.join("\n"),
    parse_mode: "HTML" as const,
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: [[{ text: "View shift details", url: link }]] },
  };
}
