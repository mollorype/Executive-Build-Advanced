import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useLocation, useSearch } from "wouter";
import { nextFromSearch } from "@/lib/return-to";
import { homeFor } from "@/lib/supabase";
import { Shield, Lock, AlertTriangle, Eye, EyeOff, CheckCircle } from "lucide-react";
import { makeT } from "@/lib/app-i18n";
import DebtLangToggle from "@/components/debt-lang-toggle";

const useT = makeT({
  invalid: { en: "Invalid credentials. Please try again.", my: "Email သို့မဟုတ် စကားဝှက် မှားနေသည်။ ထပ်ကြိုးစားပါ။" },
  tooShort: { en: "Password must be at least 8 characters.", my: "စကားဝှက်သည် အနည်းဆုံး ၈ လုံး ရှိရမည်။" },
  noMatch: { en: "Passwords do not match.", my: "စကားဝှက် နှစ်ခု မတူပါ။" },
  rateLimit: { en: "Too many account-setup attempts right now. Please wait a while and try again.", my: "ကြိုးစားမှု များလွန်းနေသည်။ ခဏစောင့်ပြီး ထပ်ကြိုးစားပါ။" },
  portal: { en: "Executive Portal", my: "စီမံခန့်ခွဲမှု Portal" },
  denied: { en: "Access Denied", my: "ဝင်ခွင့် မရှိပါ" },
  deniedBody: { en: "This portal is restricted to authorized executive accounts only.", my: "ဤ Portal ကို ခွင့်ပြုထားသော အကောင့်များသာ သုံးနိုင်ပါသည်။" },
  secure: { en: "Secure Authentication", my: "လုံခြုံသော ဝင်ရောက်မှု" },
  setup: { en: "Account Setup", my: "အကောင့် ပြင်ဆင်ရန်" },
  checkEmail: { en: "Check your email", my: "Email ကို စစ်ပါ" },
  sentLink: { en: "We sent a confirmation link to {email}. Confirm your account, then sign in below.", my: "{email} သို့ အတည်ပြု link ပို့ထားပါသည်။ အတည်ပြုပြီးမှ အောက်တွင် ဝင်ပါ။" },
  backToSignIn: { en: "Back to sign in", my: "ဝင်ရန် ပြန်သွားရန်" },
  email: { en: "Email Address", my: "Email လိပ်စာ" },
  emailPh: { en: "Enter your email", my: "Email ထည့်ပါ" },
  password: { en: "Password", my: "စကားဝှက်" },
  createPassword: { en: "Create Password", my: "စကားဝှက် ဖန်တီးပါ" },
  passwordPh: { en: "Enter your password", my: "စကားဝှက် ထည့်ပါ" },
  min8: { en: "At least 8 characters", my: "အနည်းဆုံး ၈ လုံး" },
  showPw: { en: "Show password", my: "စကားဝှက် ပြရန်" },
  hidePw: { en: "Hide password", my: "စကားဝှက် ဝှက်ရန်" },
  confirmPw: { en: "Confirm Password", my: "စကားဝှက် ထပ်ရိုက်ပါ" },
  confirmPh: { en: "Re-enter your password", my: "စကားဝှက် ထပ်ထည့်ပါ" },
  authenticating: { en: "Authenticating…", my: "စစ်ဆေးနေသည်…" },
  creating: { en: "Creating account…", my: "အကောင့် ဖန်တီးနေသည်…" },
  access: { en: "Access Portal", my: "Portal သို့ ဝင်ရန်" },
  create: { en: "Create Account", my: "အကောင့် ဖန်တီးရန်" },
  firstTime: { en: "First time? Set your password", my: "ပထမဆုံးအကြိမ်လား? စကားဝှက် သတ်မှတ်ပါ" },
  back: { en: "← Back to sign in", my: "← ဝင်ရန် ပြန်သွားရန်" },
  footer: { en: "Unauthorized access is strictly prohibited · STM Financial", my: "ခွင့်မပြုဘဲ ဝင်ရောက်ခြင်းကို တားမြစ်သည် · STM Financial" },
});

export default function Login() {
  const { signIn, signUp } = useAuth();
  const t = useT();
  const [, setLocation] = useLocation();
  // Where a logged-out link was headed (e.g. a Telegram shift alert), if any.
  const next = nextFromSearch(useSearch());
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
      setError(t("invalid"));
      setLoading(false);
      return;
    }

    await new Promise(r => setTimeout(r, 800));
    setLocation(next ?? homeFor(role));
    setLoading(false);
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setConfirmationSent(false);

    if (password.length < 8) {
      setError(t("tooShort"));
      return;
    }
    if (password !== confirmPassword) {
      setError(t("noMatch"));
      return;
    }

    setLoading(true);
    const { error, role, needsConfirmation } = await signUp(email, password);
    setLoading(false);

    if (error) {
      setError(
        error.message.toLowerCase().includes("rate limit")
          ? t("rateLimit")
          : error.message,
      );
      return;
    }

    if (needsConfirmation) {
      setConfirmationSent(true);
      return;
    }

    await new Promise(r => setTimeout(r, 800));
    setLocation(next ?? homeFor(role));
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="relative w-full max-w-md">
        <div className="flex justify-end mb-2"><DebtLangToggle /></div>
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-pale-blue mb-4">
            <Shield className="w-8 h-8 text-pale-blue-foreground" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">STM Financial</h1>
          <p className="mt-1 text-sm text-slate-500 uppercase tracking-widest font-medium">
            {t("portal")}
          </p>
        </div>

        {accessDenied && (
          <div className="mb-6 rounded-2xl bg-pale-red border border-red-100 p-5 text-center">
            <AlertTriangle className="w-10 h-10 text-pale-red-foreground mx-auto mb-3" />
            <p className="text-pale-red-foreground font-semibold text-lg">{t("denied")}</p>
            <p className="text-pale-red-foreground/80 text-sm mt-1">
              {t("deniedBody")}
            </p>
          </div>
        )}

        <div className="bg-white border border-slate-100 rounded-2xl p-8 shadow-sm">
          <div className="flex items-center gap-2 mb-6">
            <Lock className="w-4 h-4 text-pale-blue-foreground" />
            <span className="text-xs text-slate-500 uppercase tracking-wider font-medium">
              {mode === "signin" ? t("secure") : t("setup")}
            </span>
          </div>

          {confirmationSent ? (
            <div className="text-center py-4">
              <CheckCircle className="w-10 h-10 text-pale-green-foreground mx-auto mb-3" />
              <p className="text-slate-900 font-semibold">{t("checkEmail")}</p>
              <p className="text-slate-500 text-sm mt-2">
                {t("sentLink", { email })}
              </p>
              <button
                type="button"
                onClick={() => switchMode("signin")}
                className="mt-5 text-pale-blue-foreground hover:opacity-80 text-sm font-medium"
              >
                {t("backToSignIn")}
              </button>
            </div>
          ) : (
            <form onSubmit={mode === "signin" ? handleSignIn : handleSignUp} className="space-y-5">
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                  {t("email")}
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-300/50 focus:border-blue-300 transition-all"
                  placeholder={t("emailPh")}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                  {mode === "signin" ? t("password") : t("createPassword")}
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 pr-12 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-300/50 focus:border-blue-300 transition-all"
                    placeholder={mode === "signin" ? t("passwordPh") : t("min8")}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? t("hidePw") : t("showPw")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {mode === "signup" && (
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                    {t("confirmPw")}
                  </label>
                  <input
                    type={showPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    required
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-300/50 focus:border-blue-300 transition-all"
                    placeholder={t("confirmPh")}
                  />
                </div>
              )}

              {error && (
                <div className="rounded-xl bg-pale-red border border-red-100 px-4 py-3 text-pale-red-foreground text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-primary-foreground font-semibold py-3 rounded-xl transition-all duration-200 flex items-center justify-center gap-2 mt-2"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    {mode === "signin" ? t("authenticating") : t("creating")}
                  </>
                ) : (
                  <>
                    <Lock className="w-4 h-4" />
                    {mode === "signin" ? t("access") : t("create")}
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => switchMode(mode === "signin" ? "signup" : "signin")}
                className="w-full text-center text-slate-400 hover:text-slate-600 text-xs font-medium transition-colors"
              >
                {mode === "signin"
                  ? t("firstTime")
                  : t("back")}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-slate-400 text-xs mt-6">
          {t("footer")}
        </p>
      </div>
    </div>
  );
}
