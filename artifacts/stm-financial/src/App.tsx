import { Switch, Route, Router as WouterRouter, useLocation, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import type { Role } from "@/lib/supabase";
import AppShell from "@/components/app-shell";
import Login from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import Shifts from "@/pages/shifts";
import ManageAccess from "@/pages/manage-access";
import PORegistry from "@/pages/po-registry";
import DebtTracker from "@/pages/debt-tracker";
import HomeExpenses from "@/pages/home-expenses";

const queryClient = new QueryClient();

/** Where a role lands when it hits a page it isn't allowed on, or logs in fresh. */
function homeFor(role: Role): string {
  return role === "accountant" ? "/debt-tracker" : "/dashboard";
}

function ProtectedRoute({ children, allow = ["ceo"] }: { children: React.ReactNode; allow?: Role[] }) {
  const { user, profile, loading } = useAuth();

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
    return <Redirect to="/" />;
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

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-10 h-10 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (user && profile) {
    return <Redirect to={homeFor(profile.role)} />;
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

      <Route path="/po-registry">
        <ProtectedRoute>
          <PORegistry />
        </ProtectedRoute>
      </Route>

      <Route path="/debt-tracker">
        <ProtectedRoute allow={["ceo", "accountant"]}>
          <DebtTracker />
        </ProtectedRoute>
      </Route>

      <Route path="/manage-access">
        <ProtectedRoute>
          <ManageAccess />
        </ProtectedRoute>
      </Route>

      <Route path="/home-expenses">
        <ProtectedRoute>
          <HomeExpenses />
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
