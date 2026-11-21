// Customer debt statement as a PDF, ready to send.
//
// Each A4 page is drawn on a canvas — the browser shapes Burmese text
// correctly, which PDF text libraries can't — and the pages are wrapped into a
// PDF by jpeg-pdf.ts. Everything here runs synchronously, so a button can build
// the file and open the phone's share sheet in the same tap.

import { jpegPagesToPdf, type PdfPage } from "./jpeg-pdf";
import { tr, type DebtKey, type DebtLang } from "./debt-i18n";
import { buildLedger, type Ledger } from "./ledger";
import { debtPayoff, type DebtPayoff } from "./debt-payoff";
import type { DebtTransaction } from "./debt-supabase";

export type StatementInput = {
  lang: DebtLang;
  name: string;
  phones: string[];
  /** yyyy-mm-dd; null = from the first transaction. */
  from: string | null;
  /** yyyy-mm-dd */
  to: string;
  ledger: Ledger;
  /** Which debt entries are paid off (debtPayoff), keyed by transaction id. */
  payoff?: Map<string, DebtPayoff>;
  now?: Date;
};

// A4 at 150 dpi.
const PAGE_W = 1240;
const PAGE_H = 1754;
const M = 80;
const ROW_H = 70;
const FOOTER_H = 110;

// Myanmar fonts straight after Inter: listed after Arial & co., a system alias for
// one of those can grab Burmese letters first and draw them in a poor fallback font.
const FONT = `Inter, "Noto Sans Myanmar", "Myanmar Text", "Myanmar Sangam MN", Padauk, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;
const C = {
  text: "#0f172a", muted: "#64748b", faint: "#94a3b8", line: "#e2e8f0", band: "#f8fafc",
  red: "#dc2626", green: "#059669", dark: "#1e293b",
};

// Column right/left edges (px)
const COL = { date: M, desc: M + 215, debitR: 800, creditR: 975, balanceR: PAGE_W - M };

const num = (v: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(v);
const fmtDay = (iso: string) => {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00`) : new Date(iso);
  return d.toLocaleDateString("en-GB", { timeZone: "Asia/Yangon", day: "2-digit", month: "short", year: "numeric" });
};
const fmtStamp = (d: Date) =>
  d.toLocaleString("en-GB", { timeZone: "Asia/Yangon", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

function graphemes(s: string): string[] {
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter;
  return Seg ? Array.from(new Seg(undefined, { granularity: "grapheme" }).segment(s), x => x.segment) : Array.from(s);
}

/** Cut text to fit `max` px, ending in "…" — never splitting a Burmese syllable cluster. */
function fit(ctx: CanvasRenderingContext2D, s: string, max: number): string {
  if (ctx.measureText(s).width <= max) return s;
  const g = graphemes(s);
  let lo = 0, hi = g.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(g.slice(0, mid).join("") + "…").width <= max) lo = mid; else hi = mid - 1;
  }
  return g.slice(0, lo).join("") + "…";
}

type Line = { kind: "opening" | "row" | "totals" | "closing"; i?: number };

/** Draws the statement pages. Exported for tests; most callers want statementPdf(). */
export function drawStatementPages(input: StatementInput, makeCanvas: () => HTMLCanvasElement = () => document.createElement("canvas")): HTMLCanvasElement[] {
  const { lang, ledger } = input;
  const t = (k: DebtKey, v?: Record<string, string | number>) => tr(lang, k, v);
  const now = input.now ?? new Date();
  const describe = (d: string) => d === "Payment" ? t("payment") : d === "Debt Entry" ? t("debtEntry") : d;

  const lines: Line[] = [{ kind: "opening" }, ...ledger.rows.map((_, i) => ({ kind: "row" as const, i })), { kind: "totals" }, { kind: "closing" }];

  // Split rows across pages: the first page carries the full header.
  const firstTop = 600, nextTop = 250;
  const bottom = PAGE_H - FOOTER_H;
  const pages: Line[][] = [];
  let at = 0;
  while (at < lines.length) {
    const top = pages.length === 0 ? firstTop : nextTop;
    const fitN = Math.max(1, Math.floor((bottom - top) / ROW_H));
    pages.push(lines.slice(at, at + fitN));
    at += fitN;
  }

  return pages.map((pageLines, p) => {
    const cv = makeCanvas();
    cv.width = PAGE_W;
    cv.height = PAGE_H;
    const ctx = cv.getContext("2d")!;
    const font = (size: number, weight = 400, italic = false) => { ctx.font = `${italic ? "italic " : ""}${weight} ${size}px ${FONT}`; };
    const text = (s: string, x: number, y: number, align: CanvasTextAlign = "left", color = C.text) => {
      ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(s, x, y);
    };
    const hline = (y: number, color = C.line, w = 2) => { ctx.fillStyle = color; ctx.fillRect(M, y, PAGE_W - 2 * M, w); };

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    ctx.textBaseline = "alphabetic";

    let y: number;
    if (p === 0) {
      // Title
      // Burmese letters reach well below the line, so the subtitle sits lower than Latin text would need.
      font(42, 700); text(t("ledgerTitle"), PAGE_W / 2, M + 46, "center");
      font(24); text("STM Financial", PAGE_W / 2, M + 106, "center", C.muted);
      hline(M + 132, C.dark, 3);

      // Who / when
      const colW = (PAGE_W - 2 * M) / 3;
      const info: [string, string][] = [
        [t("customerName"), input.name],
        [t("phoneNumber"), input.phones.length ? input.phones.join(", ") : "—"],
        [t("statementPeriod"), t("periodRange", { from: input.from ? fmtDay(input.from) : "—", to: fmtDay(input.to) })],
      ];
      info.forEach(([label, value], i) => {
        const x = M + i * colW;
        font(20, 600); text(label, x, M + 180, "left", C.muted);
        // Shrink a long value (the period) before cutting it short.
        let size = 26;
        font(size, 600);
        while (size > 18 && ctx.measureText(value).width > colW - 24) font(--size, 600);
        text(fit(ctx, value, colW - 24), x, M + 220);
      });

      // Summary boxes
      const boxY = M + 260, boxH = 150, gap = 24, boxW = (PAGE_W - 2 * M - 2 * gap) / 3;
      const boxes: [string, string, string, boolean][] = [
        [t("debitMMK"), num(ledger.totalDebit), C.red, false],
        [t("creditMMK"), num(ledger.totalCredit), C.green, false],
        [t("closingBalance"), num(ledger.closingBalance), ledger.closingBalance > 0 ? C.red : C.green, true],
      ];
      boxes.forEach(([label, value, color, strong], i) => {
        const x = M + i * (boxW + gap);
        ctx.fillStyle = strong ? "#fef2f2" : C.band;
        if (strong && ledger.closingBalance <= 0) ctx.fillStyle = "#ecfdf5";
        if (typeof ctx.roundRect === "function") { ctx.beginPath(); ctx.roundRect(x, boxY, boxW, boxH, 18); ctx.fill(); }
        else ctx.fillRect(x, boxY, boxW, boxH);   // older iPhones
        font(20, 600); text(fit(ctx, label, boxW - 48), x + 24, boxY + 46, "left", C.muted);
        font(strong ? 44 : 38, 700); text(fit(ctx, value, boxW - 48), x + 24, boxY + 112, "left", color);
      });
      y = firstTop - 70;
    } else {
      font(26, 700); text(input.name, M, M + 40);
      font(20); text(t("ledgerTitle"), PAGE_W - M, M + 40, "right", C.muted);
      hline(M + 70, C.dark, 3);
      y = nextTop - 70;
    }

    // Table header — a long heading shrinks to fit its column before being cut
    const head = (s: string, x: number, max: number, align: CanvasTextAlign) => {
      let size = 19;
      font(size, 700);
      while (size > 14 && ctx.measureText(s).width > max) font(--size, 700);
      text(fit(ctx, s, max), x, y + 40, align, C.muted);
    };
    head(t("date"), COL.date, COL.desc - COL.date - 16, "left");
    head(t("description"), COL.desc, 300, "left");
    head(t("debitMMK"), COL.debitR, 160, "right");
    head(t("creditMMK"), COL.creditR, 160, "right");
    head(t("runningBalanceMMK"), COL.balanceR, 170, "right");
    hline(y + ROW_H - 2);
    y += ROW_H;

    for (const line of pageLines) {
      const base = y + 38;
      if (line.kind === "opening" || line.kind === "totals") {
        ctx.fillStyle = C.band; ctx.fillRect(M, y, PAGE_W - 2 * M, ROW_H);
        font(22, 400, true);
        if (line.kind === "opening") {
          text(t("openingBalance"), COL.desc, base, "left", C.muted);
          font(22, 600); text(num(ledger.openingBalance), COL.balanceR, base, "right", C.muted);
        } else {
          text(t("periodTotals"), COL.desc, base, "left", C.muted);
          font(22, 600);
          if (ledger.totalDebit) text(num(ledger.totalDebit), COL.debitR, base, "right", C.red);
          if (ledger.totalCredit) text(num(ledger.totalCredit), COL.creditR, base, "right", C.green);
        }
      } else if (line.kind === "closing") {
        ctx.fillStyle = "#f1f5f9"; ctx.fillRect(M, y, PAGE_W - 2 * M, ROW_H);
        hline(y, C.dark, 3);
        font(24, 700); text(t("closingBalance"), COL.date + 12, base, "left");
        text(num(ledger.closingBalance), COL.balanceR, base, "right", ledger.closingBalance > 0 ? C.red : C.green);
      } else {
        const r = ledger.rows[line.i!];
        const po = r.id ? input.payoff?.get(r.id) : undefined;
        font(21); text(fmtDay(r.date), COL.date, base, "left", C.muted);
        font(22); text(fit(ctx, describe(r.description), COL.debitR - 175 - COL.desc), COL.desc, base, "left", po?.paidOff ? C.faint : C.text);
        if (r.debit) {
          font(23, 600);
          const s = num(r.debit);
          text(s, COL.debitR, base, "right", po?.paidOff ? C.faint : C.red);
          if (po?.paidOff) {
            const w = ctx.measureText(s).width;
            ctx.fillStyle = C.faint; ctx.fillRect(COL.debitR - w, base - 8, w, 2.5);
            font(16, 700); text(`✓ ${t("paidOff")}`, COL.debitR, base + 24, "right", C.green);
          } else if (po?.partly) {
            font(16, 600); text(t("leftAmt", { a: num(po.left) }), COL.debitR, base + 24, "right", C.red);
          }
        }
        if (r.credit) { font(23, 600); text(num(r.credit), COL.creditR, base, "right", C.green); }
        font(23, 700); text(num(r.balance), COL.balanceR, base, "right", r.balance > 0 ? C.text : C.green);
      }
      hline(y + ROW_H - 1, C.line, 1);
      y += ROW_H;
    }

    if (ledger.rows.length === 0 && p === 0) {
      // Opening + totals + closing only: say so under the table.
      font(20, 400, true); text(t("noTxnsInPeriod"), PAGE_W / 2, y + 50, "center", C.faint);
    }

    // Footer
    hline(PAGE_H - FOOTER_H + 20, C.line, 1);
    font(18); text(fmtStamp(now), M, PAGE_H - FOOTER_H + 60, "left", C.faint);
    text(`${p + 1} / ${pages.length}`, PAGE_W - M, PAGE_H - FOOTER_H + 60, "right", C.faint);
    return cv;
  });
}

function canvasJpeg(cv: HTMLCanvasElement): PdfPage {
  const b64 = cv.toDataURL("image/jpeg", 0.9).split(",")[1];
  const bin = atob(b64);
  const jpeg = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) jpeg[i] = bin.charCodeAt(i);
  return { jpeg, width: cv.width, height: cv.height };
}

/** The statement as a PDF file, named after the customer and the date. */
export function statementPdf(input: StatementInput): File {
  const now = input.now ?? new Date();
  const pages = drawStatementPages({ ...input, now }).map(canvasJpeg);
  const title = `${tr(input.lang, "ledgerTitle")} — ${input.name}`;
  const bytes = jpegPagesToPdf(pages, title, now);
  const day = now.toLocaleDateString("en-CA", { timeZone: "Asia/Yangon" });
  // Plain ASCII only: browsers drop a download name with Burmese letters (it becomes "download").
  // The customer's name is inside the PDF and in the share title.
  const latin = input.name.normalize("NFKD").replace(/[^\x20-\x7E]/g, "").trim()
    .replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "");
  return new File([bytes], `STM-Statement-${latin ? `${latin}-` : ""}${day}.pdf`, { type: "application/pdf" });
}

/**
 * Phones and tablets: open the share sheet (Viber, Telegram, Messenger…).
 * Computers, or where sharing files isn't supported: download the file.
 * Call straight from the tap handler — sharing needs the tap.
 */
export function sendFile(file: File, title: string): "share" | "download" {
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (coarse && nav.canShare?.({ files: [file] })) {
    nav.share({ files: [file], title }).catch(err => {
      if ((err as DOMException)?.name !== "AbortError") download(file);   // closing the sheet isn't an error
    });
    return "share";
  }
  download(file);
  return "download";
}

/** One tap: build this customer's statement for the period and send it. */
export function sendCustomerStatement(o: {
  lang: DebtLang; name: string; phones: string[];
  transactions: DebtTransaction[]; currentBalance: number;
  from: string | null; to: string;
}): "share" | "download" {
  const ledger = buildLedger(o.transactions, o.from, o.to);
  const payoff = debtPayoff(o.transactions, o.currentBalance);
  const file = statementPdf({ lang: o.lang, name: o.name, phones: o.phones, from: o.from, to: o.to, ledger, payoff });
  return sendFile(file, `${tr(o.lang, "ledgerTitle")} — ${o.name}`);
}

function download(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
