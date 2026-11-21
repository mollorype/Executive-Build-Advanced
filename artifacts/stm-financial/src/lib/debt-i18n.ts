// Debt Tracker in English and Myanmar. The choice is remembered on this device
// and shared by every Debt Tracker screen (list, profile, export).

import { useCallback, useSyncExternalStore } from "react";
import type { DebtCategoryId, DebtRelation } from "./debt-supabase";

export type DebtLang = "en" | "my";

const KEY = "stm_debt_lang";
const listeners = new Set<() => void>();

function readLang(): DebtLang {
  try { return localStorage.getItem(KEY) === "my" ? "my" : "en"; } catch { return "en"; }
}
let current: DebtLang = typeof window === "undefined" ? "en" : readLang();

export function setDebtLang(lang: DebtLang) {
  current = lang;
  try { localStorage.setItem(KEY, lang); } catch { /* storage blocked: lasts for this visit */ }
  listeners.forEach(l => l());
}

export function useDebtLang(): DebtLang {
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => current,
    () => "en",
  );
}

const S = {
  // ── List page ──────────────────────────────────────────────────────────────
  debtTracker:        { en: "Debt Tracker", my: "အကြွေးစာရင်း" },
  subtitle:           { en: "Manage debt profiles & repayment history", my: "အကြွေးယူသူများနှင့် ပြန်ဆပ်မှု မှတ်တမ်း" },
  newProfile:         { en: "New Profile", my: "စာရင်းအသစ်" },
  offlineList:        { en: "Offline — showing the last loaded data. Changes will sync automatically once you're back online.", my: "အင်တာနက် မရှိပါ — နောက်ဆုံးဖွင့်ထားသော အချက်အလက်ကို ပြနေသည်။ အင်တာနက် ပြန်ရလျှင် အလိုအလျောက် ချိတ်ဆက်ပါမည်။" },
  totalOutstanding:   { en: "Total Outstanding Debt", my: "ပြန်ရရန် ကျန်ငွေ စုစုပေါင်း" },
  excludes:           { en: "Excludes {list}", my: "{list} မပါဝင်ပါ" },
  debtorsOpen1:       { en: "{n} debtor with open balance", my: "ကျန်ငွေရှိသူ {n} ဦး" },
  debtorsOpenN:       { en: "{n} debtors with open balance", my: "ကျန်ငွေရှိသူ {n} ဦး" },
  pctOfAll:           { en: "{p}% of all outstanding debt", my: "ကျန်ငွေ အားလုံး၏ {p}%" },
  totalBalanceAll:    { en: "Total Balance (All Profiles)", my: "ကျန်ငွေ စုစုပေါင်း (အားလုံး)" },
  activeProfiles:     { en: "{n} active profiles", my: "စာရင်း {n} ခု" },
  cleared:            { en: "Cleared", my: "ဆပ်ပြီး" },
  fullyPaidOff:       { en: "Fully paid off", my: "အပြည့် ဆပ်ပြီး" },
  repaid:             { en: "Repaid", my: "ပြန်ဆပ်ပြီး" },
  repaidOfBorrowed:   { en: "{a} of {b} borrowed", my: "ချေးငွေ {b} အနက် {a}" },
  ofEverything:       { en: "Of everything borrowed", my: "ချေးငွေ အားလုံးအနက်" },
  searchPh:           { en: "Search profiles by name…", my: "အမည်ဖြင့် ရှာရန်…" },
  sortNewest:         { en: "Newest First", my: "အသစ်ဆုံး အရင်" },
  sortOldest:         { en: "Oldest First", my: "အဟောင်းဆုံး အရင်" },
  sortHighest:        { en: "Highest Balance", my: "ကျန်ငွေ အများဆုံး" },
  sortLowest:         { en: "Lowest Balance", my: "ကျန်ငွေ အနည်းဆုံး" },
  sortAZ:             { en: "A → Z (Name)", my: "အမည် A → Z" },
  sortZA:             { en: "Z → A (Name)", my: "အမည် Z → A" },
  debtProfiles:       { en: "Debt Profiles", my: "အကြွေးစာရင်းများ" },
  profiles1:          { en: "{n} profile", my: "{n} ဦး" },
  profilesN:          { en: "{n} profiles", my: "{n} ဦး" },
  deleteAll:          { en: "Delete all", my: "အားလုံး ဖျက်ရန်" },
  deleteEveryProfile: { en: "Delete every debt profile", my: "အကြွေးစာရင်း အားလုံး ဖျက်ရန်" },
  unavailableOffline: { en: "Unavailable offline", my: "အင်တာနက် မရှိ၍ မရပါ" },
  loadingProfiles:    { en: "Loading profiles…", my: "ဖွင့်နေသည်…" },
  noMatch:            { en: "No profiles match your search", my: "ရှာသည့်အမည်နှင့် ကိုက်ညီသူ မရှိပါ" },
  noProfiles:         { en: "No debt profiles yet", my: "အကြွေးစာရင်း မရှိသေးပါ" },
  createFirst:        { en: "Create the first profile", my: "ပထမဆုံး စာရင်း ဖန်တီးရန်" },
  colName:            { en: "Name", my: "အမည်" },
  colRelation:        { en: "Relation", my: "ဆက်နွယ်မှု" },
  colBalance:         { en: "Balance", my: "ကျန်ငွေ" },
  pctRepaid:          { en: "{p} repaid", my: "{p} ဆပ်ပြီး" },
  exportLedger:       { en: "Export / Preview ledger", my: "စာရင်း ကြည့်ရန် / ထုတ်ရန်" },
  exportLedgerFor:    { en: "Export ledger for {name}", my: "{name} ၏ စာရင်း ထုတ်ရန်" },
  deleteProfile:      { en: "Delete profile", my: "စာရင်း ဖျက်ရန်" },
  deleteProfileFor:   { en: "Delete profile {name}", my: "{name} ၏ စာရင်း ဖျက်ရန်" },
  confirmDeleteProfile: { en: "Delete \"{name}\" and all their transactions?\n\nThis cannot be undone.", my: "\"{name}\" နှင့် ငွေစာရင်း အားလုံးကို ဖျက်မလား?\n\nပြန်ယူ၍ မရပါ။" },

  // ── Create profile ─────────────────────────────────────────────────────────
  createDebtProfile:  { en: "Create Debt Profile", my: "အကြွေးစာရင်း အသစ် ဖန်တီးရန်" },
  name:               { en: "Name", my: "အမည်" },
  namePh:             { en: "Full name or alias", my: "အမည် (သို့) ခေါ်နာမည်" },
  relation:           { en: "Relation", my: "ဆက်နွယ်မှု" },
  phoneNumbers:       { en: "Phone Numbers", my: "ဖုန်းနံပါတ်များ" },
  upTo3:              { en: "(up to 3)", my: "(၃ ခုအထိ)" },
  add:                { en: "Add", my: "ထည့်ရန်" },
  primary:            { en: "Primary", my: "အဓိက" },
  removePhone:        { en: "Remove phone number {n}", my: "ဖုန်းနံပါတ် {n} ဖယ်ရန်" },
  date:               { en: "Date", my: "ရက်စွဲ" },
  creditLimit:        { en: "Credit Limit", my: "အကြွေး ကန့်သတ်ငွေ" },
  optional:           { en: "(optional)", my: "(မထည့်လည်းရ)" },
  noLimitPh:          { en: "Leave blank for no limit", my: "ကန့်သတ်ချက် မရှိလျှင် ကွက်လပ်ထားပါ" },
  noLimitHint:        { en: "(optional — leave blank for no limit)", my: "(ကန့်သတ်ချက် မရှိလျှင် ကွက်လပ်ထားပါ)" },
  creditLimitHelp:    { en: "An alert fires when the balance exceeds this amount.", my: "ကျန်ငွေ ဤပမာဏထက် ကျော်လျှင် သတိပေးပါမည်။" },
  dueDate:            { en: "Payment Due Date", my: "ပေးချေရမည့်ရက်" },
  dueHelp:            { en: "An alert fires when this date passes and money is still owed.", my: "ဤရက် ကျော်ပြီး ကျန်ငွေ ရှိနေလျှင် သတိပေးပါမည်။" },
  startingAmount:     { en: "Starting Amount", my: "စတင် အကြွေးငွေ" },
  unknownPh:          { en: "Leave blank if unknown", my: "မသိလျှင် ကွက်လပ်ထားပါ" },
  startingHelp:       { en: "Can be updated later via transactions.", my: "နောက်မှ ငွေစာရင်းဖြင့် ပြင်နိုင်သည်။" },
  initialDebtFuel:    { en: "Initial Debt (Fuel Details)", my: "ပထမ အကြွေး (ဆီ အသေးစိတ်)" },
  productType:        { en: "Product Type", my: "ဆီ အမျိုးအစား" },
  totalAmount:        { en: "Total Amount", my: "စုစုပေါင်း ငွေ" },
  totalAmountMMK:     { en: "Total Amount (MMK)", my: "စုစုပေါင်း ငွေ (ကျပ်)" },
  liters:             { en: "Liters (L)", my: "လီတာ (L)" },
  gallons:            { en: "Gallons (G)", my: "ဂါလံ (G)" },
  pricePerLiter:      { en: "Price Per Liter", my: "တစ်လီတာ ဈေး" },
  egPrice:            { en: "e.g. 1650", my: "ဥပမာ 1650" },
  remarks:            { en: "Remarks", my: "မှတ်ချက်" },
  remarksPh:          { en: "e.g. Plate no., vehicle type…", my: "ဥပမာ ကားနံပါတ်၊ ကားအမျိုးအစား…" },
  creating:           { en: "Creating…", my: "ဖန်တီးနေသည်…" },
  createProfile:      { en: "Create Profile", my: "စာရင်း ဖန်တီးမည်" },
  nameRequired:       { en: "Name is required.", my: "အမည် ထည့်ပါ။" },
  productPD:          { en: "PD (Premium Diesel)", my: "PD (ပရီမီယံ ဒီဇယ်)" },
  productHSD:         { en: "Diesel", my: "ဒီဇယ်" },

  // ── Delete all ─────────────────────────────────────────────────────────────
  deleteAllQ:         { en: "Delete all debt profiles?", my: "အကြွေးစာရင်း အားလုံးကို ဖျက်မလား?" },
  typeToConfirm:      { en: "Type {phrase} to confirm", my: "အတည်ပြုရန် {phrase} ဟု ရိုက်ပါ" },
  cancel:             { en: "Cancel", my: "မလုပ်တော့ပါ" },
  deleting:           { en: "Deleting…", my: "ဖျက်နေသည်…" },
  nothingDeleted:     { en: "Nothing was deleted. Your account may not have permission to delete debt profiles.", my: "ဘာမှ မဖျက်ရပါ။ သင့်အကောင့်တွင် ဖျက်ခွင့် မရှိနိုင်ပါ။" },

  // ── Profile page ───────────────────────────────────────────────────────────
  createdOn:          { en: "{relation} · Created {date}", my: "{relation} · {date} တွင် ဖန်တီး" },
  editProfile:        { en: "Edit Profile", my: "စာရင်း ပြင်ရန်" },
  closePanel:         { en: "Close panel", my: "ပိတ်ရန်" },
  close:              { en: "Close", my: "ပိတ်ရန်" },
  offlineDetail:      { en: "Offline — showing the last loaded data for this profile.", my: "အင်တာနက် မရှိပါ — နောက်ဆုံးဖွင့်ထားသော အချက်အလက်ကို ပြနေသည်။" },
  debtCleared:        { en: "Debt fully cleared", my: "အကြွေး အပြည့် ဆပ်ပြီးပါပြီ" },
  creditExceeded:     { en: "Credit Limit Exceeded", my: "အကြွေး ကန့်သတ်ငွေ ကျော်နေသည်" },
  creditExceededBody: { en: "Balance {b} exceeds limit of {l}", my: "ကျန်ငွေ {b} သည် ကန့်သတ်ငွေ {l} ထက် ကျော်နေသည်" },
  overdue:            { en: "Payment Overdue", my: "ပေးချေရမည့်ရက် ကျော်နေသည်" },
  overdueBody:        { en: "Due date {d} has passed", my: "ပေးချေရမည့်ရက် {d} ကျော်သွားပြီ" },
  age:                { en: "Age", my: "အသက်" },
  egAge:              { en: "e.g. 35", my: "ဥပမာ 35" },
  phone:              { en: "Phone", my: "ဖုန်း" },
  primarySuffix:      { en: " (primary)", my: " (အဓိက)" },
  currentBalance:     { en: "Current Balance", my: "လက်ရှိ ကျန်ငွေ" },
  originalDebt:       { en: "Original Debt", my: "မူလ အကြွေး" },
  paymentDue:         { en: "Payment Due", my: "ပေးချေရမည့်ရက်" },
  lastPayment:        { en: "Last Payment", my: "နောက်ဆုံး ပေးချေသည့်ရက်" },
  noPaymentsYet:      { en: "No payments yet", my: "မပေးချေရသေးပါ" },
  repaymentProgress:  { en: "Repayment Progress", my: "ပြန်ဆပ်မှု အခြေအနေ" },
  noDebtYet:          { en: "No debt recorded yet.", my: "အကြွေး မှတ်တမ်း မရှိသေးပါ။" },
  repaidWord:         { en: "repaid", my: "ဆပ်ပြီး" },
  ofTheDebtRepaid:    { en: "{p} of the debt repaid", my: "အကြွေး၏ {p} ဆပ်ပြီး" },
  total:              { en: "Total", my: "စုစုပေါင်း" },
  overpaidBy:         { en: "Paid {a} more than owed.", my: "ပေးရမည့်ငွေထက် {a} ပိုပေးထားသည်။" },
  recordTransaction:  { en: "Record Transaction", my: "ငွေစာရင်း မှတ်ရန်" },
  paymentReduces:     { en: "Payment (reduces debt)", my: "ငွေပေးချေ (အကြွေး လျော့)" },
  newDebtAdds:        { en: "New Debt (adds to balance)", my: "အကြွေးသစ် (ကျန်ငွေ တိုး)" },
  amount:             { en: "Amount", my: "ပမာဏ" },
  note:               { en: "Note", my: "မှတ်ချက်" },
  notePh:             { en: "e.g. Partial payment, Invoice #2…", my: "ဥပမာ တစ်စိတ်တစ်ပိုင်း ပေးချေမှု၊ ပြေစာ #2…" },
  enterTotal:         { en: "Enter a Total Amount.", my: "စုစုပေါင်း ငွေ ထည့်ပါ။" },
  enterAmount:        { en: "Enter a valid amount.", my: "မှန်ကန်သော ပမာဏ ထည့်ပါ။" },
  saving:             { en: "Saving…", my: "သိမ်းနေသည်…" },
  recordPayment:      { en: "Record Payment", my: "ပေးချေမှု မှတ်မည်" },
  addDebt:            { en: "Add Debt", my: "အကြွေး ထည့်မည်" },
  txnHistory:         { en: "Transaction History", my: "ငွေစာရင်း မှတ်တမ်း" },
  noTxns:             { en: "No transactions yet", my: "ငွေစာရင်း မရှိသေးပါ" },
  debitLabel:         { en: "Debit", my: "အကြွေး" },
  creditLabel:        { en: "Credit", my: "ပေးချေ" },
  balance:            { en: "Balance", my: "ကျန်ငွေ" },
  description:        { en: "Description", my: "အကြောင်းအရာ" },
  actions:            { en: "Actions", my: "လုပ်ဆောင်ချက်" },
  paidOff:            { en: "Paid off", my: "ဆပ်ပြီး" },
  leftAmt:            { en: "{a} left", my: "ကျန် {a}" },
  addRemarkPh:        { en: "Add a remark…", my: "မှတ်ချက် ထည့်ရန်…" },
  save:               { en: "Save", my: "သိမ်းမည်" },
  cancelRemark:       { en: "Cancel editing remark", my: "မှတ်ချက် မပြင်တော့ပါ" },
  flatAmount:         { en: "(Flat Amount Purchase)", my: "(ငွေပမာဏဖြင့် ဝယ်ယူ)" },
  dailyApp:           { en: "Daily App", my: "Daily App" },
  manual:             { en: "Manual", my: "ကိုယ်တိုင်ထည့်" },
  editRemark:         { en: "edit remark", my: "မှတ်ချက် ပြင်ရန်" },
  remarkBtn:          { en: "remark", my: "မှတ်ချက်" },
  highlight:          { en: "Highlight transaction", my: "အမှတ်အသား ပြုရန်" },
  removeHighlight:    { en: "Remove highlight", my: "အမှတ်အသား ဖြုတ်ရန်" },
  editTxn:            { en: "Edit transaction", my: "ငွေစာရင်း ပြင်ရန်" },
  deleteTxn:          { en: "Delete transaction", my: "ငွေစာရင်း ဖျက်ရန်" },
  confirmDeleteTxn:   { en: "Delete transaction {n}?\nThis will reverse its effect on the balance.", my: "ငွေစာရင်း {n} ကို ဖျက်မလား?\nကျန်ငွေကိုလည်း ပြန်ပြင်ပါမည်။" },
  payment:            { en: "Payment", my: "ပေးချေမှု" },
  debtEntry:          { en: "Debt Entry", my: "အကြွေး" },
  transaction:        { en: "Transaction", my: "ငွေစာရင်း" },
  editEntry:          { en: "Edit Entry", my: "ပြင်ဆင်ရန်" },
  saveChanges:        { en: "Save Changes", my: "သိမ်းမည်" },
  profile:            { en: "Profile", my: "စာရင်း" },
  editDetails:        { en: "Edit Details", my: "အချက်အလက် ပြင်ရန်" },

  // ── Ledger export ──────────────────────────────────────────────────────────
  debtorsLedger:      { en: "Debtors Ledger", my: "အကြွေး စာရင်းချုပ်" },
  offlineLedger:      { en: "Offline — showing the last loaded transactions for this profile.", my: "အင်တာနက် မရှိပါ — နောက်ဆုံးဖွင့်ထားသော ငွေစာရင်းကို ပြနေသည်။" },
  period:             { en: "Period:", my: "ကာလ:" },
  fromDate:           { en: "From date", my: "မှ" },
  toDate:             { en: "To date", my: "အထိ" },
  preparing:          { en: "Preparing…", my: "ပြင်ဆင်နေသည်…" },
  downloadExcel:      { en: "Download Excel", my: "Excel ဒေါင်းလုဒ်" },
  sendPdf:            { en: "Send PDF", my: "PDF ပို့ရန်" },
  sendStatement:      { en: "Send statement (PDF) to customer", my: "အကြွေးစာရင်း PDF ကို ဖောက်သည်ထံ ပို့ရန်" },
  pdfDownloaded:      { en: "PDF downloaded — attach it in Viber, Telegram or Messenger.", my: "PDF ဒေါင်းလုဒ် ပြီးပါပြီ — Viber / Telegram / Messenger တွင် ပူးတွဲ ပို့ပါ။" },
  pdfFailed:          { en: "Couldn't make the PDF. Try again.", my: "PDF မထုတ်နိုင်ပါ။ ထပ်ကြိုးစားပါ။" },
  loadingTxns:        { en: "Loading transactions…", my: "ငွေစာရင်း ဖွင့်နေသည်…" },
  ledgerTitle:        { en: "DEBTORS LEDGER", my: "အကြွေး စာရင်းချုပ်" },
  customerName:       { en: "Customer Name", my: "ဖောက်သည် အမည်" },
  phoneNumber:        { en: "Phone Number", my: "ဖုန်းနံပါတ်" },
  statementPeriod:    { en: "Statement Period", my: "စာရင်း ကာလ" },
  periodRange:        { en: "{from} to {to}", my: "{from} မှ {to} အထိ" },
  debitMMK:           { en: "Debit (MMK)", my: "အကြွေး (ကျပ်)" },
  creditMMK:          { en: "Credit (MMK)", my: "ပေးချေ (ကျပ်)" },
  runningBalanceMMK:  { en: "Running Balance (MMK)", my: "ကျန်ငွေ (ကျပ်)" },
  openingBalance:     { en: "Opening Balance", my: "အစ ကျန်ငွေ" },
  noTxnsInPeriod:     { en: "No transactions in this period", my: "ဤကာလတွင် ငွေစာရင်း မရှိပါ" },
  periodTotals:       { en: "Period Totals", my: "ကာလ စုစုပေါင်း" },
  closingBalance:     { en: "Closing Balance", my: "နောက်ဆုံး ကျန်ငွေ" },
  excelEnglish:       { en: "", my: "Excel ဖိုင်ကို အင်္ဂလိပ်ဘာသာဖြင့် ထုတ်ပေးပါမည်။" },

  language:           { en: "Language", my: "ဘာသာစကား" },
} as const;

export type DebtKey = keyof typeof S;

export function tr(lang: DebtLang, key: DebtKey, vars?: Record<string, string | number>): string {
  let s: string = S[key][lang];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** t("key", { n: 3 }) in the current Debt Tracker language. */
export function useDebtT() {
  const lang = useDebtLang();
  return useCallback((key: DebtKey, vars?: Record<string, string | number>) => tr(lang, key, vars), [lang]);
}

const RELATION_MY: Record<DebtRelation, string> = {
  Friends: "သူငယ်ချင်း",
  Family: "မိသားစု",
  Own: "ကိုယ်ပိုင်",
  Contract: "စာချုပ်",
  Vendor: "ရောင်းသူ",
  Employee: "ဝန်ထမ်း",
  "On Paper": "စာရွက်ပေါ်",
  Other: "အခြား",
};

/** Relation names are stored in English; this is only how they're shown. */
export function relationLabel(r: DebtRelation, lang: DebtLang): string {
  return lang === "my" ? RELATION_MY[r] ?? r : r;
}

const CATEGORY_MY: Record<DebtCategoryId, string> = {
  normal: "ပုံမှန် / အခြား",
  own_family: "ကိုယ်ပိုင်နှင့် မိသားစု",
  on_paper: "စာရွက်ပေါ်",
};

export function categoryLabel(id: DebtCategoryId, en: string, lang: DebtLang): string {
  return lang === "my" ? CATEGORY_MY[id] : en;
}
