import { Router, type Request, type Response } from "express";
import { createClient } from "@supabase/supabase-js";

const router = Router();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

function fmtMMK(val: number) {
  return new Intl.NumberFormat("en-US").format(Math.round(val)) + " MMK";
}

router.post("/alert/check", async (req: Request, res: Response) => {
  const { profile_id } = req.body as { profile_id?: string };
  if (!profile_id) {
    res.status(400).json({ error: "Missing profile_id" });
    return;
  }

  const { data: profile, error: profileErr } = await supabase
    .from("debt_profiles")
    .select("*")
    .eq("id", profile_id)
    .single();

  if (profileErr || !profile) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }

  const balance: number = profile.current_balance ?? 0;
  const today = new Date().toISOString().slice(0, 10);

  // Reset stale flags when violations are cleared
  const resets: Record<string, unknown> = {};
  if (profile.credit_limit != null && balance <= profile.credit_limit && profile.credit_alert_fired) {
    resets.credit_alert_fired = false;
  }
  if (balance <= 0 && profile.overdue_alert_fired) {
    resets.overdue_alert_fired = false;
  }
  if (Object.keys(resets).length > 0) {
    await supabase.from("debt_profiles").update(resets).eq("id", profile_id);
    Object.assign(profile, resets);
  }

  // Check violations (credit first, then overdue)
  let violationType: "credit" | "overdue" | null = null;
  let violationReason = "";

  if (
    profile.credit_limit != null &&
    balance > profile.credit_limit &&
    !profile.credit_alert_fired
  ) {
    violationType = "credit";
    violationReason = `Over Credit Limit — Limit: ${fmtMMK(profile.credit_limit)}, Current Balance: ${fmtMMK(balance)}`;
  } else if (
    profile.payment_due_date != null &&
    today > profile.payment_due_date &&
    balance > 0 &&
    !profile.overdue_alert_fired
  ) {
    violationType = "overdue";
    violationReason = `Past Payment Due Date — Due: ${profile.payment_due_date}, Balance: ${fmtMMK(balance)}`;
  }

  if (!violationType) {
    res.json({ fired: false, message: "No active violations" });
    return;
  }

  // Gather phone numbers
  const phones: string[] = [];
  if (Array.isArray(profile.phone_numbers) && profile.phone_numbers.length > 0) {
    phones.push(...(profile.phone_numbers as string[]).filter(Boolean));
  } else if (profile.phone_number) {
    phones.push(profile.phone_number as string);
  }

  // Build violation label in Burmese
  const violationLabel = violationType === "credit"
    ? `ချေးငွေ ကန့်သတ်ချက် ကျော်လွန်မှု — ကန့်သတ်ချက်: ${fmtMMK(profile.credit_limit)}, လက်ကျန်: ${fmtMMK(balance)}`
    : `ငွေပြန်ဆပ်ရမည့် ရက် လွန်မြောက်မှု — သတ်မှတ်ရက်: ${profile.payment_due_date}, လက်ကျန်: ${fmtMMK(balance)}`;

  // Build LLM prompt — strict Burmese output
  const systemPrompt =
    "သင်သည် STM Financial ၏ operations alert system ဖြစ်သည်။ " +
    "ချေးငွေ ကန့်သတ်ချက် ကျော်လွန်သည့် သို့မဟုတ် ငွေပြန်ဆပ်ရမည့် ရက် လွန်မြောက်သည့် ဖောက်သည်အကြောင်း " +
    "field staff များကို ချက်ချင်း ဆက်သွယ်ရန် အသိပေးသော Telegram notification message တစ်ခု ရေးပေးပါ။ " +
    "မြန်မာဘာသာဖြင့်သာ ရေးပါ (do NOT write in English). " +
    "ဖောက်သည်အမည်၊ ဆက်ဆံရေး၊ လက်ကျန်ငွေ၊ ချိုးဖောက်မှုအကြောင်းရင်း နှင့် ဖုန်းနံပါတ်များ ထည့်သွင်းပါ။ " +
    "တိုတောင်း၊ ရှင်းလင်း၊ အဆင်ပြေသော format ဖြင့် ရေးပါ။";

  const userPrompt =
    `ဖောက်သည်အမည်: ${profile.name}\n` +
    `ဆက်ဆံရေး: ${profile.relation}\n` +
    (profile.age ? `အသက်: ${profile.age}\n` : "") +
    `လက်ကျန်ငွေ: ${fmtMMK(balance)}\n` +
    `ချိုးဖောက်မှု: ${violationLabel}\n` +
    `ဖုန်းနံပါတ်: ${phones.length > 0 ? phones.join(", ") : "မရှိပါ"}\n\n` +
    "အထက်ပါ အချက်အလက်များ ထည့်သွင်းပြီး မြန်မာဘာသာဖြင့် alert message ရေးပေးပါ။";

  // Call Gemini
  let alertMessage = "";
  const GEMINI_KEY = process.env.GEMINI_API_KEY;

  if (GEMINI_KEY) {
    try {
      const gemRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: "user", parts: [{ text: userPrompt }] }],
            generationConfig: { maxOutputTokens: 600 },
          }),
        }
      );
      const gemData = await gemRes.json() as {
        candidates?: { content: { parts: { text: string }[] } }[];
        error?: { message: string };
      };
      if (gemRes.ok) {
        alertMessage = gemData.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
      } else {
        console.error("[Gemini error]", gemData.error?.message);
      }
    } catch (e) {
      console.error("[Gemini fetch error]", e);
    }
  }

  // Burmese fallback if Gemini fails
  if (!alertMessage) {
    const violationMM = violationType === "credit"
      ? `ချေးငွေ ကန့်သတ်ချက် ကျော်လွန်နေသည် (ကန့်သတ်: ${fmtMMK(profile.credit_limit)})`
      : `ငွေပြန်ဆပ်ရမည့် ရက် (${profile.payment_due_date}) လွန်မြောက်နေသည်`;
    alertMessage =
      `⚠️ <b>STM Financial — သတိပေးချက်</b>\n\n` +
      `<b>ဖောက်သည်:</b> ${profile.name} (${profile.relation})\n` +
      (profile.age ? `<b>အသက်:</b> ${profile.age}\n` : "") +
      `<b>လက်ကျန်ငွေ:</b> ${fmtMMK(balance)}\n` +
      `<b>အကြောင်းရင်း:</b> ${violationMM}\n` +
      (phones.length > 0 ? `<b>ဖုန်းနံပါတ်:</b> ${phones.join(" | ")}\n` : "") +
      `\nဤဖောက်သည်အား ချက်ချင်း ဆက်သွယ်ပေးပါ။`;
  }

  // Send to Telegram
  const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const TELEGRAM_CHAT = process.env.TELEGRAM_CHAT_ID;
  let telegramSent = false;

  if (TELEGRAM_TOKEN && TELEGRAM_CHAT) {
    try {
      const tgRes = await fetch(
        `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: TELEGRAM_CHAT,
            text: alertMessage,
            parse_mode: "HTML",
          }),
        }
      );
      telegramSent = tgRes.ok;
    } catch {
      // ignore — log is sufficient
    }
  }

  // Mark alert as fired
  const flagKey = violationType === "credit" ? "credit_alert_fired" : "overdue_alert_fired";
  await supabase.from("debt_profiles").update({ [flagKey]: true }).eq("id", profile_id);

  res.json({ fired: true, violationType, telegramSent, message: alertMessage });
});

export default router;
