import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase, Profile, Role, ROLES } from "./supabase";
import type { User, Session } from "@supabase/supabase-js";

type AuthContextType = {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null; role?: Role }>;
  signUp: (email: string, password: string) => Promise<{ error: Error | null; needsConfirmation?: boolean; role?: Role }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

/**
 * Resolves the role for the CURRENTLY signed-in Supabase session by asking the
 * database, not by trusting anything the browser supplies. `current_app_role()`
 * is a SECURITY DEFINER Postgres function that reads the caller's verified JWT
 * email (auth.jwt() ->> 'email' — populated by PostgREST only after checking the
 * Supabase-signed JWT signature, so a client can't forge it) against the
 * ceo_access / accountant_access allowlist tables, which have no direct client
 * access at all. This is the exact same function every RLS policy uses, so the
 * role the UI shows can never drift from what the database actually allows.
 * Deny-by-default: anyone not explicitly allow-listed gets null, not "ceo".
 */
async function fetchTrustedRole(): Promise<Role | null> {
  const { data, error } = await supabase.rpc("current_app_role");
  if (error) return null;
  return ROLES.includes(data as Role) ? (data as Role) : null;   // an unknown role gets nothing
}

/** Pre-signup UX check only — calls narrow RPCs (yes/no for one email) instead
 * of reading the accountant_access / manager_access tables directly, so the
 * lists themselves aren't publicly enumerable. The real gate is still
 * current_app_role() above; this just avoids a signup that will be denied. */
async function checkSignupAllowlist(email: string): Promise<boolean> {
  const check_email = email.trim().toLowerCase();
  const [acc, mgr] = await Promise.all([
    supabase.rpc("is_accountant_allowed", { check_email }),
    supabase.rpc("is_manager_allowed", { check_email }),
  ]);
  return (!acc.error && acc.data === true) || (!mgr.error && mgr.data === true);
}

function buildProfile(user: User, role: Role): Profile {
  return {
    id: user.id,
    username: user.email ?? user.id,
    role,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function hydrate(nextSession: Session | null) {
      const u = nextSession?.user ?? null;
      if (!u || !u.email) {
        if (!cancelled) { setSession(nextSession); setUser(null); setProfile(null); }
        return;
      }
      const role = await fetchTrustedRole();
      if (cancelled) return;
      if (!role) {
        // Session belongs to an email that's not (or no longer) in ceo_access/accountant_access/manager_access.
        await supabase.auth.signOut();
        setSession(null);
        setUser(null);
        setProfile(null);
        return;
      }
      setSession(nextSession);
      setUser(u);
      setProfile(buildProfile(u, role));
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      hydrate(session).finally(() => { if (!cancelled) setLoading(false); });
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      hydrate(nextSession);
    });

    return () => { cancelled = true; subscription.unsubscribe(); };
  }, []);

  async function signIn(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error as Error };

    const role = await fetchTrustedRole();
    if (!role) {
      await supabase.auth.signOut();
      return {
        error: new Error(
          "Access Denied — this portal is restricted to authorised personnel only.",
        ),
      };
    }

    if (data.user) {
      setProfile(buildProfile(data.user, role));
    }

    return { error: null, role };
  }

  async function signUp(email: string, password: string) {
    // Self-serve signup only ever grants the Accountant or Manager role — the CEO account is
    // provisioned directly in Supabase, never through this flow. This check is only
    // a UX nicety (avoids attempting a signup that's certain to be denied) — the
    // actual gate is current_app_role() via RLS, so bypassing this check client-side
    // (e.g. calling supabase.auth.signUp directly) grants no privileged access,
    // since a non-allow-listed email will resolve to role = null everywhere.
    const allowed = await checkSignupAllowlist(email);
    if (!allowed) {
      return { error: new Error("This email hasn't been authorized yet. Ask your administrator to add it in Manage Access first.") };
    }

    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { error: error as Error };

    if (data.session && data.user) {
      const role = await fetchTrustedRole();
      if (!role) {
        await supabase.auth.signOut();
        return { error: new Error("This email hasn't been authorized yet. Ask your administrator to add it in Manage Access first.") };
      }
      setSession(data.session);
      setUser(data.user);
      setProfile(buildProfile(data.user, role));
      return { error: null, role };
    }

    // No session back means the Supabase project requires email confirmation before first sign-in.
    return { error: null, needsConfirmation: true };
  }

  async function signOut() {
    await supabase.auth.signOut();
    setProfile(null);
  }

  return (
    <AuthContext.Provider value={{ user, session, profile, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
