import type ExcelJS from "exceljs";
import { IC_ROLE_LABELS, type IcLedgerEntry } from "./home-expenses";

export interface IcLedgerRow {
  id: string;
  date: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface IcLedger {
  openingBalance: number;
  rows: IcLedgerRow[];
  closingBalance: number;
  totalDebit: number;
  totalCredit: number;
}

export function describeIcEntry(e: IcLedgerEntry): string {
  const label = IC_ROLE_LABELS[e.role];
  return e.note && e.note.trim() ? `${label} — ${e.note.trim()}` : label;
}

/** Oldest-first, matching how a ledger is read top to bottom. */
function sortChronological(entries: IcLedgerEntry[]): IcLedgerEntry[] {
  return [...entries].sort((a, b) => {
    const dateDiff = a.entry_date.localeCompare(b.entry_date);
    if (dateDiff !== 0) return dateDiff;
    return a.created_at.localeCompare(b.created_at);
  });
}

/**
 * Builds a running-balance ledger for a date range. Entries before `from`
 * are folded into the opening balance rather than dropped, so the running
 * balance always reconciles with the true cash position. Income (credit)
 * increases the balance; expense (debit, including Saving) decreases it.
 */
export function buildIcLedger(entries: IcLedgerEntry[], from: string | null, to: string | null): IcLedger {
  const sorted = sortChronological(entries);

  let openingBalance = 0;
  for (const e of sorted) {
    if (from && e.entry_date < from) {
      openingBalance += e.entry_type === "income" ? e.amount : -e.amount;
    }
  }

  let running = openingBalance;
  let totalDebit = 0;
  let totalCredit = 0;
  const rows: IcLedgerRow[] = [];

  for (const e of sorted) {
    if (from && e.entry_date < from) continue;
    if (to && e.entry_date > to) continue;
    const debit = e.entry_type === "expense" ? e.amount : 0;
    const credit = e.entry_type === "income" ? e.amount : 0;
    running += credit - debit;
    totalDebit += debit;
    totalCredit += credit;
    rows.push({ id: e.id, date: e.entry_date, description: describeIcEntry(e), debit, credit, balance: running });
  }

  return { openingBalance, rows, closingBalance: running, totalDebit, totalCredit };
}

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };
const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFD1D5DB" } },
  left: { style: "thin", color: { argb: "FFD1D5DB" } },
  bottom: { style: "thin", color: { argb: "FFD1D5DB" } },
  right: { style: "thin", color: { argb: "FFD1D5DB" } },
};
const MMK_FMT = "#,##0;[Red]-#,##0";

function excelDate(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

export async function exportIcLedgerExcel(from: string, to: string, ledger: IcLedger): Promise<void> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "STM Financial";
  wb.created = new Date();

  const ws = wb.addWorksheet("I-C Ledger", {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
    views: [{ showGridLines: false }],
  });

  ws.columns = [
    { width: 14 },
    { width: 44 },
    { width: 16 },
    { width: 16 },
    { width: 18 },
  ];

  ws.mergeCells("A1:E1");
  const title = ws.getCell("A1");
  title.value = "I/C LEDGER";
  title.font = { size: 16, bold: true, color: { argb: "FF111827" } };
  title.alignment = { horizontal: "center" };

  ws.mergeCells("A2:E2");
  const subtitle = ws.getCell("A2");
  subtitle.value = "STM Financial — Income & Cost";
  subtitle.font = { size: 10, color: { argb: "FF6B7280" } };
  subtitle.alignment = { horizontal: "center" };

  ws.mergeCells("A4:E4");
  const period = ws.getCell("A4");
  period.value = `Period: ${from} to ${to}`;
  period.font = { bold: true, size: 10, color: { argb: "FF374151" } };

  const headerRowIdx = 6;
  const header = ws.getRow(headerRowIdx);
  header.values = ["Date", "Description", "Debit (MMK)", "Credit (MMK)", "Running Balance (MMK)"];
  header.eachCell(cell => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = HEADER_FILL;
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = THIN_BORDER;
  });
  header.height = 20;

  let rowIdx = headerRowIdx + 1;

  const openingRow = ws.getRow(rowIdx);
  openingRow.values = ["", "Opening Balance", null, null, ledger.openingBalance];
  openingRow.getCell(2).font = { italic: true, color: { argb: "FF4B5563" } };
  openingRow.getCell(5).font = { italic: true, bold: true };
  openingRow.getCell(5).numFmt = MMK_FMT;
  openingRow.eachCell(cell => { cell.border = THIN_BORDER; });
  rowIdx++;

  for (const r of ledger.rows) {
    const row = ws.getRow(rowIdx);
    row.getCell(1).value = excelDate(r.date);
    row.getCell(1).numFmt = "d-mmm-yyyy";
    row.getCell(2).value = r.description;
    row.getCell(3).value = r.debit || null;
    row.getCell(3).numFmt = MMK_FMT;
    row.getCell(4).value = r.credit || null;
    row.getCell(4).numFmt = MMK_FMT;
    row.getCell(5).value = r.balance;
    row.getCell(5).numFmt = MMK_FMT;
    row.eachCell(cell => { cell.border = THIN_BORDER; });
    if (rowIdx % 2 === 0) {
      row.eachCell(cell => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF9FAFB" } }; });
    }
    rowIdx++;
  }

  if (ledger.rows.length === 0) {
    ws.mergeCells(`A${rowIdx}:E${rowIdx}`);
    const emptyCell = ws.getCell(`A${rowIdx}`);
    emptyCell.value = "No entries in this period";
    emptyCell.font = { italic: true, color: { argb: "FF9CA3AF" } };
    emptyCell.alignment = { horizontal: "center" };
    rowIdx++;
  }

  const totalsRow = ws.getRow(rowIdx);
  totalsRow.values = ["", "Period Totals", ledger.totalDebit || null, ledger.totalCredit || null, null];
  totalsRow.getCell(2).font = { italic: true, color: { argb: "FF4B5563" } };
  totalsRow.getCell(3).numFmt = MMK_FMT;
  totalsRow.getCell(4).numFmt = MMK_FMT;
  totalsRow.eachCell(cell => { cell.border = THIN_BORDER; });
  rowIdx++;

  const closingRow = ws.getRow(rowIdx);
  closingRow.values = ["", "Closing Balance", null, null, ledger.closingBalance];
  closingRow.eachCell(cell => {
    cell.font = { bold: true, color: { argb: "FF111827" } };
    cell.border = { top: { style: "double", color: { argb: "FF111827" } } };
  });
  closingRow.getCell(5).numFmt = MMK_FMT;

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `IC_Ledger_${from}_to_${to}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
