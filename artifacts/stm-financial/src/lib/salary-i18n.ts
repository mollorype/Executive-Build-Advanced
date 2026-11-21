// Salary Management in English and Myanmar — shares the Debt Tracker's language toggle.

import { useCallback } from "react";
import { useDebtLang, type DebtLang } from "./debt-i18n";
import type { SalaryItemType } from "./salary-math";

const S = {
  title:          { en: "Salary Management", my: "လစာ စီမံခန့်ခွဲမှု" },
  subtitle:       { en: "Each employee's monthly salary, overtime, bonus and deductions", my: "ဝန်ထမ်းတစ်ဦးချင်း လစဉ် လစာ၊ အချိန်ပိုကြေး၊ ဆုကြေး နှင့် နုတ်ငွေ" },
  newEmployee:    { en: "New Employee", my: "ဝန်ထမ်းအသစ်" },
  prevMonth:      { en: "Previous month", my: "ယခင်လ" },
  nextMonth:      { en: "Next month", my: "နောက်လ" },
  thisMonth:      { en: "This month", my: "ယခုလ" },
  totalBase:      { en: "Base salaries", my: "အခြေခံ လစာ" },
  totalAdded:     { en: "Overtime & bonus", my: "အချိန်ပို နှင့် ဆုကြေး" },
  totalDeducted:  { en: "Deducted", my: "နုတ်ငွေ" },
  totalNet:       { en: "To pay", my: "ပေးရမည့် လစာ" },
  pendingBanner:  { en: "{n} STM Daily entries are waiting — nothing is deducted until you choose.", my: "STM Daily မှ ချိတ်ထားသော {n} ခု စောင့်နေသည် — သင် ရွေးမှသာ နုတ်ပါမည်။" },
  noEmployees:    { en: "No employees yet.", my: "ဝန်ထမ်း မရှိသေးပါ။" },
  noEmployeesHint:{ en: "Add one to set their monthly salary.", my: "လစာ သတ်မှတ်ရန် ဝန်ထမ်း ထည့်ပါ။" },
  noMatch:        { en: "No employee matches.", my: "ကိုက်ညီသော ဝန်ထမ်း မရှိပါ။" },
  searchPh:       { en: "Search employees…", my: "ဝန်ထမ်း ရှာရန်…" },
  colEmployee:    { en: "Employee", my: "ဝန်ထမ်း" },
  colBase:        { en: "Base", my: "အခြေခံ" },
  colAdded:       { en: "Added", my: "ပေါင်း" },
  colDeducted:    { en: "Deducted", my: "နုတ်" },
  colNet:         { en: "To pay", my: "ပေးရန်" },
  pendingN:       { en: "{n} waiting", my: "{n} ခု စောင့်ဆဲ" },
  noBase:         { en: "No salary set", my: "လစာ မသတ်မှတ်ရသေး" },

  name:           { en: "Name", my: "အမည်" },
  phone:          { en: "Phone", my: "ဖုန်း" },
  baseSalary:     { en: "Monthly base salary (MMK)", my: "လစဉ် အခြေခံ လစာ (ကျပ်)" },
  nameRequired:   { en: "Enter a name.", my: "အမည် ထည့်ပါ။" },
  addEmployee:    { en: "Add Employee", my: "ဝန်ထမ်း ထည့်မည်" },
  save:           { en: "Save", my: "သိမ်းမည်" },
  cancel:         { en: "Cancel", my: "မလုပ်တော့ပါ" },
  saving:         { en: "Saving…", my: "သိမ်းနေသည်…" },
  editEmployee:   { en: "Edit employee", my: "ဝန်ထမ်း ပြင်ရန်" },
  deleteEmployee: { en: "Delete employee", my: "ဝန်ထမ်း ဖျက်ရန်" },
  confirmDelete:  { en: "Delete {name}?\nTheir salary records are deleted too.", my: "{name} ကို ဖျက်မလား?\nလစာ မှတ်တမ်းများလည်း ပျက်ပါမည်။" },
  close:          { en: "Close", my: "ပိတ်ရန်" },
  employeeOn:     { en: "Employee · since {date}", my: "ဝန်ထမ်း · {date} မှ" },

  poolTitle:      { en: "Salary pool · {month}", my: "လစာ · {month}" },
  baseLine:       { en: "Base salary", my: "အခြေခံ လစာ" },
  overtime:       { en: "Overtime", my: "အချိန်ပိုကြေး" },
  bonus:          { en: "Bonus", my: "ဆုကြေး" },
  refund:         { en: "Cash paid back", my: "ပြန်ပေးငွေ" },
  deduction:      { en: "Deductions", my: "နုတ်ငွေ" },
  deductionOne:   { en: "Deduction", my: "နုတ်ငွေ" },
  net:            { en: "To pay", my: "ပေးရမည့် လစာ" },
  overDeducted:   { en: "Deducted {a} more than the pay.", my: "လစာထက် {a} ပိုနုတ်ထားသည်။" },

  pendingTitle:   { en: "From STM Daily — not deducted", my: "STM Daily မှ — မနုတ်ရသေး" },
  pendingHelp:    { en: "Staff linked these to this employee in STM Daily. Nothing changes until you deduct or dismiss.", my: "ဝန်ထမ်းများက STM Daily တွင် ဤဝန်ထမ်းနှင့် ချိတ်ထားသည်။ နုတ်ရန် သို့မဟုတ် ပယ်ရန် မရွေးမချင်း ဘာမှ မပြောင်းပါ။" },
  tookCash:       { en: "Took cash", my: "ငွေထုတ်ယူ" },
  paidBack:       { en: "Paid cash back", my: "ငွေပြန်ပေး" },
  byStaff:        { en: "Recorded by {name}", my: "{name} မှ မှတ်သည်" },
  deductFrom:     { en: "Deduct from {month}", my: "{month} လစာမှ နုတ်ရန်" },
  addBackTo:      { en: "Add to {month}", my: "{month} လစာသို့ ပေါင်းရန်" },
  dismiss:        { en: "Dismiss", my: "ပယ်ရန်" },
  confirmDismiss: { en: "Dismiss this entry? It won't be deducted.", my: "ဤစာရင်းကို ပယ်မလား? မနုတ်ပါ။" },

  addEntry:       { en: "Add to salary", my: "လစာ စာရင်း ထည့်ရန်" },
  amount:         { en: "Amount (MMK)", my: "ပမာဏ (ကျပ်)" },
  date:           { en: "Date", my: "ရက်စွဲ" },
  note:           { en: "Note", my: "မှတ်ချက်" },
  optional:       { en: "(optional)", my: "(မထည့်လည်းရ)" },
  notePh:         { en: "e.g. Sunday shift, advance", my: "ဥပမာ တနင်္ဂနွေ အလုပ်၊ ကြိုထုတ်" },
  addOvertime:    { en: "Add overtime", my: "အချိန်ပိုကြေး ထည့်မည်" },
  addBonus:       { en: "Add bonus", my: "ဆုကြေး ထည့်မည်" },
  addDeduction:   { en: "Deduct", my: "နုတ်မည်" },
  countsIn:       { en: "Counts in {month}'s salary.", my: "{month} လစာတွင် ထည့်တွက်မည်။" },
  enterAmount:    { en: "Enter an amount.", my: "ပမာဏ ထည့်ပါ။" },

  history:        { en: "{month} history", my: "{month} မှတ်တမ်း" },
  noHistory:      { en: "Nothing this month yet.", my: "ဤလတွင် မရှိသေးပါ။" },
  dismissedTag:   { en: "Dismissed", my: "ပယ်ထား" },
  dailyTag:       { en: "STM Daily", my: "STM Daily" },
  manualTag:      { en: "Manual", my: "ကိုယ်တိုင်" },
  undo:           { en: "Undo", my: "ပြန်ပြင်ရန်" },
  undoHelp:       { en: "Back to waiting", my: "စောင့်ဆဲ သို့ ပြန်ထား" },
  deleteEntry:    { en: "Delete entry", my: "စာရင်း ဖျက်ရန်" },
  confirmDeleteEntry: { en: "Delete this entry?", my: "ဤစာရင်းကို ဖျက်မလား?" },
  decidedBy:      { en: "by {who}", my: "{who}" },

  paidTitle:      { en: "{month} salary paid", my: "{month} လစာ ပေးပြီး" },
  paidOn:         { en: "Paid {date}", my: "{date} တွင် ပေးခဲ့သည်" },
  markPaid:       { en: "Mark {month} salary paid · {a}", my: "{month} လစာ ပေးပြီး · {a}" },
  confirmPay:     { en: "Mark {name}'s {month} salary ({a}) as paid?\nThese figures are saved as the month's history.", my: "{name} ၏ {month} လစာ ({a}) ကို ပေးပြီးဟု မှတ်မလား?\nဤလ၏ မှတ်တမ်းအဖြစ် သိမ်းပါမည်။" },
  confirmPayPending: { en: "\n\n{n} STM Daily entries are still waiting — they won't be included.", my: "\n\nSTM Daily မှ {n} ခု စောင့်ဆဲ — မပါဝင်ပါ။" },
  undoPay:        { en: "Undo payment", my: "ပေးချေမှု ပြန်ဖျက်ရန်" },
  confirmUndoPay: { en: "Undo this payment? The month goes back to unpaid.", my: "ဤပေးချေမှုကို ပြန်ဖျက်မလား? မပေးရသေး အဖြစ် ပြန်ဖြစ်ပါမည်။" },
  changedAfterPay:{ en: "Entries changed after it was paid — they'd now come to {a}.", my: "ပေးပြီးနောက် စာရင်း ပြောင်းထားသည် — ယခု တွက်လျှင် {a}။" },
  paidBadge:      { en: "Paid", my: "ပေးပြီး" },
  paidCount:      { en: "{p} of {n} paid", my: "{n} ဦးအနက် {p} ဦး ပေးပြီး" },
  staffEmail:     { en: "STM Daily email (for Telegram notices)", my: "STM Daily email (Telegram အသိပေးရန်)" },
  staffEmailHelp: { en: "The email they sign in to STM Daily with. Once they connect Telegram there, salary notices reach them.", my: "STM Daily ဝင်သော email။ ထိုမှ Telegram ချိတ်ထားလျှင် လစာ အသိပေးချက် ရပါမည်။" },

  exportBtn:      { en: "Export Excel", my: "Excel ထုတ်ရန်" },
  exportTitle:    { en: "Export salaries to Excel", my: "လစာ Excel ထုတ်ရန်" },
  exportHelp:     { en: "Every employee, month by month — plus every entry. Paid months use the figures saved when they were paid.", my: "ဝန်ထမ်းအားလုံး လအလိုက် နှင့် စာရင်းအားလုံး ပါဝင်သည်။ ပေးပြီးသော လများသည် ပေးစဉ်က သိမ်းထားသော ပမာဏ ဖြစ်သည်။" },
  presetThis:     { en: "This month", my: "ယခုလ" },
  presetLast:     { en: "Last month", my: "ပြီးခဲ့သောလ" },
  presetLast3:    { en: "Last 3 months", my: "နောက်ဆုံး ၃ လ" },
  presetLast6:    { en: "Last 6 months", my: "နောက်ဆုံး ၆ လ" },
  presetYear:     { en: "This year", my: "ယခုနှစ်" },
  presetCustom:   { en: "Custom", my: "စိတ်ကြိုက်" },
  fromMonth:      { en: "From", my: "မှ" },
  toMonth:        { en: "To", my: "အထိ" },
  monthsN:        { en: "{n} month(s): {range}", my: "{n} လ — {range}" },
  download:       { en: "Download Excel", my: "Excel ဒေါင်းလုဒ်" },
  preparing:      { en: "Preparing…", my: "ပြင်ဆင်နေသည်…" },
  excelEnglish:   { en: "", my: "Excel ဖိုင်ကို အင်္ဂလိပ်ဘာသာဖြင့် ထုတ်ပေးပါမည်။" },
  exportFailed:   { en: "Couldn't make the file. Check the connection and try again.", my: "ဖိုင် မထုတ်နိုင်ပါ။ အင်တာနက် စစ်ပြီး ထပ်ကြိုးစားပါ။" },

  setupNeeded:    { en: "Salary Management needs a one-time database update. Run the salary SQL in Supabase, then reload.", my: "Supabase တွင် salary SQL ကို တစ်ကြိမ် run ပြီး ပြန်ဖွင့်ပါ။" },
  loadFailed:     { en: "Couldn't load. Check the connection and try again.", my: "မဖွင့်နိုင်ပါ။ အင်တာနက် စစ်ပြီး ထပ်ကြိုးစားပါ။" },
  retry:          { en: "Try again", my: "ထပ်ကြိုးစားရန်" },
} as const;

export type SalaryKey = keyof typeof S;

export function str(lang: DebtLang, key: SalaryKey, vars?: Record<string, string | number>): string {
  let s: string = S[key][lang];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

export function useSalaryT() {
  const lang = useDebtLang();
  return useCallback((key: SalaryKey, vars?: Record<string, string | number>) => str(lang, key, vars), [lang]);
}

const TYPE_KEY: Record<SalaryItemType, SalaryKey> = { Overtime: "overtime", Bonus: "bonus", Deduction: "deductionOne", Refund: "refund" };
export const typeLabel = (type: SalaryItemType, lang: DebtLang) => str(lang, TYPE_KEY[type]);
