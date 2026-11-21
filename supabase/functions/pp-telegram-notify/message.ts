// Pure helpers for pp-telegram-notify (no I/O), so they can be tested alone.

export type ArchiveRow = {
  kind: "movement" | "shift";
  summary: string;
  snapshot: Record<string, unknown>;
  reason: string;
  archived_by: string | null;
  actor_role: string | null;
  archived_at: string;
};

const KIND: Record<string, string> = {
  buy: "ဝယ် / Buy",
  borrow: "ချေးယူ / Borrow",
  borrow_returned: "ချေးယူတာ ပြန်ပေး / Returned borrowed",
  borrow_paid: "ချေးယူတာ ငွေနဲ့ ရှင်း / Paid cash for borrowed",
  lend: "ချေးပေး / Lend",
  lend_returned: "ချေးပေးတာ ပြန်ရ / Got back",
  lend_paid: "ချေးပေးတာ ငွေရ / They paid cash",
  used: "သုံးစွဲ (မရောင်း) / Used (not sold)",
  adjust: "လက်ကျန် စစ် / Stock count",
};
const ROLE: Record<string, string> = { ceo: "Owner", accountant: "Accountant", manager: "Manager" };

const num = (v: unknown) => Number(v) || 0;
const fmt = (n: number, d = 0) => new Intl.NumberFormat("en-US", { maximumFractionDigits: d }).format(n);
export const mmk = (n: number) => `${fmt(Math.round(n))} MMK`;

/** One deleted P-P line or undone shift deduction, for the owners. */
export function buildArchiveMessage(a: ArchiveRow): string {
  const who = `${a.archived_by ?? "—"}${a.actor_role ? ` (${ROLE[a.actor_role] ?? a.actor_role})` : ""}`;
  let what = a.summary;
  if (a.kind === "movement") {
    const s = a.snapshot;
    const pipas = num(s.pipas);
    const station = typeof s.station_name === "string" && s.station_name ? ` · ${s.station_name}` : "";
    const price = s.unit_price != null && s.price_mode
      ? ` · ${mmk(num(s.unit_price))}/${s.price_mode === "per_pipa" ? "P-P" : "L"}` : "";
    what = `${KIND[String(s.kind)] ?? String(s.kind)}\n${pipas > 0 && s.kind === "adjust" ? "+" : ""}${fmt(pipas, 3)} P-P · ${String(s.product)}${station}${price} · ${String(s.occurred_on)}`;
  } else {
    what = `ဆိုင်း ရောင်းအား နုတ်ချက် ပြန်ဖျက် / Shift deduction undone\n${a.summary.replace(/^Shift sales deduction · /, "")}`;
  }
  return `🗑 P-P စာရင်းမှ ဖျက်သည် / Deleted from the P-P Ledger\n\n${what}\n\nအကြောင်းပြချက် / Reason: ${a.reason}\nဖျက်သူ / By: ${who}`;
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/**
 * Which report is due on `today` (YYYY-MM-DD, Yangon): weekly on Mondays for
 * the week before (Mon–Sun), monthly on the 1st for the month before.
 */
export function reportPeriod(today: string, mode: string): { key: string; from: string; to: string } | null {
  const d = new Date(`${today}T00:00:00Z`);
  if (isNaN(d.getTime())) return null;
  if (mode === "weekly" && d.getUTCDay() === 1) {
    const from = new Date(d); from.setUTCDate(d.getUTCDate() - 7);
    const to = new Date(d); to.setUTCDate(d.getUTCDate() - 1);
    return { key: `week:${iso(from)}`, from: iso(from), to: iso(to) };
  }
  if (mode === "monthly" && d.getUTCDate() === 1) {
    const from = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
    const to = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0));
    return { key: `month:${iso(from).slice(0, 7)}`, from: iso(from), to: iso(to) };
  }
  return null;
}

type Totals = { liters: number; revenue: number; cost: number; settle: number; loss: number; used: number; unpriced: number; profit: number };
type ProductRow = { product: string; liters: number; revenue: number; cost: number; profit: number };
export type Profit = { totals: Totals; products: ProductRow[] };

const FUEL: Record<string, string> = { "92": "92", "95": "95", PD: "PD", D: "Diesel" };
const day = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });

/** The weekly / monthly profit report. */
export function buildReportMessage(p: Profit, from: string, to: string, portal: string): string {
  const t = p.totals;
  const other = num(t.settle) + num(t.loss) + num(t.used);
  const sign = num(t.profit) >= 0 ? "+" : "−";
  const lines = [
    `📊 အမြတ် / Profit · ${day(from)} – ${day(to)}`,
    "",
    `ရောင်းရငွေ / Sales: ${mmk(num(t.revenue))} (${fmt(num(t.liters), 2)} L)`,
    `ဆီ ကုန်ကျ / Fuel cost: ${mmk(num(t.cost))}`,
  ];
  if (Math.abs(other) >= 0.5) lines.push(`လျော့ / အခြား / Losses & other: ${mmk(other)}`);
  lines.push(`အမြတ် / Profit: ${sign}${mmk(Math.abs(num(t.profit)))}`);
  const fuels = (p.products ?? []).filter(r => num(r.liters) > 0 || Math.abs(num(r.profit)) >= 0.5);
  if (fuels.length) {
    lines.push("");
    for (const r of fuels) lines.push(`• ${FUEL[r.product] ?? r.product}: ${fmt(num(r.liters), 2)} L · ${num(r.profit) >= 0 ? "+" : "−"}${mmk(Math.abs(num(r.profit)))}`);
  }
  if (num(t.unpriced) > 0) lines.push("", `⚠️ ${fmt(num(t.unpriced), 2)} L ဝယ်စျေး မရှိ / sold without a purchase price`);
  lines.push("", `${portal}/profit`);
  return lines.join("\n");
}
