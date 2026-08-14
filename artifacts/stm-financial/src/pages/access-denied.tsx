import { ShieldX, LogOut } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useLocation } from "wouter";

export default function AccessDenied() {
  const { signOut } = useAuth();
  const [, setLocation] = useLocation();

  async function handleSignOut() {
    await signOut();
    setLocation("/");
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="relative text-center max-w-md">
        <div className="inline-flex items-center justify-center w-24 h-24 rounded-full bg-pale-red mb-6 mx-auto">
          <ShieldX className="w-12 h-12 text-pale-red-foreground" />
        </div>
        <h1 className="text-4xl font-bold text-slate-900 mb-2">Access Denied</h1>
        <div className="w-16 h-1 bg-red-500 mx-auto mb-6 rounded-full" />
        <p className="text-slate-500 text-lg mb-2">
          Your account does not have executive privileges.
        </p>
        <p className="text-slate-400 text-sm mb-8">
          This portal is restricted to authorized executive accounts only. Contact your system administrator if you believe this is an error.
        </p>
        <button
          onClick={handleSignOut}
          className="inline-flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold px-6 py-3 rounded-xl transition-all"
        >
          <LogOut className="w-4 h-4" />
          Return to Login
        </button>
        <p className="text-slate-300 text-xs mt-8 uppercase tracking-widest">
          STM Financial · Executive Portal
        </p>
      </div>
    </div>
  );
}
