// Service-role helpers shared by the access-management Edge Functions.

import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2";
import { tg } from "./telegram.ts";

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

export function adminClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function allUsers(admin: SupabaseClient): Promise<User[]> {
  const out: User[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    out.push(...data.users);
    if (data.users.length < 1000) return out;
  }
}

export async function findUserByEmail(admin: SupabaseClient, email: string): Promise<User | undefined> {
  const wanted = email.toLowerCase();
  return (await allUsers(admin)).find(u => (u.email ?? "").toLowerCase() === wanted);
}

/** CEO chat ids on Telegram. Best effort: a failed send never blocks the change itself. */
export async function announce(admin: SupabaseClient, text: string) {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token) return;
  const { data } = await admin.rpc("shift_alert_recipients");
  await Promise.all((data ?? []).map((r: { chat_id: number }) =>
    tg(token, "sendMessage", { chat_id: r.chat_id, text }).catch(() => null)));
}

/**
 * The verified caller, if they are a CEO right now — using the same database
 * check every RLS policy uses, never an email or role from the request body.
 */
export async function requireCeo(req: Request, admin: SupabaseClient):
  Promise<{ ok: true; user: User } | { ok: false; response: Response }> {
  const authorization = req.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return { ok: false, response: json({ error: "Sign in first." }, 401) };

  const { data: { user }, error } = await admin.auth.getUser(authorization.slice(7));
  if (error || !user?.email) return { ok: false, response: json({ error: "Your session has expired. Sign in again." }, 401) };

  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || req.headers.get("apikey") || "";
  const asCaller = createClient(Deno.env.get("SUPABASE_URL")!, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: role } = await asCaller.rpc("current_app_role");
  if (role !== "ceo") return { ok: false, response: json({ error: "Only an owner can do this." }, 403) };
  return { ok: true, user };
}
