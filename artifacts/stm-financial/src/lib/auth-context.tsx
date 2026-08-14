import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase, Profile, Role } from "./supabase";
import type { User, Session } from "@supabase/supabase-js";

export const ACCOUNTANT_TABLE = "accountant_access";

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

/** CEO is a fixed env-configured account; every other authorized email is an Accountant listed in accountant_access. */
async function resolveRole(email: string): Promise<Role | null> {
  const ceoEmail = import.meta.env.CEO_EMAIL as string | undefined;
  if (ceoEmail && email.toLowerCase() === ceoEmail.toLowerCase()) return "ceo";

  const { data } = await supabase
    .from(ACCOUNTANT_TABLE)
    .select("id")
    .eq("email", email.trim().toLowerCase())
    .maybeSingle();

  return data ? "accountant" : null;
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
      const role = await resolveRole(u.email);
      if (cancelled) return;
      if (!role) {
        // Session belongs to an email that's no longer authorized (e.g. removed from the allowlist).
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

    const role = await resolveRole(email);
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
    const role = await resolveRole(email);
    if (!role) {
      return { error: new Error("This email hasn't been authorized yet. Ask your administrator to add it in Manage Access first.") };
    }

    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { error: error as Error };

    if (data.session && data.user) {
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
