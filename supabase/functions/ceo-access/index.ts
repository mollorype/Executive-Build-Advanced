// CEO Access — list / add / remove CEOs from the portal's Staff Access page.
//
// The CEO allowlist (public.ceo_access) has RLS on and no policies, so no
// browser can read or change it; only this function, with the service-role
// key, can. Every request must:
//   1. carry a session that Supabase Auth verifies, whose account the
//      database's own current_app_role() reports as 'ceo' right now; and
//   2. for add/remove, re-enter the caller's password (checked by Supabase
//      Auth), so a stolen session token alone can't grant or revoke CEO access.
// Every add/remove is announced on Telegram to all connected CEOs.
//
//   POST { action: "list" }
//   POST { action: "add",    email, temp_password?, current_password }
//   POST { action: "remove", email, current_password }

import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2";
import { tg } from "../_shared/telegram.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

async function allUsers(admin: SupabaseClient): Promise<User[]> {
  const out: User[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    out.push(...data.users);
    if (data.users.length < 1000) return out;
  }
}

/** Best effort: a failed Telegram send never blocks the change itself. */
async function announce(admin: SupabaseClient, text: string) {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token) return;
  const { data } = await admin.rpc("shift_alert_recipients");
  await Promise.all((data ?? []).map((r: { chat_id: number }) => tg(token, "sendMessage", { chat_id: r.chat_id, text }).catch(() => null)));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const authorization = req.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return json({ error: "Sign in first." }, 401);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || req.headers.get("apikey") || "";
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  // 1. Who is calling — from the verified session, never from the request body.
  const { data: { user: caller }, error: userErr } = await admin.auth.getUser(authorization.slice(7));
  if (userErr || !caller?.email) return json({ error: "Your session has expired. Sign in again." }, 401);
  const callerEmail = caller.email.toLowerCase();

  // 2. Is that account a CEO right now? Same check every RLS policy uses.
  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: role } = await asCaller.rpc("current_app_role");
  if (role !== "ceo") return json({ error: "Only an owner can manage owner access." }, 403);

  const body = await req.json().catch(() => ({}));
  const action = body?.action;

  const listCeos = async () => {
    const [{ data: rows, error }, users] = await Promise.all([
      admin.from("ceo_access").select("email, created_at").order("created_at"),
      allUsers(admin),
    ]);
    if (error) throw error;
    const byEmail = new Map(users.map(u => [(u.email ?? "").toLowerCase(), u]));
    return (rows ?? []).map(r => ({
      email: r.email as string,
      added_at: r.created_at as string,
      has_login: byEmail.has(r.email),
      last_sign_in: byEmail.get(r.email)?.last_sign_in_at ?? null,
      is_you: r.email === callerEmail,
    }));
  };

  try {
    if (action === "list") return json({ ceos: await listCeos() });
    if (action !== "add" && action !== "remove") return json({ error: "unknown action" }, 400);

    // 3. Changes need the caller's password, not just their session.
    const password = body?.current_password;
    if (typeof password !== "string" || !password) return json({ error: "Enter your password to confirm." }, 400);
    const verifier = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error: pwErr } = await verifier.auth.signInWithPassword({ email: caller.email, password });
    if (pwErr) return json({ error: "Your password is incorrect." }, 403);
    await verifier.auth.signOut({ scope: "local" });   // drop only the throwaway session made by that check

    const email = String(body?.email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return json({ error: "Enter a valid email address." }, 400);

    if (action === "add") {
      const existing = (await allUsers(admin)).find(u => (u.email ?? "").toLowerCase() === email);
      let created = false;
      if (!existing) {
        const temp = body?.temp_password;
        if (typeof temp !== "string" || temp.length < MIN_PASSWORD) {
          return json({ error: `${email} doesn't have a login yet. Set a temporary password of at least ${MIN_PASSWORD} characters.` }, 400);
        }
        const { error: createErr } = await admin.auth.admin.createUser({ email, password: temp, email_confirm: true });
        if (createErr) return json({ error: createErr.message }, 400);
        created = true;
      }
      const { error: insErr } = await admin.from("ceo_access").insert({ email });
      if (insErr) {
        if (insErr.code === "23505") return json({ ok: true, already: true, created, ceos: await listCeos() });
        return json({ error: insErr.message }, 500);
      }
      await announce(admin, `🔐 New owner added: ${email}\nby ${callerEmail}${created ? "\n(new login created)" : ""}\n\nIf you didn't expect this, remove them in Staff Access → Owner.`);
      return json({ ok: true, created, ceos: await listCeos() });
    }

    // remove
    if (email === callerEmail) return json({ error: "You can't remove yourself. Another owner can remove you." }, 400);
    const { data: removed, error: delErr } = await admin.from("ceo_access").delete().eq("email", email).select("email");
    if (delErr) return json({ error: delErr.message }, 500);
    if (!removed?.length) return json({ error: `${email} isn't an owner.` }, 404);
    await announce(admin, `🔐 Owner access removed: ${email}\nby ${callerEmail}`);
    return json({ ok: true, ceos: await listCeos() });
  } catch (e) {
    return json({ error: (e as Error).message ?? "Something went wrong." }, 500);
  }
});
