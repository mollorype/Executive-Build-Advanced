// English / Myanmar strings for the P-P Ledger page and its dialogs.
// "P-P" and "J-C" stay as they are in both languages.

import { makeT } from "./app-i18n";
import type { MovementKind, PipaProduct } from "./pipa-ledger";

export const usePipaT = makeT({
  // Fuels (same names as lib/pipa-ledger PRODUCT_LABELS)
  p_92: { en: "Fuel 92", my: "ဓာတ်ဆီ 92" },
  p_95: { en: "Fuel 95", my: "ဓာတ်ဆီ 95" },
  p_PD: { en: "Premium Diesel", my: "ပရီမီယံ ဒီဇယ်" },
  p_D: { en: "Diesel", my: "ဒီဇယ်" },

  // Movement kinds — form buttons
  k_buy: { en: "Buy", my: "ဝယ်" },
  k_borrow: { en: "Borrow", my: "ချေး (ယူ)" },
  k_borrow_returned: { en: "Return borrowed", my: "ချေးထားသည်ကို ပြန်ပေး" },
  k_borrow_paid: { en: "Pay cash for borrowed", my: "ချေးထားသည်အတွက် ငွေပေး" },
  k_lend: { en: "Lend", my: "ချေး (ပေး)" },
  k_lend_returned: { en: "They returned", my: "သူတို့ ပြန်ပေး" },
  k_lend_paid: { en: "They paid cash", my: "သူတို့ ငွေပေး" },
  k_used: { en: "Sold / used", my: "ရောင်း / သုံး" },
  k_adjust: { en: "Stock count", my: "လက်ကျန် စစ်ဆေး" },

  // Movement kinds — help under the form title
  help_buy: { en: "P-P you bought from a station.", my: "ဆိုင်တစ်ခုမှ ဝယ်သော P-P။" },
  help_borrow: { en: "P-P a station gave you, to return later.", my: "ဆိုင်တစ်ခုမှ ချေးယူထားသော P-P (နောက်မှ ပြန်ပေးရန်)။" },
  help_lend: { en: "P-P you gave a station, to get back later.", my: "ဆိုင်တစ်ခုကို ချေးပေးထားသော P-P (နောက်မှ ပြန်ရရန်)။" },
  help_borrow_returned: { en: "P-P you gave back to a station you borrowed from.", my: "ချေးယူခဲ့သော ဆိုင်သို့ ပြန်ပေးသော P-P။" },
  help_lend_returned: { en: "P-P a station gave back to you.", my: "ဆိုင်တစ်ခုမှ ပြန်ပေးသော P-P။" },
  help_borrow_paid: { en: "You paid cash instead of returning borrowed P-P.", my: "ချေးထားသော P-P ကို ပြန်မပေးဘဲ ငွေဖြင့် ပေးချေ။" },
  help_lend_paid: { en: "A station paid you cash instead of returning P-P.", my: "ဆိုင်တစ်ခုက P-P ပြန်မပေးဘဲ ငွေဖြင့် ပေးချေ။" },
  help_used: { en: "P-P sold, or poured into the pumps.", my: "ရောင်းသော သို့မဟုတ် ပန့်ထဲ ထည့်သော P-P။" },
  help_adjust: { en: "", my: "" },

  // History lines
  h_buy: { en: "Bought {qty}", my: "{qty} ဝယ်" },
  h_buy_d: { en: "from {station}", my: "{station} မှ" },
  h_borrow: { en: "Borrowed {qty}", my: "{qty} ချေးယူ" },
  h_borrow_d: { en: "from {station}", my: "{station} မှ" },
  h_borrow_returned: { en: "Returned {qty}", my: "{qty} ပြန်ပေး" },
  h_borrow_returned_d: { en: "to {station} (borrowed)", my: "{station} သို့ (ချေးထားသည်)" },
  h_borrow_paid: { en: "Paid cash for {qty}", my: "{qty} အတွက် ငွေပေး" },
  h_borrow_paid_d: { en: "borrowed from {station}", my: "{station} မှ ချေးထားသည်" },
  h_lend: { en: "Lent {qty}", my: "{qty} ချေးပေး" },
  h_lend_d: { en: "to {station}", my: "{station} သို့" },
  h_lend_returned: { en: "Got back {qty}", my: "{qty} ပြန်ရ" },
  h_lend_returned_d: { en: "from {station} (lent)", my: "{station} မှ (ချေးပေးထားသည်)" },
  h_lend_paid: { en: "{station} paid cash for {qty}", my: "{station} က {qty} အတွက် ငွေပေး" },
  h_lend_paid_d: { en: "lent to them", my: "သူတို့ကို ချေးပေးထားသည်" },
  h_used: { en: "Sold / used {qty}", my: "{qty} ရောင်း / သုံး" },
  h_adjust: { en: "Stock count {qty}", my: "လက်ကျန် စစ်ဆေး {qty}" },
  h_price: { en: "{perPipa}/P-P ({perLiter}/L) · total {total}", my: "{perPipa}/P-P ({perLiter}/L) · စုစုပေါင်း {total}" },

  // Page
  notInstalled: { en: "The P-P Ledger isn't installed in the database yet. Run the pipa_ledger migration in the Supabase SQL Editor.", my: "P-P စာရင်းကို database တွင် မထည့်ရသေးပါ။ Supabase SQL Editor တွင် pipa_ledger migration ကို run ပါ။" },
  confirmUndoShift: { en: "Undo this shift deduction? Every fuel line from that deduction is removed, and its shifts can be deducted again.", my: "ဤဆိုင်း နုတ်ချက်ကို ပြန်ဖျက်မလား? ထိုနုတ်ချက်မှ ဆီ စာကြောင်းအားလုံး ဖယ်ရှားပြီး ဆိုင်းများကို ထပ်နုတ်နိုင်ပါမည်။" },
  confirmDelete: { en: "Delete this record?\n\n{title}", my: "ဤမှတ်တမ်းကို ဖျက်မလား?\n\n{title}" },
  poKept: { en: "\n\nIts purchase order in PO Registry is kept.", my: "\n\nPO မှတ်ပုံတင်ရှိ ၎င်း၏ PO ကို ဆက်ထားပါမည်။" },
  deleteFailed: { en: "Couldn't delete: {msg}", my: "မဖျက်နိုင်ပါ: {msg}" },
  shiftUndone: { en: "Shift deduction undone.", my: "ဆိုင်း နုတ်ချက် ပြန်ဖျက်ပြီး။" },
  recordDeleted: { en: "Record deleted.", my: "မှတ်တမ်း ဖျက်ပြီး။" },
  title: { en: "P-P Ledger", my: "P-P စာရင်း" },
  subtitle: { en: "P-P bought, borrowed and lent — by station", my: "ဝယ်၊ ချေးယူ၊ ချေးပေးသော P-P — ဆိုင်အလိုက်" },
  record: { en: "Record", my: "မှတ်ရန်" },
  deductBtn: { en: "Deduct shift sales", my: "ဆိုင်း ရောင်းအား နုတ်ရန်" },
  countBtn: { en: "Count stock", my: "လက်ကျန် စစ်ရန်" },
  addStation: { en: "Add station", my: "ဆိုင် ထည့်ရန်" },
  stockOnHand: { en: "Stock on hand", my: "လက်ကျန်" },
  belowZero: { en: "Below zero — run a stock count", my: "သုညအောက် — လက်ကျန် စစ်ပါ" },
  stations: { en: "Stations", my: "ဆိုင်များ" },
  stationsEmpty: { en: "Add the stations you buy from, borrow from or lend to.", my: "ဝယ်၊ ချေးယူ၊ ချေးပေးသော ဆိုင်များကို ထည့်ပါ။" },
  addAStation: { en: "+ Add a station", my: "+ ဆိုင် ထည့်ရန်" },
  settled: { en: "All settled", my: "ရှင်းပြီး" },
  youOwe: { en: "You owe them", my: "သူတို့ကို ပေးရန်" },
  theyOwe: { en: "They owe you", my: "သူတို့ထံမှ ရရန်" },
  lastBought: { en: "Last bought: {product} @ {perLiter}/L ({perPipa}/pipa) · {date}", my: "နောက်ဆုံးဝယ်: {product} @ {perLiter}/L ({perPipa}/P-P) · {date}" },
  history: { en: "History", my: "မှတ်တမ်း" },
  prices: { en: "Purchase prices (per litre)", my: "ဝယ်စျေး (လီတာအလိုက်)" },
  cheapest: { en: "CHEAPEST", my: "အသက်သာဆုံး" },
  lastAvg: { en: "last {date} · avg {avg}", my: "နောက်ဆုံး {date} · ပျမ်းမျှ {avg}" },
  noMovements: { en: "No P-P movements yet.", my: "P-P မှတ်တမ်း မရှိသေးပါ။" },
  inPO: { en: " · in PO Registry", my: " · PO မှတ်ပုံတင်တွင်" },
  stockEffect: { en: "Effect on stock", my: "လက်ကျန်အပေါ် သက်ရောက်မှု" },
  undoShift: { en: "Undo shift deduction", my: "ဆိုင်း နုတ်ချက် ပြန်ဖျက်ရန်" },
  deleteRecord: { en: "Delete record", my: "မှတ်တမ်း ဖျက်ရန်" },
  cashNote: { en: "Cash settlements (paying for borrowed P-P, or being paid for lent ones) clear what's owed without moving any P-P, so they show ±0.", my: "ငွေဖြင့် ရှင်းခြင်း (ချေးယူထားသော P-P အတွက် ငွေပေးခြင်း သို့မဟုတ် ချေးပေးထားသည်အတွက် ငွေရခြင်း) သည် P-P မရွေ့ဘဲ အကြွေးကိုသာ ရှင်းသဖြင့် ±0 ပြပါသည်။" },
  saved: { en: "Saved.", my: "သိမ်းပြီး။" },
  stationSaved: { en: "Station saved.", my: "ဆိုင် သိမ်းပြီး။" },
  stationAdded: { en: "Station added.", my: "ဆိုင် ထည့်ပြီး။" },
  countSaved: { en: "Stock count saved.", my: "လက်ကျန် စစ်ဆေးချက် သိမ်းပြီး။" },
  deducted: { en: "Shift sales deducted from stock.", my: "ဆိုင်း ရောင်းအားကို လက်ကျန်မှ နုတ်ပြီး။" },

  // Shared dialog bits
  close: { en: "Close", my: "ပိတ်ရန်" },
  note: { en: "Note", my: "မှတ်ချက်" },
  optional: { en: "Optional", my: "မဖြည့်လည်း ရ" },
  save: { en: "Save", my: "သိမ်းရန်" },

  // Movement dialog
  mvTitle: { en: "Record P-P movement", my: "P-P မှတ်တမ်း ထည့်ရန်" },
  chooseStationErr: { en: "Choose a station.", my: "ဆိုင် ရွေးပါ။" },
  pipasErr: { en: "Enter how many P-P (more than 0).", my: "P-P အရေအတွက် ထည့်ပါ (0 ထက် များရမည်)။" },
  sizeErr: { en: "P-P size must be more than 0 litres.", my: "P-P အရွယ်အစား 0 လီတာထက် များရမည်။" },
  nothingOwed: { en: "Nothing is owed for {product} with {station}.", my: "{station} နှင့် {product} အတွက် အကြွေး မရှိပါ။" },
  onlyOwed: { en: "Only {n} P-P of {product} are owed with {station}.", my: "{station} နှင့် {product} P-P {n} သာ အကြွေး ရှိပါသည်။" },
  priceErr: { en: "Enter the price.", my: "စျေး ထည့်ပါ။" },
  poFailed: { en: "Couldn't add the purchase order: {msg}", my: "PO မထည့်နိုင်ပါ: {msg}" },
  station: { en: "Station *", my: "ဆိုင် *" },
  firstStation: { en: "+ Add your first station", my: "+ ပထမဆုံး ဆိုင် ထည့်ရန်" },
  choose: { en: "Choose…", my: "ရွေးပါ…" },
  fuel: { en: "Fuel", my: "ဆီ" },
  date: { en: "Date", my: "ရက်စွဲ" },
  owedFor: { en: "Owed for {product} with {station}: ", my: "{station} နှင့် {product} အကြွေး: " },
  pricePerPP: { en: "Price per P-P", my: "P-P တစ်ခု စျေး" },
  pricePerL: { en: "Price per litre", my: "လီတာ စျေး" },
  mmkPerPP: { en: "MMK / P-P", my: "MMK / P-P" },
  mmkPerL: { en: "MMK / litre", my: "MMK / လီတာ" },
  ppSize: { en: "P-P size (L)", my: "P-P အရွယ် (L)" },
  totalFor: { en: "Total ", my: "စုစုပေါင်း " },
  forLiters: { en: " for {liters}", my: " ({liters} အတွက်)" },
  addToPOa: { en: "Also add to ", my: "" },
  addToPOb: { en: " (queued, in litres) so profit tracking includes it", my: " တွင်လည်း ထည့်ရန် (စောင့်ဆိုင်း၊ လီတာဖြင့်) — အမြတ်တွက်ရာတွင် ပါစေရန်" },
  poRegistry: { en: "PO Registry", my: "PO မှတ်ပုံတင်" },

  // Count dialog
  countTitle: { en: "Count stock", my: "လက်ကျန် စစ်ရန်" },
  countSub: { en: "Enter the P-P actually there. Leave a fuel blank to skip it.", my: "တကယ်ရှိသော P-P ကို ထည့်ပါ။ မစစ်လိုသော ဆီကို ကွက်လပ် ထားပါ။" },
  saveCorrections: { en: "Save {n} correction(s)", my: "ပြင်ဆင်ချက် {n} ခု သိမ်းရန်" },
  done: { en: "Done", my: "ပြီးပြီ" },
  calculated: { en: "Calculated: {n} P-P", my: "တွက်ချက်ထားသည်: {n} P-P" },
  shortage: { en: "Shortage", my: "လို" },
  extra: { en: "Extra", my: "ပို" },
  countedOf: { en: "Counted P-P of {product}", my: "{product} စစ်ထားသော P-P" },
  counted: { en: "Counted", my: "စစ်ထားသည်" },

  // Deduct dialog
  alreadyDeducted: { en: "One of these shifts was already deducted (perhaps from another device). Close this and try again.", my: "ဤဆိုင်းများထဲမှ တစ်ခုကို နုတ်ပြီးသား ဖြစ်နေသည် (အခြားစက်မှ ဖြစ်နိုင်)။ ပိတ်ပြီး ထပ်ကြိုးစားပါ။" },
  deductTitle: { en: "Deduct shift sales", my: "ဆိုင်း ရောင်းအား နုတ်ရန်" },
  deductSub: { en: "Takes the litres sold in these shifts out of P-P stock. Each shift can only be deducted once.", my: "ဤဆိုင်းများတွင် ရောင်းသော လီတာကို P-P လက်ကျန်မှ နုတ်ပါမည်။ ဆိုင်းတစ်ခုကို တစ်ကြိမ်သာ နုတ်နိုင်သည်။" },
  deductN: { en: "Deduct {n} shift(s) from stock", my: "ဆိုင်း {n} ခုကို လက်ကျန်မှ နုတ်ရန်" },
  allDeducted: { en: "Every recent shift has already been deducted.", my: "မကြာသေးမီ ဆိုင်းအားလုံး နုတ်ပြီးပါပြီ။" },
  willDeduct: { en: "Will be deducted", my: "နုတ်မည့် ပမာဏ" },
  includeShift: { en: "Include shift {when}", my: "{when} ဆိုင်း ထည့်ရန်" },
  noFuel: { en: "No fuel litres", my: "ဆီ လီတာ မရှိ" },

  // Station dialog
  nameRequired: { en: "Station name is required.", my: "ဆိုင်အမည် လိုအပ်သည်။" },
  confirmDeleteStation: { en: "Delete station \"{name}\"?", my: "\"{name}\" ဆိုင်ကို ဖျက်မလား?" },
  stationHasHistory: { en: "This station has P-P history, so it can't be deleted. Its records stay in the ledger.", my: "ဤဆိုင်တွင် P-P မှတ်တမ်း ရှိသဖြင့် ဖျက်၍ မရပါ။ မှတ်တမ်းများ စာရင်းတွင် ဆက်ရှိပါမည်။" },
  editStation: { en: "Edit station", my: "ဆိုင် ပြင်ရန်" },
  stationSub: { en: "A station you buy from, borrow from or lend to", my: "ဝယ်၊ ချေးယူ၊ ချေးပေးသော ဆိုင်" },
  name: { en: "Name *", my: "အမည် *" },
  namePh: { en: "e.g. Shwe Pyi Station", my: "ဥပမာ - ရွှေပြည် ဆီဆိုင်" },
  phone: { en: "Phone", my: "ဖုန်း" },
  stationNotePh: { en: "Location, contact person…", my: "တည်နေရာ၊ ဆက်သွယ်ရမည့်သူ…" },
  saveChanges: { en: "Save changes", my: "ပြင်ဆင်မှု သိမ်းရန်" },
  deleteStation: { en: "Delete station", my: "ဆိုင် ဖျက်ရန်" },

  // Stock summary (PO Registry)
  ppStock: { en: "P-P stock", my: "P-P လက်ကျန်" },
  openLedger: { en: "Open P-P Ledger", my: "P-P စာရင်း ဖွင့်ရန်" },
  notSetUp: { en: "The P-P Ledger isn't set up yet.", my: "P-P စာရင်း မစတင်ရသေးပါ။" },
});

export type PipaT = ReturnType<typeof usePipaT>;
export const pipaProduct = (t: PipaT, p: PipaProduct) => t(`p_${p}`);
export const pipaKind = (t: PipaT, k: MovementKind) => t(`k_${k}`);
