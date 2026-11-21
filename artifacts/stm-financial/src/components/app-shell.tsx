import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import ChangePasswordDialog from "@/components/change-password-dialog";
import { useChatKeyMaintenance, useChatUnread } from "@/components/team-chat";
import { useAuth } from "@/lib/auth-context";
import { supabase, type Role } from "@/lib/supabase";
import { makeT, roleLabel, useLang } from "@/lib/app-i18n";
import {
  Shield, LayoutDashboard, Users, LogOut, Menu, X, ChevronRight, TrendingUp, History, CreditCard, Receipt, Cylinder, KeyRound, MessageCircle, Wallet, Settings,
} from "lucide-react";

type Props = { children: React.ReactNode };

const useT = makeT({
  dashboard: { en: "Dashboard", my: "အကျဉ်းချုပ်" },
  shifts: { en: "Shifts", my: "ဆိုင်းစာရင်းများ" },
  profit: { en: "Profit", my: "အမြတ်" },
  pp: { en: "P-P Ledger", my: "P-P စာရင်း" },
  ppHistory: { en: "P-P History", my: "P-P မှတ်တမ်း" },
  debt: { en: "Debt Tracker", my: "အကြွေးစာရင်း" },
  salary: { en: "Salary", my: "လစာ" },
  chat: { en: "Team Chat", my: "အဖွဲ့ Chat" },
  access: { en: "Staff Access", my: "ဝန်ထမ်း ဝင်ခွင့်" },
  settings: { en: "Settings", my: "ဆက်တင်" },
  portal: { en: "Executive Portal", my: "စီမံခန့်ခွဲမှု Portal" },
  executive: { en: "Executive", my: "စီမံသူ" },
  changePw: { en: "Change password", my: "စကားဝှက် ပြောင်းရန်" },
  signOut: { en: "Sign Out", my: "ထွက်ရန်" },
  openMenu: { en: "Open menu", my: "Menu ဖွင့်ရန်" },
  closeMenu: { en: "Close menu", my: "Menu ပိတ်ရန်" },
  newChat: { en: "{n} new team chat messages", my: "Chat စာအသစ် {n} စောင်" },
});

const navItems: { path: string; label: "dashboard" | "shifts" | "profit" | "pp" | "ppHistory" | "debt" | "salary" | "chat" | "access" | "settings"; icon: typeof LayoutDashboard; roles: Role[] }[] = [
  { path: "/dashboard", label: "dashboard", icon: LayoutDashboard, roles: ["ceo"] },
  { path: "/shifts", label: "shifts", icon: Receipt, roles: ["ceo"] },
  { path: "/pipa-ledger", label: "pp", icon: Cylinder, roles: ["ceo", "accountant", "manager"] },
  { path: "/pipa-ledger/history", label: "ppHistory", icon: History, roles: ["ceo", "accountant", "manager"] },
  { path: "/profit", label: "profit", icon: TrendingUp, roles: ["ceo"] },
  { path: "/debt-tracker", label: "debt", icon: CreditCard, roles: ["ceo", "accountant"] },
  { path: "/salary", label: "salary", icon: Wallet, roles: ["ceo", "accountant"] },
  { path: "/chat", label: "chat", icon: MessageCircle, roles: ["ceo"] },
  { path: "/manage-access", label: "access", icon: Users, roles: ["ceo"] },
  { path: "/settings", label: "settings", icon: Settings, roles: ["ceo", "accountant", "manager"] },
];

export default function AppShell({ children }: Props) {
  const { user, profile, signOut } = useAuth();
  const t = useT();
  const lang = useLang();
  // Screen readers and the browser's own controls follow the chosen language.
  useEffect(() => { document.documentElement.lang = lang === "my" ? "my" : "en"; }, [lang]);
  const [location, setLocation] = useLocation();
  const unread = useChatUnread(supabase, profile?.role === "ceo" ? user?.id ?? null : null, location !== "/chat");
  // While the portal is open, hand the chat's encryption key to staff's new phones.
  useChatKeyMaintenance(supabase, profile?.role === "ceo" ? user?.id ?? null : null);
  const badge = (path: string) =>
    path === "/chat" && unread > 0 ? (
      <span className="ml-auto min-w-5 h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] font-bold flex items-center justify-center">
        {unread > 99 ? "99+" : unread}
      </span>
    ) : null;
  const [mobileOpen, setMobileOpen] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const visibleNavItems = navItems.filter(item => !profile || item.roles.includes(profile.role));

  async function handleSignOut() {
    await signOut();
    setLocation("/");
  }

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar — desktop */}
      <aside className="hidden lg:flex w-64 flex-col bg-white border-r border-slate-100 fixed inset-y-0 left-0 z-30">
        <div className="px-5 py-5 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-pale-blue flex items-center justify-center shrink-0">
              <Shield className="w-5 h-5 text-pale-blue-foreground" />
            </div>
            <div>
              <p className="text-slate-900 font-bold text-sm leading-tight">STM Financial</p>
              <p className="text-slate-500 text-xs">{t("portal")}</p>
            </div>
          </div>
        </div>

        <div className="px-4 py-4 border-b border-slate-100">
          <div className="bg-slate-50 rounded-xl px-4 py-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-pale-blue flex items-center justify-center text-pale-blue-foreground font-bold text-sm">
              {profile?.username?.[0]?.toUpperCase() ?? "C"}
            </div>
            <div className="min-w-0">
              <p className="text-slate-900 text-sm font-semibold truncate">{profile?.username ?? roleLabel("ceo", lang)}</p>
              <p className="text-slate-500 text-xs uppercase tracking-wider">{profile ? roleLabel(profile.role, lang) : t("executive")}</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {visibleNavItems.map(({ path, label, icon: Icon }) => {
            const active = location === path || location.startsWith(path);
            return (
              <button
                key={path}
                onClick={() => setLocation(path)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  active
                    ? "bg-pale-blue text-pale-blue-foreground"
                    : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {t(label)}
                {badge(path) ?? (active && <ChevronRight className="w-3.5 h-3.5 ml-auto opacity-60" />)}
              </button>
            );
          })}
        </nav>

        <div className="px-3 py-4 border-t border-slate-100 space-y-1">
          <button
            onClick={() => setChangingPassword(true)}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-500 hover:text-slate-900 hover:bg-slate-50 transition-all"
          >
            <KeyRound className="w-4 h-4 shrink-0" />
            {t("changePw")}
          </button>
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-500 hover:text-red-600 hover:bg-red-50 transition-all"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            {t("signOut")}
          </button>
        </div>
      </aside>

      {/* Mobile header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 bg-white border-b border-slate-100 px-4 py-3 flex items-center justify-end">
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label={mobileOpen ? t("closeMenu") : t("openMenu")}
          aria-expanded={mobileOpen}
          className="relative text-slate-500 hover:text-slate-900 p-1"
        >
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          {!mobileOpen && unread > 0 && (
            <span className="absolute top-0 right-0 w-2.5 h-2.5 rounded-full bg-red-500 ring-2 ring-white" aria-label={t("newChat", { n: unread })} />
          )}
        </button>
      </div>

      {/* Mobile sidebar */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-30">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <div className="absolute left-0 top-14 bottom-0 w-64 bg-white border-r border-slate-100 shadow-lg flex flex-col p-3 space-y-1">
            {visibleNavItems.map(({ path, label, icon: Icon }) => {
              const active = location === path;
              return (
                <button
                  key={path}
                  onClick={() => { setLocation(path); setMobileOpen(false); }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                    active
                      ? "bg-pale-blue text-pale-blue-foreground"
                      : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {t(label)}
                  {badge(path)}
                </button>
              );
            })}
            <button
              onClick={() => { setMobileOpen(false); setChangingPassword(true); }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-500 hover:text-slate-900 hover:bg-slate-50 transition-all mt-4"
            >
              <KeyRound className="w-4 h-4" />
              {t("changePw")}
            </button>
            <button
              onClick={handleSignOut}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-500 hover:text-red-600 hover:bg-red-50 transition-all"
            >
              <LogOut className="w-4 h-4" />
              {t("signOut")}
            </button>
          </div>
        </div>
      )}

      {/* min-w-0: a flex item won't shrink below its content's natural width by default,
          which let Staff Access push the page wider than a phone screen. */}
      <div className="flex-1 min-w-0 lg:ml-64 flex flex-col pt-14 lg:pt-0 min-h-screen">
        {children}
      </div>

      {changingPassword && <ChangePasswordDialog onClose={() => setChangingPassword(false)} />}
    </div>
  );
}
