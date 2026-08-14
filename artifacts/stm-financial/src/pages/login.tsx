import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useLocation } from "wouter";
import type { Role } from "@/lib/supabase";
import { Shield, Lock, AlertTriangle, Eye, EyeOff, CheckCircle } from "lucide-react";

function destinationFor(role?: Role): string {
  return role === "accountant" ? "/debt-tracker" : "/dashboard";
}

export default function Login() {
  const { signIn, signUp } = useAuth();
  const [, setLocation] = useLocation();
  const [mode, setMode] = useState<"signin" | "signup">("signin");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);
  const [confirmationSent, setConfirmationSent] = useState(false);

  function switchMode(next: "signin" | "signup") {
    setMode(next);
    setError("");
    setAccessDenied(false);
    setConfirmationSent(false);
    setPassword("");
    setConfirmPassword("");
  }

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setAccessDenied(false);

    const { error, role } = await signIn(email, password);
    if (error) {
      setError("Invalid credentials. Please try again.");
      setLoading(false);
      return;
    }

    await new Promise(r => setTimeout(r, 800));
    setLocation(destinationFor(role));
    setLoading(false);
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setConfirmationSent(false);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    const { error, role, needsConfirmation } = await signUp(email, password);
    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    if (needsConfirmation) {
      setConfirmationSent(true);
      return;
    }

    await new Promise(r => setTimeout(r, 800));
    setLocation(destinationFor(role));
  }

  return (
    <div className="min-h-screen bg-[#0a0f1e] flex items-center justify-center p-4">
      <div className="relative w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-xl bg-blue-600/20 border border-blue-500/30 mb-4">
            <Shield className="w-8 h-8 text-blue-400" />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">STM Financial</h1>
          <p className="mt-1 text-sm text-slate-400 uppercase tracking-widest font-medium">
            Executive Portal
          </p>
        </div>

        {accessDenied && (
          <div className="mb-6 rounded-xl bg-red-500/10 border border-red-500/30 p-5 text-center">
            <AlertTriangle className="w-10 h-10 text-red-400 mx-auto mb-3" />
            <p className="text-red-300 font-semibold text-lg">Access Denied</p>
            <p className="text-red-400 text-sm mt-1">
              This portal is restricted to authorized executive accounts only.
            </p>
          </div>
        )}

        <div className="bg-[#111827] border border-slate-700/50 rounded-xl p-8 shadow-sm">
          <div className="flex items-center gap-2 mb-6">
            <Lock className="w-4 h-4 text-blue-400" />
            <span className="text-xs text-slate-400 uppercase tracking-wider font-medium">
              {mode === "signin" ? "Secure Authentication" : "Account Setup"}
            </span>
          </div>

          {confirmationSent ? (
            <div className="text-center py-4">
              <CheckCircle className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
              <p className="text-white font-semibold">Check your email</p>
              <p className="text-slate-400 text-sm mt-2">
                We sent a confirmation link to <span className="text-slate-300">{email}</span>.
                Confirm your account, then sign in below.
              </p>
              <button
                type="button"
                onClick={() => switchMode("signin")}
                className="mt-5 text-blue-400 hover:text-blue-300 text-sm font-medium"
              >
                Back to sign in
              </button>
            </div>
          ) : (
            <form onSubmit={mode === "signin" ? handleSignIn : handleSignUp} className="space-y-5">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Email Address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  className="w-full bg-[#0d1527] border border-slate-600/50 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all"
                  placeholder="Enter your email"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  {mode === "signin" ? "Password" : "Create Password"}
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    className="w-full bg-[#0d1527] border border-slate-600/50 rounded-lg px-4 py-3 pr-12 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all"
                    placeholder={mode === "signin" ? "Enter your password" : "At least 8 characters"}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {mode === "signup" && (
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                    Confirm Password
                  </label>
                  <input
                    type={showPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    required
                    className="w-full bg-[#0d1527] border border-slate-600/50 rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all"
                    placeholder="Re-enter your password"
                  />
                </div>
              )}

              {error && (
                <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-red-400 text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg transition-all duration-200 flex items-center justify-center gap-2 mt-2"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    {mode === "signin" ? "Authenticating…" : "Creating account…"}
                  </>
                ) : (
                  <>
                    <Lock className="w-4 h-4" />
                    {mode === "signin" ? "Access Portal" : "Create Account"}
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => switchMode(mode === "signin" ? "signup" : "signin")}
                className="w-full text-center text-slate-500 hover:text-slate-300 text-xs font-medium transition-colors"
              >
                {mode === "signin"
                  ? "First time? Set your password"
                  : "← Back to sign in"}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-slate-600 text-xs mt-6">
          Unauthorized access is strictly prohibited · STM Financial
        </p>
      </div>
    </div>
  );
}
