import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { UserPlus, Check, AlertCircle, Shield, Trash2, Mail, RefreshCw, Copy } from "lucide-react";

type AllowedEmployee = {
  id: string;
  email: string;
  created_at: string;
};

const SETUP_SQL = `-- Run this once in your Supabase SQL Editor:
CREATE TABLE IF NOT EXISTS allowed_employees (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE allowed_employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read" ON allowed_employees FOR SELECT TO anon USING (true);
CREATE POLICY "auth_manage" ON allowed_employees FOR ALL TO authenticated USING (true);`;

export default function ManageAccess() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [employees, setEmployees] = useState<AllowedEmployee[]>([]);
  const [fetching, setFetching] = useState(true);
  const [tableError, setTableError] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchEmployees = useCallback(async () => {
    setFetching(true);
    const { data, error } = await supabase
      .from("allowed_employees")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      if (error.message.includes("does not exist") || error.code === "42P01" || error.code === "PGRST116") {
        setTableError(true);
      }
    } else {
      setTableError(false);
      setEmployees((data ?? []) as AllowedEmployee[]);
    }
    setFetching(false);
  }, []);

  useEffect(() => { fetchEmployees(); }, [fetchEmployees]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed.includes("@")) {
      setResult({ success: false, message: "Please enter a valid email address." });
      return;
    }

    setLoading(true);
    setResult(null);

    const { error } = await supabase
      .from("allowed_employees")
      .insert({ email: trimmed });

    setLoading(false);

    if (error) {
      if (error.code === "23505") {
        setResult({ success: false, message: `${trimmed} is already in the allowlist.` });
      } else {
        setResult({ success: false, message: error.message });
      }
      return;
    }

    setResult({ success: true, message: `${trimmed} can now submit shifts.` });
    setEmail("");
    fetchEmployees();
    setTimeout(() => setResult(null), 4000);
  }

  async function handleDelete(emp: AllowedEmployee) {
    if (!window.confirm(`Remove ${emp.email} from the allowlist?\nThey will no longer be able to submit shifts.`)) return;
    setDeleting(emp.id);
    await supabase.from("allowed_employees").delete().eq("id", emp.id);
    setDeleting(null);
    fetchEmployees();
  }

  function handleCopy() {
    navigator.clipboard.writeText(SETUP_SQL);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="px-6 py-5 border-b border-slate-700/50">
        <h1 className="text-2xl font-bold text-white">Staff Access</h1>
        <p className="text-slate-400 text-sm mt-0.5">Control which employees can submit daily shift reports</p>
      </div>

      <div className="p-6 max-w-xl space-y-5">
        {tableError && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <AlertCircle className="w-5 h-5 text-amber-400 shrink-0" />
              <p className="text-amber-300 font-semibold text-sm">One-time setup required</p>
            </div>
            <p className="text-amber-400/80 text-xs mb-3">
              Run this SQL once in your Supabase SQL Editor to create the employee allowlist table:
            </p>
            <pre className="bg-black/40 rounded-lg p-3 text-xs text-slate-300 font-mono overflow-x-auto whitespace-pre-wrap mb-3">
              {SETUP_SQL}
            </pre>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-white rounded-lg px-3 py-1.5 transition-colors"
            >
              <Copy className="w-3 h-3" />
              {copied ? "Copied!" : "Copy SQL"}
            </button>
          </div>
        )}

        {!tableError && (
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 flex items-start gap-3">
            <Shield className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-blue-300 font-semibold text-sm">Email Allowlist</p>
              <p className="text-blue-400/70 text-xs mt-0.5">
                Only emails added here can log into the STM Daily worker app. Add each employee's real email address.
              </p>
            </div>
          </div>
        )}

        <div className="bg-[#111827] border border-slate-700/50 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-700/50 flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-blue-400" />
            <span className="text-white font-semibold text-sm">Add Employee Email</span>
          </div>

          <form onSubmit={handleAdd} className="p-6 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                Employee Email Address
              </label>
              <div className="flex rounded-lg overflow-hidden border border-slate-600/50 focus-within:ring-2 focus-within:ring-blue-500/50 transition-all">
                <div className="flex items-center px-3 bg-slate-800 border-r border-slate-700">
                  <Mail className="w-4 h-4 text-slate-500" />
                </div>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  disabled={tableError}
                  className="flex-1 bg-[#0d1527] px-4 py-3 text-white placeholder-slate-500 focus:outline-none disabled:opacity-40"
                  placeholder="worker@gmail.com"
                  autoComplete="off"
                />
              </div>
            </div>

            {result && (
              <div className={`flex items-start gap-3 rounded-xl p-4 ${
                result.success
                  ? "bg-emerald-500/10 border border-emerald-500/20"
                  : "bg-red-500/10 border border-red-500/20"
              }`}>
                {result.success
                  ? <Check className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                  : <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />}
                <p className={`text-sm ${result.success ? "text-emerald-300" : "text-red-300"}`}>
                  {result.message}
                </p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !email || tableError}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2"
            >
              {loading ? (
                <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Adding…</>
              ) : (
                <><UserPlus className="w-4 h-4" /> Allow This Employee</>
              )}
            </button>
          </form>
        </div>

        {!tableError && (
          <div className="bg-[#111827] border border-slate-700/50 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-700/50 flex items-center justify-between">
              <span className="text-white font-semibold text-sm">
                Allowed Employees
                {employees.length > 0 && (
                  <span className="ml-2 bg-slate-700 text-slate-300 text-xs font-bold rounded-full px-2 py-0.5">
                    {employees.length}
                  </span>
                )}
              </span>
              <button
                onClick={fetchEmployees}
                disabled={fetching}
                className="text-slate-500 hover:text-slate-300 transition-colors"
              >
                <RefreshCw className={`w-4 h-4 ${fetching ? "animate-spin" : ""}`} />
              </button>
            </div>

            {fetching ? (
              <div className="px-6 py-8 text-center text-slate-500 text-sm">Loading…</div>
            ) : employees.length === 0 ? (
              <div className="px-6 py-8 text-center">
                <Mail className="w-8 h-8 text-slate-700 mx-auto mb-2" />
                <p className="text-slate-500 text-sm">No employees added yet.</p>
                <p className="text-slate-600 text-xs mt-1">Add an email above to let workers submit shifts.</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-700/30">
                {employees.map(emp => (
                  <div key={emp.id} className="px-6 py-3.5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-7 h-7 rounded-lg bg-blue-900/40 border border-blue-700/30 flex items-center justify-center shrink-0">
                        <span className="text-xs font-bold text-blue-300 uppercase">
                          {emp.email[0]}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm text-white font-medium truncate">{emp.email}</p>
                        <p className="text-xs text-slate-500">
                          Added {new Date(emp.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDelete(emp)}
                      disabled={deleting === emp.id}
                      className="shrink-0 text-slate-600 hover:text-red-400 disabled:opacity-40 transition-colors p-1"
                      title="Remove access"
                    >
                      {deleting === emp.id
                        ? <div className="w-4 h-4 border-2 border-slate-500/30 border-t-slate-400 rounded-full animate-spin" />
                        : <Trash2 className="w-4 h-4" />}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
