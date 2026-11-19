// STM Daily staff sign-in.
//
// Staff sign in to STM Daily with their allowlisted email and a password they
// choose the first time. Supabase Auth itself checks the password; this
// function only creates the login, and only for an email on the STM Daily
// allowlist (public.allowed_employees) that has no login yet. Every password
// set or reset is announced to the CEOs on Telegram, so a stranger setting a
// staff member's password first doesn't go unnoticed.
//
//   POST { action: "status", email }                 → { state: "not_allowed" | "needs_password" | "has_password" }
//   POST { action: "set_password", email, password } → { ok: true }
//   POST { action: "logins" }        (CEO only)      → { logins: [{ email, has_login, last_sign_in, portal_login }] }
//   POST { action: "reset", email }  (CEO only)      → { ok: true }   staff member sets a new password next sign-in

import { adminClient, allUsers, announce, findUserByEmail, json, requireCeo, CORS } from "../_shared/admin.ts";

const MIN_PASSWORD = 6;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const admin = adminClient();
  const body = await req.json().catch(() => ({}));
  const action = body?.action;
  const email = String(body?.email ?? "").trim().toLowerCase();

  const isAllowed = async (e: string) => {
    // Stored lower-case, as the portal saves them and is_employee_allowed() expects.
    const { data, error } = await admin.from("allowed_employees").select("email").eq("email", e).limit(1);
    if (error) throw error;
    return (data ?? []).length > 0;
  };
  const hasPortalAccess = async (e: string) => {
    const [ceo, acc] = await Promise.all([
      admin.from("ceo_access").select("email").eq("email", e).limit(1),
      admin.from("accountant_access").select("email").eq("email", e).limit(1),
    ]);
    return (ceo.data?.length ?? 0) > 0 || (acc.data?.length ?? 0) > 0;
  };

  try {
    if (action === "status") {
      if (!email.includes("@")) return json({ error: "Enter a valid email address." }, 400);
      if (!(await isAllowed(email))) return json({ state: "not_allowed" });
      return json({ state: (await findUserByEmail(admin, email)) ? "has_password" : "needs_password" });
    }

    if (action === "set_password") {
      const password = body?.password;
      if (!email.includes("@")) return json({ error: "Enter a valid email address." }, 400);
      if (typeof password !== "string" || password.length < MIN_PASSWORD) {
        return json({ error: `Use at least ${MIN_PASSWORD} characters.` }, 400);
      }
      if (!(await isAllowed(email))) return json({ error: "This email isn't on the STM Daily list. Ask your manager." }, 403);
      if (await findUserByEmail(admin, email)) {
        return json({ error: "This email already has a password. Sign in with it, or ask your manager to reset it." }, 409);
      }
      const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error) {
        if (/already|exists|registered/i.test(error.message)) {
          return json({ error: "This email already has a password. Sign in with it, or ask your manager to reset it." }, 409);
        }
        return json({ error: error.message }, 400);
      }
      await announce(admin, `🔑 ${email} set their STM Daily password.\n\nIf that wasn't them, reset it in Staff Access → STM Daily Access.`);
      return json({ ok: true });
    }

    if (action === "logins" || action === "reset") {
      const gate = await requireCeo(req, admin);
      if (!gate.ok) return gate.response;
      const callerEmail = (gate.user.email ?? "").toLowerCase();

      if (action === "logins") {
        const [{ data: staff, error }, users, { data: ceos }, { data: accountants }] = await Promise.all([
          admin.from("allowed_employees").select("email"),
          allUsers(admin),
          admin.from("ceo_access").select("email"),
          admin.from("accountant_access").select("email"),
        ]);
        if (error) throw error;
        const byEmail = new Map(users.map(u => [(u.email ?? "").toLowerCase(), u]));
        const portal = new Set([...(ceos ?? []), ...(accountants ?? [])].map(r => String(r.email).toLowerCase()));
        return json({
          logins: (staff ?? []).map(r => {
            const e = String(r.email).toLowerCase();
            const u = byEmail.get(e);
            return { email: e, has_login: !!u, last_sign_in: u?.last_sign_in_at ?? null, portal_login: portal.has(e) };
          }),
        });
      }

      // reset
      if (!(await isAllowed(email))) return json({ error: `${email} isn't on the STM Daily list.` }, 404);
      if (await hasPortalAccess(email)) {
        return json({ error: `${email} also signs in to STM Financial with this password, so it can't be reset here. They can change it from the portal menu → Change password.` }, 400);
      }
      const user = await findUserByEmail(admin, email);
      if (!user) return json({ ok: true, already: true });
      // Deleting the login ends every session at once; their chat messages stay.
      const { error } = await admin.auth.admin.deleteUser(user.id);
      if (error) return json({ error: error.message }, 500);
      await announce(admin, `🔑 STM Daily password reset for ${email}\nby ${callerEmail}\n\nThey'll choose a new password the next time they sign in.`);
      return json({ ok: true });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message ?? "Something went wrong." }, 500);
  }
});
