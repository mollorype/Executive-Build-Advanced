// Salary history → Excel: every employee, month by month, plus every entry.
// Paid months use the figures saved when they were paid; unpaid months are
// worked out from the current base salary and that month's entries.

import type ExcelJS from "exceljs";
import { loadEmployees, loadItemsRange, loadPayments } from "./salary";
import { monthsBetween, monthLabel, signedAmount, dailyNote, buildSalaryRows } from "./salary-math";

const MMK = "#,##0;[Red]-#,##0";
const HEAD: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };
const SUB: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };

function stamp(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Yangon", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

export async function exportSalariesExcel(from: string, to: string): Promise<void> {
  const [emps, items, payments] = await Promise.all([loadEmployees(), loadItemsRange(from, to), loadPayments(from, to)]);
  if (emps.error) throw new Error(emps.error);
  const rows = buildSalaryRows(emps.data, items, payments, from, to);
  const names = new Map(emps.data.map(e => [e.id, e.name]));

  const { default: Excel } = await import("exceljs");
  const wb = new Excel.Workbook();
  wb.creator = "STM Financial";
  wb.created = new Date();

  // ── Sheet 1: salaries by month ──
  const ws = wb.addWorksheet("Salaries by month", { views: [{ state: "frozen", ySplit: 3 }] });
  ws.columns = [
    { key: "month", width: 16 }, { key: "name", width: 24 }, { key: "phone", width: 16 },
    { key: "base", width: 13 }, { key: "ot", width: 12 }, { key: "bonus", width: 12 }, { key: "refund", width: 12 },
    { key: "ded", width: 13 }, { key: "net", width: 14 }, { key: "status", width: 10 }, { key: "paidOn", width: 20 }, { key: "paidBy", width: 26 },
  ];
  ws.mergeCells("A1:L1");
  ws.getCell("A1").value = `Salaries — ${monthLabel(from, "en")}${from !== to ? ` to ${monthLabel(to, "en")}` : ""}`;
  ws.getCell("A1").font = { bold: true, size: 14 };
  const header = ws.getRow(3);
  header.values = ["Month", "Employee", "Phone", "Base salary", "Overtime", "Bonus", "Paid back", "Deductions", "To pay", "Status", "Paid on", "Paid by"];
  header.eachCell(c => { c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = HEAD; });

  const total = { base: 0, ot: 0, bonus: 0, refund: 0, ded: 0, net: 0 };
  for (const month of monthsBetween(from, to)) {
    const inMonth = rows.filter(r => r.month === month);
    const sub = { base: 0, ot: 0, bonus: 0, refund: 0, ded: 0, net: 0 };
    for (const r of inMonth) {
      ws.addRow({
        month: monthLabel(month, "en"), name: r.employee.name, phone: r.employee.phone_number ?? "",
        base: r.sum.base, ot: r.sum.overtime, bonus: r.sum.bonus, refund: r.sum.refund, ded: r.sum.deductions, net: r.sum.net,
        status: r.payment ? "Paid" : "Unpaid", paidOn: stamp(r.payment?.paid_at ?? null), paidBy: r.payment?.paid_by ?? "",
      });
      sub.base += r.sum.base; sub.ot += r.sum.overtime; sub.bonus += r.sum.bonus; sub.refund += r.sum.refund; sub.ded += r.sum.deductions; sub.net += r.sum.net;
    }
    const sr = ws.addRow({ month: monthLabel(month, "en"), name: `Total (${inMonth.filter(r => r.payment).length} of ${inMonth.length} paid)`, ...{ base: sub.base, ot: sub.ot, bonus: sub.bonus, refund: sub.refund, ded: sub.ded, net: sub.net } });
    sr.font = { bold: true };
    sr.eachCell(c => { c.fill = SUB; });
    (Object.keys(total) as (keyof typeof total)[]).forEach(k => { total[k] += sub[k]; });
  }
  if (from !== to) {
    const tr = ws.addRow({ month: "All months", name: "Grand total", ...total });
    tr.font = { bold: true };
    tr.eachCell(c => { c.border = { top: { style: "medium" } }; });
  }
  ["D", "E", "F", "G", "H", "I"].forEach(col => { ws.getColumn(col).numFmt = MMK; });

  // ── Sheet 2: every entry ──
  const es = wb.addWorksheet("Entries", { views: [{ state: "frozen", ySplit: 1 }] });
  es.columns = [
    { header: "Month", key: "month", width: 16 }, { header: "Employee", key: "name", width: 24 }, { header: "Date", key: "date", width: 12 },
    { header: "Type", key: "type", width: 12 }, { header: "Amount", key: "amount", width: 13 }, { header: "Source", key: "source", width: 12 },
    { header: "Note", key: "note", width: 36 }, { header: "Status", key: "status", width: 11 }, { header: "Decided by", key: "by", width: 26 },
  ];
  es.getRow(1).eachCell(c => { c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = HEAD; });
  const entries = [...items].sort((a, b) => a.salary_month.localeCompare(b.salary_month) || (names.get(a.profile_id) ?? "").localeCompare(names.get(b.profile_id) ?? "") || a.date.localeCompare(b.date));
  for (const i of entries) {
    if (!names.has(i.profile_id)) continue;
    const note = i.source === "daily_app" ? [dailyNote(i.label), i.reported_by ? `recorded by ${i.reported_by}` : ""].filter(Boolean).join(" · ") : i.label ?? "";
    es.addRow({
      month: monthLabel(i.salary_month, "en"), name: names.get(i.profile_id), date: i.date, type: i.type === "Refund" ? "Paid back" : i.type,
      amount: signedAmount(i), source: i.source === "daily_app" ? "STM Daily" : "Manual", note,
      status: i.status === "dismissed" ? "Dismissed" : "Applied", by: i.decided_by ?? "",
    });
  }
  es.getColumn("amount").numFmt = MMK;

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `STM-Salaries-${from.slice(0, 7)}${from !== to ? `_to_${to.slice(0, 7)}` : ""}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
