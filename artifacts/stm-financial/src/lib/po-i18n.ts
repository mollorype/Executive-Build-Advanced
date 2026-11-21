// English / Myanmar strings for the PO deduction, history and edit dialogs.

import { makeT } from "./app-i18n";

export const usePOT = makeT({
  close: { en: "Close", my: "ပိတ်ရန်" },
  cancel: { en: "Cancel", my: "မလုပ်တော့ပါ" },
  p_92: { en: "92 RON", my: "92 RON" },
  p_95: { en: "95 RON", my: "95 RON" },
  p_PD: { en: "PD (Premium Diesel)", my: "PD (ပရီမီယံ ဒီဇယ်)" },
  p_D: { en: "Diesel", my: "ဒီဇယ်" },

  // Deduct dialog
  deductTitle: { en: "Deduct shift sales from POs", my: "ဆိုင်း ရောင်းအားကို PO မှ နုတ်ရန်" },
  deductSub: { en: "Litres sold in these shifts come off the POs of each fuel, oldest first (the ACTIVE one first). Each shift is deducted once, with that day's selling price.", my: "ဤဆိုင်းများတွင် ရောင်းသော လီတာကို ဆီအမျိုးအစားအလိုက် PO အဟောင်းဆုံး (အသုံးပြုဆဲ) မှ စ၍ နုတ်ပါမည်။ ဆိုင်းတစ်ခုကို တစ်ကြိမ်သာ၊ ထိုနေ့ ရောင်းစျေးဖြင့် နုတ်ပါမည်။" },
  notInstalled: { en: "PO deductions aren't set up in the database yet. Run the po_shift_usage SQL in the Supabase SQL Editor.", my: "PO နုတ်ခြင်းကို database တွင် မထည့်ရသေးပါ။ Supabase SQL Editor တွင် po_shift_usage SQL ကို run ပါ။" },
  allDeducted: { en: "Every recent shift has already been deducted.", my: "မကြာသေးမီ ဆိုင်းအားလုံး နုတ်ပြီးပါပြီ။" },
  willDeduct: { en: "Will be deducted", my: "နုတ်မည့် ပမာဏ" },
  inPOs: { en: "left in POs: {v}", my: "PO တွင် ကျန်: {v}" },
  overPOs: { en: "More than the POs hold — the extra {v} won't come off any PO.", my: "PO တွင် ကျန်သည်ထက် များနေသည် — အပို {v} ကို ဘယ် PO မှ မနုတ်ပါ။" },
  avgPrice: { en: "avg {p}/L", my: "ပျမ်းမျှ {p}/L" },
  beforePOs: { en: "Shifts from before your oldest open PO ({date}) are not ticked.", my: "PO အဟောင်းဆုံး ({date}) မတိုင်မီ ဆိုင်းများကို မရွေးထားပါ။" },
  noOpenPO: { en: "No open PO — add a PO first, or the litres won't come off anything.", my: "ဖွင့်ထားသော PO မရှိပါ — PO အရင် ထည့်ပါ၊ မဟုတ်ပါက လီတာများ ဘာမှ မနုတ်ပါ။" },
  includeShift: { en: "Include shift {when}", my: "{when} ဆိုင်း ထည့်ရန်" },
  noFuel: { en: "No fuel litres", my: "ဆီ လီတာ မရှိ" },
  deductN: { en: "Deduct {n} shift(s)", my: "ဆိုင်း {n} ခု နုတ်ရန်" },
  alreadyDeducted: { en: "One of these shifts was already deducted (perhaps from another device). Close this and try again.", my: "ဤဆိုင်းများထဲမှ တစ်ခုကို နုတ်ပြီးသား ဖြစ်နေသည် (အခြားစက်မှ ဖြစ်နိုင်)။ ပိတ်ပြီး ထပ်ကြိုးစားပါ။" },
  deducted: { en: "Shift sales deducted from the POs.", my: "ဆိုင်း ရောင်းအားကို PO များမှ နုတ်ပြီး။" },
  unallocated: { en: "Deducted, but {list} had no PO left. Add a PO, then undo this deduction in a PO's history and deduct again.", my: "နုတ်ပြီး၊ သို့သော် {list} အတွက် PO မကျန်တော့ပါ။ PO ထည့်ပြီး PO မှတ်တမ်းတွင် ဤနုတ်ချက်ကို ပြန်ဖျက်ကာ ထပ်နုတ်ပါ။" },
  selectAll: { en: "Select all", my: "အားလုံး ရွေးရန်" },

  // History dialog
  historyTitle: { en: "Sales history", my: "ရောင်းအား မှတ်တမ်း" },
  historyEmpty: { en: "Nothing deducted from this PO yet. Use \"Deduct shift sales\".", my: "ဤ PO မှ မနုတ်ရသေးပါ။ \"ဆိုင်း ရောင်းအား နုတ်ရန်\" ကို သုံးပါ။" },
  colDay: { en: "Day", my: "နေ့" },
  colQty: { en: "Sold", my: "ရောင်း" },
  colPrice: { en: "Price/L", my: "စျေး/L" },
  colAmount: { en: "Amount", my: "ငွေ" },
  totalSold: { en: "Total sold", my: "ရောင်းပြီး စုစုပေါင်း" },
  revenue: { en: "Money from sales", my: "ရောင်းရငွေ" },
  avgSold: { en: "Average price", my: "ပျမ်းမျှ စျေး" },
  wholesaleCost: { en: "Wholesale cost", my: "လက်ကား ကုန်ကျ" },
  feesCost: { en: "Transport + fees", my: "သယ်ယူ + စရိတ်" },
  shortageCost: { en: "Shortage", my: "လိုငွေ" },
  profit: { en: "Net profit", my: "အသားတင်အမြတ်" },
  costsPending: { en: "Verify the costs to see the profit.", my: "အမြတ် ကြည့်ရန် ကုန်ကျစရိတ် စစ်ပါ။" },
  soldNoPrice: { en: "{v} were sold before price history was kept and have no price.", my: "{v} ကို စျေးမှတ်တမ်း မစမီ ရောင်းခဲ့သဖြင့် စျေး မရှိပါ။" },
  undo: { en: "Undo this deduction", my: "ဤနုတ်ချက် ပြန်ဖျက်ရန်" },
  undoConfirm: { en: "Undo this deduction? Its litres go back on the POs it used, and its shifts can be deducted again.", my: "ဤနုတ်ချက်ကို ပြန်ဖျက်မလား? လီတာများ PO များသို့ ပြန်ရောက်ပြီး ဆိုင်းများကို ထပ်နုတ်နိုင်ပါမည်။" },
  undone: { en: "Deduction undone.", my: "နုတ်ချက် ပြန်ဖျက်ပြီး။" },
  undoNewer: { en: "Undo the newer deduction for this fuel first.", my: "ဤဆီအတွက် နောက်မှ နုတ်ထားသည်ကို အရင် ပြန်ဖျက်ပါ။" },
  undoClosed: { en: "A PO in this deduction was force-closed afterwards, so it can't be undone.", my: "ဤနုတ်ချက်ပါ PO ကို နောက်မှ အတင်းပိတ်ထားသဖြင့် ပြန်ဖျက်၍ မရပါ။" },
  newest: { en: "newest", my: "နောက်ဆုံး" },

  // Edit dialog
  editTitle: { en: "Edit purchase order", my: "PO ပြင်ရန်" },
  name: { en: "PO Name", my: "PO အမည်" },
  product: { en: "Product Type", my: "ကုန်ပစ္စည်း အမျိုးအစား" },
  productLocked: { en: "Can't change the fuel after sales were deducted.", my: "ရောင်းအား နုတ်ပြီးနောက် ဆီအမျိုးအစား ပြောင်း၍ မရပါ။" },
  volume: { en: "Total Volume ({u})", my: "စုစုပေါင်း ပမာဏ ({u})" },
  equalsOther: { en: "= {v} (1 P-P = {size} L)", my: "= {v} (1 P-P = {size} L)" },
  volumeHelp: { en: "Sold so far: {sold}. What's left changes by the same amount.", my: "ယခုထိ ရောင်းပြီး: {sold}။ ကျန်ပမာဏလည်း အတူ ပြောင်းပါမည်။" },
  volumeLocked: { en: "This PO was force-closed, so its volume can't change.", my: "ဤ PO ကို အတင်းပိတ်ထားသဖြင့် ပမာဏ ပြောင်း၍ မရပါ။" },
  calibration: { en: "Calibration Factor", my: "Calibration Factor" },
  tooSmall: { en: "Total volume can't be less than what's already been used ({used}).", my: "စုစုပေါင်း ပမာဏသည် သုံးပြီးသား ({used}) ထက် နည်း၍ မရပါ။" },
  save: { en: "Save changes", my: "ပြင်ဆင်မှု သိမ်းရန်" },
  saving: { en: "Saving…", my: "သိမ်းနေသည်…" },
  saved: { en: "PO saved.", my: "PO သိမ်းပြီး။" },
  nameRequired: { en: "PO Name is required.", my: "PO အမည် လိုအပ်သည်။" },
  calPositive: { en: "Calibration Factor must be a positive number.", my: "Calibration Factor သည် အပေါင်းကိန်း ဖြစ်ရမည်။" },
  volPositive: { en: "Total Volume must be a positive number.", my: "စုစုပေါင်း ပမာဏ သည် အပေါင်းကိန်း ဖြစ်ရမည်။" },
  notSaved: { en: "Nothing was saved — your account may not be allowed to. Refresh and try again.", my: "ဘာမှ မသိမ်းရပါ — သင့်အကောင့် ခွင့်မရှိနိုင်ပါ။ ပြန်ဖွင့်ပြီး ထပ်ကြိုးစားပါ။" },
});

export type POT = ReturnType<typeof usePOT>;
export const poProduct = (t: POT, p: string) => (["92", "95", "PD", "D"].includes(p) ? t(`p_${p as "92" | "95" | "PD" | "D"}`) : p);
