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

  // Build LLM prompt
  const systemPrompt =
    "You are an operations alert system for STM Financial. " +
    "Draft a concise notification to our field staff telling them to call a debtor who has violated their account terms. " +
    "Include: Debtor Name, Relation, Current Balance, the specific reason for violation " +
    "(Over Credit Limit OR Past Due Date), and list all phone numbers on file. " +
    "Write this in a natural, actionable Burmese (or English) message instructing staff to dial them immediately.";

  const userPrompt =
    `Debtor: ${profile.name}\n` +
    `Relation: ${profile.relation}\n` +
    (profile.age ? `Age: ${profile.age}\n` : "") +
    `Current Balance: ${fmtMMK(balance)}\n` +
    `Violation: ${violationReason}\n` +
    `Phone numbers: ${phones.length > 0 ? phones.join(", ") : "None on file"}\n\n` +
    "Please write the alert message now.";

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
            generationConfig: { maxOutputTokens: 512 },
          }),
        }
      );
      if (gemRes.ok) {
        const gemData = await gemRes.json() as {
          candidates?: { content: { parts: { text: string }[] } }[];
        };
        alertMessage = gemData.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
      }
    } catch {
      // fall through to plain fallback
    }
  }

  // Plain fallback if no Gemini key or call failed
  if (!alertMessage) {
    alertMessage =
      `⚠️ <b>STM Financial — Account Alert</b>\n\n` +
      `<b>Debtor:</b> ${profile.name} (${profile.relation})\n` +
      (profile.age ? `<b>Age:</b> ${profile.age}\n` : "") +
      `<b>Balance:</b> ${fmtMMK(balance)}\n` +
      `<b>Violation:</b> ${violationReason}\n` +
      (phones.length > 0 ? `<b>Phone:</b> ${phones.join(" | ")}\n` : "") +
      `\nPlease contact this debtor immediately.`;
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
