import { Switch, Route, Router as WouterRouter, useLocation, useSearch, Redirect } from "wouter";
import { loginPathFor, nextFromSearch } from "@/lib/return-to";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { homeFor, type Role } from "@/lib/supabase";
import AppShell from "@/components/app-shell";
import Login from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import Shifts from "@/pages/shifts";
import ManageAccess from "@/pages/manage-access";
import ProfitPage from "@/pages/profit";
import PipaHistory from "@/pages/pipa-history";
import PipaLedger from "@/pages/pipa-ledger";
import DebtTracker from "@/pages/debt-tracker";
import SalaryPage from "@/pages/salary";
import SettingsPage from "@/pages/settings";
import ChatPage from "@/pages/chat";

const queryClient = new QueryClient();

function ProtectedRoute({ children, allow = ["ceo"] }: { children: React.ReactNode; allow?: Role[] }) {
  const { user, profile, loading } = useAuth();
  const [location] = useLocation();
  const search = useSearch();

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-500 text-sm">Verifying credentials...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    // Remember the page (incl. ?query) so login lands back on it.
    return <Redirect to={loginPathFor(location + (search ? `?${search}` : ""))} />;
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-500 text-sm">Loading profile...</p>
        </div>
      </div>
    );
  }

  if (!allow.includes(profile.role)) {
    // A recognized role just hit a page outside its scope (e.g. an Accountant on /dashboard) — send them home.
    return <Redirect to={homeFor(profile.role)} />;
  }

  return (
    <AppShell>
      {children}
    </AppShell>
  );
}

function AuthRoute({ children }: { children: React.ReactNode }) {
  const { user, profile, loading } = useAuth();
  const search = useSearch();

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-10 h-10 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (user && profile) {
    return <Redirect to={nextFromSearch(search) ?? homeFor(profile.role)} />;
  }

  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      <Route path="/">
        <AuthRoute>
          <Login />
        </AuthRoute>
      </Route>

      <Route path="/dashboard">
        <ProtectedRoute>
          <Dashboard />
        </ProtectedRoute>
      </Route>

      <Route path="/shifts">
        <ProtectedRoute>
          <Shifts />
        </ProtectedRoute>
      </Route>

      <Route path="/profit">
        <ProtectedRoute>
          <ProfitPage />
        </ProtectedRoute>
      </Route>

      {/* The PO Registry was replaced by the Profit page. */}
      <Route path="/po-registry">
        <Redirect to="/profit" />
      </Route>

      <Route path="/pipa-ledger/history">
        <ProtectedRoute allow={["ceo", "accountant", "manager"]}>
          <PipaHistory />
        </ProtectedRoute>
      </Route>

      <Route path="/pipa-ledger">
        <ProtectedRoute allow={["ceo", "accountant", "manager"]}>
          <PipaLedger />
        </ProtectedRoute>
      </Route>

      <Route path="/debt-tracker">
        <ProtectedRoute allow={["ceo", "accountant"]}>
          <DebtTracker />
        </ProtectedRoute>
      </Route>

      <Route path="/salary">
        <ProtectedRoute allow={["ceo", "accountant"]}>
          <SalaryPage />
        </ProtectedRoute>
      </Route>

      <Route path="/settings">
        <ProtectedRoute allow={["ceo", "accountant", "manager"]}>
          <SettingsPage />
        </ProtectedRoute>
      </Route>

      <Route path="/manage-access">
        <ProtectedRoute>
          <ManageAccess />
        </ProtectedRoute>
      </Route>

      <Route path="/chat">
        <ProtectedRoute>
          <ChatPage />
        </ProtectedRoute>
      </Route>

      <Route>
        <Redirect to="/" />
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
