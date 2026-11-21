import { ShieldX, LogOut } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useLocation } from "wouter";
import { makeT } from "@/lib/app-i18n";

const useT = makeT({
  title: { en: "Access Denied", my: "ဝင်ခွင့် မရှိပါ" },
  body: { en: "Your account does not have executive privileges.", my: "သင့်အကောင့်တွင် စီမံခွင့် မရှိပါ။" },
  detail: { en: "This portal is restricted to authorized executive accounts only. Contact your system administrator if you believe this is an error.", my: "ဤ Portal ကို ခွင့်ပြုထားသော အကောင့်များသာ သုံးနိုင်ပါသည်။ မှားယွင်းနေသည်ဟု ထင်လျှင် ပိုင်ရှင်ကို ဆက်သွယ်ပါ။" },
  back: { en: "Return to Login", my: "Login သို့ ပြန်သွားရန်" },
  footer: { en: "STM Financial · Executive Portal", my: "STM Financial · စီမံခန့်ခွဲမှု Portal" },
});

export default function AccessDenied() {
  const { signOut } = useAuth();
  const [, setLocation] = useLocation();
  const t = useT();

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
        <h1 className="text-4xl font-bold text-slate-900 mb-2">{t("title")}</h1>
        <div className="w-16 h-1 bg-red-500 mx-auto mb-6 rounded-full" />
        <p className="text-slate-500 text-lg mb-2">
          {t("body")}
        </p>
        <p className="text-slate-400 text-sm mb-8">
          {t("detail")}
        </p>
        <button
          onClick={handleSignOut}
          className="inline-flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold px-6 py-3 rounded-xl transition-all"
        >
          <LogOut className="w-4 h-4" />
          {t("back")}
        </button>
        <p className="text-slate-300 text-xs mt-8 uppercase tracking-widest">
          {t("footer")}
        </p>
      </div>
    </div>
  );
}
