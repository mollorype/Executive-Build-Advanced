// Telegram helpers shared by the shift-alert Edge Functions.

/** Call a Bot API method. `ok` is true only when Telegram itself reports success. */
export async function tg(token: string, method: string, body: Record<string, unknown>) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok && data?.ok === true, status: res.status, data };
}

/**
 * The value Telegram must echo in X-Telegram-Bot-Api-Secret-Token on every
 * webhook call. Derived from the bot token, so there's no extra secret to
 * manage, and nobody can forge it without the token. 64 hex chars — within
 * Telegram's allowed [A-Za-z0-9_-]{1,256}.
 */
export async function webhookSecret(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`stm-telegram-webhook:${token}`));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
