import type ExcelJS from "exceljs";
import type { DebtProfile, DebtTransaction } from "./debt-supabase";

export interface LedgerRow {
  date: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface Ledger {
  openingBalance: number;
  rows: LedgerRow[];
  closingBalance: number;
  totalDebit: number;
  totalCredit: number;
}

export function describeTransaction(t: DebtTransaction): string {
  if (t.note && t.note.trim()) return t.note.trim();
  if (t.product_type && t.liters) {
    return `${t.product_type} — ${t.liters.toFixed(2)} L`;
  }
  return t.amount < 0 ? "Payment" : "Debt Entry";
}

/** Oldest-first, matching how a ledger is read top to bottom. */
export function sortTransactionsChronological(transactions: DebtTransaction[]): DebtTransaction[] {
  return [...transactions].sort((a, b) => {
    const dateDiff = new Date(a.date).getTime() - new Date(b.date).getTime();
    if (dateDiff !== 0) return dateDiff;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });
}

/**
 * Builds a running-balance ledger for a date range. Transactions before
 * `from` are folded into the opening balance rather than dropped, so the
 * ledger's running balance always reconciles with the account's true balance.
 */
export function buildLedger(
  transactions: DebtTransaction[],
  from: string | null,
  to: string | null
): Ledger {
  const sorted = sortTransactionsChronological(transactions);

  const fromTime = from ? new Date(`${from}T00:00:00`).getTime() : -Infinity;
  const toTime = to ? new Date(`${to}T23:59:59.999`).getTime() : Infinity;

  let openingBalance = 0;
  for (const t of sorted) {
    if (new Date(t.date).getTime() < fromTime) openingBalance += t.amount;
  }

  let running = openingBalance;
  let totalDebit = 0;
  let totalCredit = 0;
  const rows: LedgerRow[] = [];

  for (const t of sorted) {
    const time = new Date(t.date).getTime();
    if (time < fromTime || time > toTime) continue;
    running += t.amount;
    const debit = t.amount > 0 ? t.amount : 0;
    const credit = t.amount < 0 ? -t.amount : 0;
    totalDebit += debit;
    totalCredit += credit;
    rows.push({ date: t.date, description: describeTransaction(t), debit, credit, balance: running });
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
  return new Date(iso);
}

export async function exportLedgerExcel(
  profile: DebtProfile,
  phones: string[],
  from: string,
  to: string,
  ledger: Ledger
): Promise<void> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "STM Financial";
  wb.created = new Date();

  const ws = wb.addWorksheet("Debtors Ledger", {
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
  title.value = "DEBTORS LEDGER";
  title.font = { size: 16, bold: true, color: { argb: "FF111827" } };
  title.alignment = { horizontal: "center" };

  ws.mergeCells("A2:E2");
  const subtitle = ws.getCell("A2");
  subtitle.value = "STM Financial";
  subtitle.font = { size: 10, color: { argb: "FF6B7280" } };
  subtitle.alignment = { horizontal: "center" };

  const infoRow = (rowIdx: number, label: string, value: string) => {
    const labelCell = ws.getCell(`A${rowIdx}`);
    labelCell.value = label;
    labelCell.font = { bold: true, size: 10, color: { argb: "FF374151" } };
    ws.mergeCells(`B${rowIdx}:E${rowIdx}`);
    const valueCell = ws.getCell(`B${rowIdx}`);
    valueCell.value = value;
    valueCell.font = { size: 10, color: { argb: "FF111827" } };
  };
  infoRow(4, "Customer Name:", profile.name);
  infoRow(5, "Phone Number:", phones.length > 0 ? phones.join(", ") : "—");
  infoRow(6, "Statement Period:", `${from} to ${to}`);

  const headerRowIdx = 8;
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
    emptyCell.value = "No transactions in this period";
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
  const safeName = profile.name.trim().replace(/[^a-zA-Z0-9]+/g, "_");
  a.download = `${safeName}_Ledger_${from}_to_${to}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
