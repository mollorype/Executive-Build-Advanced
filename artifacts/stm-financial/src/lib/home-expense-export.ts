import type ExcelJS from "exceljs";
import { HOME_EXPENSE_CATEGORY_LABELS, type HomeExpense } from "./home-expenses";

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

/** Oldest-first, matching how a report reads top to bottom. */
function sortChronological(expenses: HomeExpense[]): HomeExpense[] {
  return [...expenses].sort((a, b) => {
    const dateDiff = a.expense_date.localeCompare(b.expense_date);
    if (dateDiff !== 0) return dateDiff;
    return a.created_at.localeCompare(b.created_at);
  });
}

function sumBy<T extends string>(expenses: HomeExpense[], key: (e: HomeExpense) => T): Map<T, number> {
  const sums = new Map<T, number>();
  for (const e of expenses) sums.set(key(e), (sums.get(key(e)) ?? 0) + e.amount);
  return sums;
}

export async function exportHomeExpensesExcel(
  expenses: HomeExpense[],
  from: string,
  to: string
): Promise<void> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "STM Financial";
  wb.created = new Date();

  const ws = wb.addWorksheet("Home Expenses", {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
    views: [{ showGridLines: false }],
  });

  ws.columns = [
    { width: 14 },
    { width: 20 },
    { width: 16 },
    { width: 34 },
    { width: 18 },
  ];

  ws.mergeCells("A1:E1");
  const title = ws.getCell("A1");
  title.value = "HOME EXPENSE REPORT";
  title.font = { size: 16, bold: true, color: { argb: "FF111827" } };
  title.alignment = { horizontal: "center" };

  ws.mergeCells("A2:E2");
  const subtitle = ws.getCell("A2");
  subtitle.value = "STM Financial — Family Expense Tracking";
  subtitle.font = { size: 10, color: { argb: "FF6B7280" } };
  subtitle.alignment = { horizontal: "center" };

  ws.mergeCells("A4:E4");
  const period = ws.getCell("A4");
  period.value = `Period: ${from} to ${to}`;
  period.font = { bold: true, size: 10, color: { argb: "FF374151" } };

  const sorted = sortChronological(expenses);
  const total = sorted.reduce((s, e) => s + e.amount, 0);

  const headerRowIdx = 6;
  const header = ws.getRow(headerRowIdx);
  header.values = ["Date", "Family Member", "Category", "Note", "Amount (MMK)"];
  header.eachCell(cell => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = HEADER_FILL;
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = THIN_BORDER;
  });
  header.height = 20;

  let rowIdx = headerRowIdx + 1;

  for (const e of sorted) {
    const row = ws.getRow(rowIdx);
    row.getCell(1).value = excelDate(e.expense_date);
    row.getCell(1).numFmt = "d-mmm-yyyy";
    row.getCell(2).value = e.member_name;
    row.getCell(3).value = HOME_EXPENSE_CATEGORY_LABELS[e.category];
    row.getCell(4).value = e.note ?? "";
    row.getCell(5).value = e.amount;
    row.getCell(5).numFmt = MMK_FMT;
    row.eachCell(cell => { cell.border = THIN_BORDER; });
    if (rowIdx % 2 === 0) {
      row.eachCell(cell => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF9FAFB" } }; });
    }
    rowIdx++;
  }

  if (sorted.length === 0) {
    ws.mergeCells(`A${rowIdx}:E${rowIdx}`);
    const emptyCell = ws.getCell(`A${rowIdx}`);
    emptyCell.value = "No expenses in this period";
    emptyCell.font = { italic: true, color: { argb: "FF9CA3AF" } };
    emptyCell.alignment = { horizontal: "center" };
    rowIdx++;
  }

  const totalRow = ws.getRow(rowIdx);
  totalRow.values = ["", "", "", "Period Total", total];
  totalRow.eachCell(cell => {
    cell.font = { bold: true, color: { argb: "FF111827" } };
    cell.border = { top: { style: "double", color: { argb: "FF111827" } } };
  });
  totalRow.getCell(5).numFmt = MMK_FMT;
  rowIdx += 3;

  // Breakdown by family member
  const byMember = sumBy(sorted, e => e.member_name);
  if (byMember.size > 0) {
    const memberHeaderRow = ws.getCell(`A${rowIdx}`);
    memberHeaderRow.value = "By Family Member";
    memberHeaderRow.font = { bold: true, size: 11, color: { argb: "FF111827" } };
    rowIdx++;
    for (const [name, amt] of [...byMember.entries()].sort((a, b) => b[1] - a[1])) {
      const row = ws.getRow(rowIdx);
      row.getCell(1).value = name;
      row.getCell(2).value = amt;
      row.getCell(2).numFmt = MMK_FMT;
      rowIdx++;
    }
    rowIdx++;
  }

  // Breakdown by category
  const byCategory = sumBy(sorted, e => HOME_EXPENSE_CATEGORY_LABELS[e.category]);
  if (byCategory.size > 0) {
    const categoryHeaderRow = ws.getCell(`A${rowIdx}`);
    categoryHeaderRow.value = "By Category";
    categoryHeaderRow.font = { bold: true, size: 11, color: { argb: "FF111827" } };
    rowIdx++;
    for (const [label, amt] of [...byCategory.entries()].sort((a, b) => b[1] - a[1])) {
      const row = ws.getRow(rowIdx);
      row.getCell(1).value = label;
      row.getCell(2).value = amt;
      row.getCell(2).numFmt = MMK_FMT;
      rowIdx++;
    }
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Home_Expenses_${from}_to_${to}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
