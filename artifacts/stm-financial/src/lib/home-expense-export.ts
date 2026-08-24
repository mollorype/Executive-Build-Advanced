import type ExcelJS from "exceljs";
import { HOME_EXPENSE_CATEGORY_LABELS, type HomeExpense, type IncomeDeduction, type IncomeEntry } from "./home-expenses";

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

function chronological<T extends { created_at: string }>(rows: T[], dateOf: (r: T) => string): T[] {
  return [...rows].sort((a, b) => {
    const dateDiff = dateOf(a).localeCompare(dateOf(b));
    if (dateDiff !== 0) return dateDiff;
    return a.created_at.localeCompare(b.created_at);
  });
}

function sumBy<T>(rows: T[], amountOf: (r: T) => number, key: (r: T) => string): Map<string, number> {
  const sums = new Map<string, number>();
  for (const r of rows) sums.set(key(r), (sums.get(key(r)) ?? 0) + amountOf(r));
  return sums;
}

function sheetHeader(ws: ExcelJS.Worksheet, title: string, subtitle: string, period: string, lastCol: string) {
  ws.mergeCells(`A1:${lastCol}1`);
  const t = ws.getCell("A1");
  t.value = title;
  t.font = { size: 16, bold: true, color: { argb: "FF111827" } };
  t.alignment = { horizontal: "center" };

  ws.mergeCells(`A2:${lastCol}2`);
  const s = ws.getCell("A2");
  s.value = subtitle;
  s.font = { size: 10, color: { argb: "FF6B7280" } };
  s.alignment = { horizontal: "center" };

  ws.mergeCells(`A4:${lastCol}4`);
  const p = ws.getCell("A4");
  p.value = `Period: ${period}`;
  p.font = { bold: true, size: 10, color: { argb: "FF374151" } };
}

function headerRow(ws: ExcelJS.Worksheet, rowIdx: number, values: string[]) {
  const row = ws.getRow(rowIdx);
  row.values = values;
  row.eachCell(cell => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = HEADER_FILL;
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = THIN_BORDER;
  });
  row.height = 20;
}

export interface HomeFinanceExportData {
  from: string;
  to: string;
  totalSale: number;
  shiftCount: number;
  manualIncome: IncomeEntry[];
  deductions: IncomeDeduction[];
  expenses: HomeExpense[];
}

export async function exportHomeFinanceExcel(data: HomeFinanceExportData): Promise<void> {
  const { from, to, totalSale, shiftCount, manualIncome, deductions, expenses } = data;
  const period = `${from} to ${to}`;

  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "STM Financial";
  wb.created = new Date();

  const sortedManualIncome = chronological(manualIncome, i => i.income_date);
  const totalManualIncome = sortedManualIncome.reduce((s, i) => s + i.amount, 0);

  const sortedDeductions = chronological(deductions, d => d.deduction_date);
  const totalDeductions = sortedDeductions.reduce((s, d) => s + d.amount, 0);
  const netActualIncome = totalSale + totalManualIncome - totalDeductions;

  const sortedExpenses = chronological(expenses, e => e.expense_date);
  const totalExpenses = sortedExpenses.reduce((s, e) => s + e.amount, 0);

  const netPosition = netActualIncome - totalExpenses;

  // ── Summary sheet ──────────────────────────────────────────────
  const summary = wb.addWorksheet("Summary", { views: [{ showGridLines: false }] });
  summary.columns = [{ width: 32 }, { width: 20 }];
  sheetHeader(summary, "HOME FINANCE SUMMARY", "STM Financial — Income & Expense", period, "B");

  const summaryRows: [string, number, boolean][] = [
    [`Total Sale (${shiftCount} shift${shiftCount === 1 ? "" : "s"})`, totalSale, false],
    ["Manual Income", totalManualIncome, false],
    ["Total Deductions", -totalDeductions, false],
    ["Net Actual Income", netActualIncome, true],
    ["Total Home Expenses", -totalExpenses, false],
    ["Net Position", netPosition, true],
  ];
  let sRow = 6;
  for (const [label, amt, bold] of summaryRows) {
    const row = summary.getRow(sRow);
    row.getCell(1).value = label;
    row.getCell(2).value = amt;
    row.getCell(2).numFmt = MMK_FMT;
    if (bold) {
      row.eachCell(cell => {
        cell.font = { bold: true, color: { argb: "FF111827" } };
        cell.border = { top: { style: "double", color: { argb: "FF111827" } } };
      });
    } else {
      row.getCell(1).font = { color: { argb: "FF4B5563" } };
    }
    sRow++;
  }

  // ── Actual Income sheet ─────────────────────────────────────────
  const income = wb.addWorksheet("Actual Income", {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
    views: [{ showGridLines: false }],
  });
  income.columns = [{ width: 14 }, { width: 28 }, { width: 34 }, { width: 18 }];
  sheetHeader(income, "ACTUAL INCOME REPORT", "STM Financial — Auto-detected from Shifts", period, "D");

  income.mergeCells("A5:D5");
  const saleCell = income.getCell("A5");
  saleCell.value = `Total Sale (auto-detected, ${shiftCount} shift${shiftCount === 1 ? "" : "s"}): ${totalSale.toLocaleString("en-US")} MMK`;
  saleCell.font = { bold: true, size: 10, color: { argb: "FF111827" } };

  let iRow = 7;
  income.getCell(`A${iRow}`).value = "Manual Income";
  income.getCell(`A${iRow}`).font = { bold: true, size: 11, color: { argb: "FF111827" } };
  iRow++;
  headerRow(income, iRow, ["Date", "Source", "Note", "Amount (MMK)"]);
  iRow++;
  for (const inc of sortedManualIncome) {
    const row = income.getRow(iRow);
    row.getCell(1).value = excelDate(inc.income_date);
    row.getCell(1).numFmt = "d-mmm-yyyy";
    row.getCell(2).value = inc.name;
    row.getCell(3).value = inc.note ?? "";
    row.getCell(4).value = inc.amount;
    row.getCell(4).numFmt = MMK_FMT;
    row.eachCell(cell => { cell.border = THIN_BORDER; });
    if (iRow % 2 === 1) row.eachCell(cell => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF9FAFB" } }; });
    iRow++;
  }
  if (sortedManualIncome.length === 0) {
    income.mergeCells(`A${iRow}:D${iRow}`);
    const empty = income.getCell(`A${iRow}`);
    empty.value = "No manual income entries in this period";
    empty.font = { italic: true, color: { argb: "FF9CA3AF" } };
    empty.alignment = { horizontal: "center" };
    iRow++;
  }
  const manualTotalRow = income.getRow(iRow);
  manualTotalRow.values = ["", "", "Total Manual Income", totalManualIncome];
  manualTotalRow.eachCell(cell => { cell.font = { bold: true, color: { argb: "FF111827" } }; cell.border = { top: { style: "thin", color: { argb: "FF111827" } } }; });
  manualTotalRow.getCell(4).numFmt = MMK_FMT;
  iRow += 2;

  income.getCell(`A${iRow}`).value = "Deductions";
  income.getCell(`A${iRow}`).font = { bold: true, size: 11, color: { argb: "FF111827" } };
  iRow++;
  headerRow(income, iRow, ["Date", "Deduction", "Note", "Amount (MMK)"]);
  iRow++;
  for (const d of sortedDeductions) {
    const row = income.getRow(iRow);
    row.getCell(1).value = excelDate(d.deduction_date);
    row.getCell(1).numFmt = "d-mmm-yyyy";
    row.getCell(2).value = d.name;
    row.getCell(3).value = d.note ?? "";
    row.getCell(4).value = d.amount;
    row.getCell(4).numFmt = MMK_FMT;
    row.eachCell(cell => { cell.border = THIN_BORDER; });
    if (iRow % 2 === 1) row.eachCell(cell => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF9FAFB" } }; });
    iRow++;
  }
  if (sortedDeductions.length === 0) {
    income.mergeCells(`A${iRow}:D${iRow}`);
    const empty = income.getCell(`A${iRow}`);
    empty.value = "No deductions in this period";
    empty.font = { italic: true, color: { argb: "FF9CA3AF" } };
    empty.alignment = { horizontal: "center" };
    iRow++;
  }
  const dedTotalRow = income.getRow(iRow);
  dedTotalRow.values = ["", "", "Total Deductions", totalDeductions];
  dedTotalRow.eachCell(cell => { cell.font = { bold: true, color: { argb: "FF111827" } }; cell.border = { top: { style: "thin", color: { argb: "FF111827" } } }; });
  dedTotalRow.getCell(4).numFmt = MMK_FMT;
  iRow++;
  const netIncomeRow = income.getRow(iRow);
  netIncomeRow.values = ["", "", "Net Actual Income", netActualIncome];
  netIncomeRow.eachCell(cell => { cell.font = { bold: true, color: { argb: "FF111827" } }; cell.border = { top: { style: "double", color: { argb: "FF111827" } } }; });
  netIncomeRow.getCell(4).numFmt = MMK_FMT;

  // ── Home Expenses sheet ─────────────────────────────────────────
  const exp = wb.addWorksheet("Home Expenses", {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
    views: [{ showGridLines: false }],
  });
  exp.columns = [{ width: 14 }, { width: 20 }, { width: 16 }, { width: 34 }, { width: 18 }];
  sheetHeader(exp, "HOME EXPENSE REPORT", "STM Financial — Family Expense Tracking", period, "E");

  headerRow(exp, 6, ["Date", "Family Member", "Category", "Note", "Amount (MMK)"]);
  let eRow = 7;
  for (const e of sortedExpenses) {
    const row = exp.getRow(eRow);
    row.getCell(1).value = excelDate(e.expense_date);
    row.getCell(1).numFmt = "d-mmm-yyyy";
    row.getCell(2).value = e.member_name;
    row.getCell(3).value = HOME_EXPENSE_CATEGORY_LABELS[e.category];
    row.getCell(4).value = e.note ?? "";
    row.getCell(5).value = e.amount;
    row.getCell(5).numFmt = MMK_FMT;
    row.eachCell(cell => { cell.border = THIN_BORDER; });
    if (eRow % 2 === 1) row.eachCell(cell => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF9FAFB" } }; });
    eRow++;
  }
  if (sortedExpenses.length === 0) {
    exp.mergeCells(`A${eRow}:E${eRow}`);
    const empty = exp.getCell(`A${eRow}`);
    empty.value = "No expenses in this period";
    empty.font = { italic: true, color: { argb: "FF9CA3AF" } };
    empty.alignment = { horizontal: "center" };
    eRow++;
  }
  const expTotalRow = exp.getRow(eRow);
  expTotalRow.values = ["", "", "", "Period Total", totalExpenses];
  expTotalRow.eachCell(cell => { cell.font = { bold: true, color: { argb: "FF111827" } }; cell.border = { top: { style: "double", color: { argb: "FF111827" } } }; });
  expTotalRow.getCell(5).numFmt = MMK_FMT;
  eRow += 3;

  const byMember = sumBy(sortedExpenses, e => e.amount, e => e.member_name);
  if (byMember.size > 0) {
    exp.getCell(`A${eRow}`).value = "By Family Member";
    exp.getCell(`A${eRow}`).font = { bold: true, size: 11, color: { argb: "FF111827" } };
    eRow++;
    for (const [name, amt] of [...byMember.entries()].sort((a, b) => b[1] - a[1])) {
      exp.getRow(eRow).getCell(1).value = name;
      exp.getRow(eRow).getCell(2).value = amt;
      exp.getRow(eRow).getCell(2).numFmt = MMK_FMT;
      eRow++;
    }
    eRow++;
  }

  const byCategory = sumBy(sortedExpenses, e => e.amount, e => HOME_EXPENSE_CATEGORY_LABELS[e.category]);
  if (byCategory.size > 0) {
    exp.getCell(`A${eRow}`).value = "By Category";
    exp.getCell(`A${eRow}`).font = { bold: true, size: 11, color: { argb: "FF111827" } };
    eRow++;
    for (const [label, amt] of [...byCategory.entries()].sort((a, b) => b[1] - a[1])) {
      exp.getRow(eRow).getCell(1).value = label;
      exp.getRow(eRow).getCell(2).value = amt;
      exp.getRow(eRow).getCell(2).numFmt = MMK_FMT;
      eRow++;
    }
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Home_Finance_${from}_to_${to}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
