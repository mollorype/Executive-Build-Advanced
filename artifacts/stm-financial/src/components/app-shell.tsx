import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth-context";
import {
  Shield, LayoutDashboard, Users, LogOut, Menu, X, ChevronRight, PackageSearch, CreditCard, Receipt,
} from "lucide-react";

type Props = { children: React.ReactNode };

const navItems = [
  { path: "/dashboard", label: "Operations", icon: LayoutDashboard },
  { path: "/shifts", label: "Shifts", icon: Receipt },
  { path: "/po-registry", label: "PO Registry", icon: PackageSearch },
  { path: "/debt-tracker", label: "Debt Tracker", icon: CreditCard },
  { path: "/manage-access", label: "Manage Access", icon: Users },
];

export default function AppShell({ children }: Props) {
  const { profile, signOut } = useAuth();
  const [location, setLocation] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  async function handleSignOut() {
    await signOut();
    setLocation("/");
  }

  return (
    <div className="min-h-screen bg-[#0a0f1e] flex">
      {/* Sidebar — desktop */}
      <aside className="hidden lg:flex w-64 flex-col bg-[#0d1424] border-r border-slate-700/40 fixed inset-y-0 left-0 z-30">
        <div className="px-5 py-5 border-b border-slate-700/40">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center shrink-0">
              <Shield className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <p className="text-white font-bold text-sm leading-tight">STM Financial</p>
              <p className="text-slate-500 text-xs">Executive Portal</p>
            </div>
          </div>
        </div>

        <div className="px-4 py-4 border-b border-slate-700/40">
          <div className="bg-slate-800/50 rounded-xl px-4 py-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-blue-600/30 border border-blue-500/30 flex items-center justify-center text-blue-300 font-bold text-sm">
              {profile?.username?.[0]?.toUpperCase() ?? "C"}
            </div>
            <div className="min-w-0">
              <p className="text-white text-sm font-semibold truncate">{profile?.username ?? "CEO"}</p>
              <p className="text-slate-500 text-xs uppercase tracking-wider">{profile?.role ?? "Executive"}</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map(({ path, label, icon: Icon }) => {
            const active = location === path || location.startsWith(path);
            return (
              <button
                key={path}
                onClick={() => setLocation(path)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  active
                    ? "bg-blue-600/20 text-blue-300 border border-blue-500/20"
                    : "text-slate-400 hover:text-white hover:bg-slate-700/40"
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {label}
                {active && <ChevronRight className="w-3.5 h-3.5 ml-auto opacity-60" />}
              </button>
            );
          })}
        </nav>

        <div className="px-3 py-4 border-t border-slate-700/40">
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-all"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Mobile header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 bg-[#0d1424] border-b border-slate-700/40 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-blue-400" />
          <span className="text-white font-bold text-sm">STM Financial</span>
        </div>
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="text-slate-400 hover:text-white p-1"
        >
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile sidebar */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-30">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <div className="absolute left-0 top-14 bottom-0 w-64 bg-[#0d1424] border-r border-slate-700/40 flex flex-col p-3 space-y-1">
            {navItems.map(({ path, label, icon: Icon }) => {
              const active = location === path;
              return (
                <button
                  key={path}
                  onClick={() => { setLocation(path); setMobileOpen(false); }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                    active
                      ? "bg-blue-600/20 text-blue-300 border border-blue-500/20"
                      : "text-slate-400 hover:text-white hover:bg-slate-700/40"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              );
            })}
            <button
              onClick={handleSignOut}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-all mt-4"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 lg:ml-64 flex flex-col pt-14 lg:pt-0 min-h-screen">
        {children}
      </div>
    </div>
  );
}
