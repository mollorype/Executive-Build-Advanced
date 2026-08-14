import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { UserPlus, Calculator, Check, AlertCircle, Shield, Trash2, Mail, RefreshCw, Copy, type LucideIcon } from "lucide-react";

type AllowlistEntry = {
  id: string;
  email: string;
  created_at: string;
};

function EmailAllowlistCard({
  table,
  cardIcon: CardIcon,
  infoTitle,
  infoDescription,
  addSectionTitle,
  addButtonLabel,
  placeholder,
  listTitle,
  emptyHint,
  successMessage,
  deleteConfirm,
  setupSql,
}: {
  table: string;
  cardIcon: LucideIcon;
  infoTitle: string;
  infoDescription: string;
  addSectionTitle: string;
  addButtonLabel: string;
  placeholder: string;
  listTitle: string;
  emptyHint: string;
  successMessage: (email: string) => string;
  deleteConfirm: (email: string) => string;
  setupSql: string;
}) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [entries, setEntries] = useState<AllowlistEntry[]>([]);
  const [fetching, setFetching] = useState(true);
  const [tableError, setTableError] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchEntries = useCallback(async () => {
    setFetching(true);
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      if (error.message.includes("does not exist") || error.code === "42P01" || error.code === "PGRST116") {
        setTableError(true);
      }
    } else {
      setTableError(false);
      setEntries((data ?? []) as AllowlistEntry[]);
    }
    setFetching(false);
  }, [table]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed.includes("@")) {
      setResult({ success: false, message: "Please enter a valid email address." });
      return;
    }

    setLoading(true);
    setResult(null);

    const { error } = await supabase.from(table).insert({ email: trimmed });

    setLoading(false);

    if (error) {
      if (error.code === "23505") {
        setResult({ success: false, message: `${trimmed} is already in the allowlist.` });
      } else {
        setResult({ success: false, message: error.message });
      }
      return;
    }

    setResult({ success: true, message: successMessage(trimmed) });
    setEmail("");
    fetchEntries();
    setTimeout(() => setResult(null), 4000);
  }

  async function handleDelete(entry: AllowlistEntry) {
    if (!window.confirm(deleteConfirm(entry.email))) return;
    setDeleting(entry.id);
    await supabase.from(table).delete().eq("id", entry.id);
    setDeleting(null);
    fetchEntries();
  }

  function handleCopy() {
    navigator.clipboard.writeText(setupSql);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-5">
      {tableError && (
        <div className="bg-pale-gold border border-amber-100 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle className="w-5 h-5 text-pale-gold-foreground shrink-0" />
            <p className="text-pale-gold-foreground font-semibold text-sm">One-time setup required</p>
          </div>
          <p className="text-pale-gold-foreground/80 text-xs mb-3">
            Run this SQL once in your Supabase SQL Editor to create the allowlist table:
          </p>
          <pre className="bg-slate-900 rounded-lg p-3 text-xs text-slate-100 font-mono overflow-x-auto whitespace-pre-wrap mb-3">
            {setupSql}
          </pre>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 text-xs bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-lg px-3 py-1.5 transition-colors"
          >
            <Copy className="w-3 h-3" />
            {copied ? "Copied!" : "Copy SQL"}
          </button>
        </div>
      )}

      {!tableError && (
        <div className="bg-pale-blue rounded-2xl p-4 flex items-start gap-3">
          <Shield className="w-5 h-5 text-pale-blue-foreground shrink-0 mt-0.5" />
          <div>
            <p className="text-pale-blue-foreground font-semibold text-sm">{infoTitle}</p>
            <p className="text-pale-blue-foreground/70 text-xs mt-0.5">{infoDescription}</p>
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-100 shadow-sm rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-2">
          <CardIcon className="w-4 h-4 text-pale-blue-foreground" />
          <span className="text-slate-900 font-semibold text-sm">{addSectionTitle}</span>
        </div>

        <form onSubmit={handleAdd} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
              Email Address
            </label>
            <div className="flex rounded-xl overflow-hidden border border-slate-200 focus-within:ring-2 focus-within:ring-blue-300/50 transition-all">
              <div className="flex items-center px-3 bg-slate-50 border-r border-slate-200">
                <Mail className="w-4 h-4 text-slate-400" />
              </div>
              <input
                type="text"
                inputMode="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                disabled={tableError}
                className="flex-1 bg-white px-4 py-3 text-slate-900 placeholder-slate-400 focus:outline-none disabled:opacity-40"
                placeholder={placeholder}
                autoComplete="off"
              />
            </div>
          </div>

          {result && (
            <div className={`flex items-start gap-3 rounded-2xl p-4 ${
              result.success
                ? "bg-pale-green border border-emerald-100"
                : "bg-pale-red border border-red-100"
            }`}>
              {result.success
                ? <Check className="w-5 h-5 text-pale-green-foreground shrink-0 mt-0.5" />
                : <AlertCircle className="w-5 h-5 text-pale-red-foreground shrink-0 mt-0.5" />}
              <p className={`text-sm ${result.success ? "text-pale-green-foreground" : "text-pale-red-foreground"}`}>
                {result.message}
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !email || tableError}
            className="w-full bg-primary hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed text-primary-foreground font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2"
          >
            {loading ? (
              <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Adding…</>
            ) : (
              <><UserPlus className="w-4 h-4" /> {addButtonLabel}</>
            )}
          </button>
        </form>
      </div>

      {!tableError && (
        <div className="bg-white border border-slate-100 shadow-sm rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <span className="text-slate-900 font-semibold text-sm">
              {listTitle}
              {entries.length > 0 && (
                <span className="ml-2 bg-slate-100 text-slate-600 text-xs font-bold rounded-full px-2 py-0.5">
                  {entries.length}
                </span>
              )}
            </span>
            <button
              onClick={fetchEntries}
              disabled={fetching}
              aria-label="Refresh list"
              className="text-slate-400 hover:text-slate-600 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${fetching ? "animate-spin" : ""}`} />
            </button>
          </div>

          {fetching ? (
            <div className="px-6 py-8 text-center text-slate-400 text-sm">Loading…</div>
          ) : entries.length === 0 ? (
            <div className="px-6 py-8 text-center">
              <Mail className="w-8 h-8 text-slate-200 mx-auto mb-2" />
              <p className="text-slate-400 text-sm">No one added yet.</p>
              <p className="text-slate-400 text-xs mt-1">{emptyHint}</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {entries.map(entry => (
                <div key={entry.id} className="px-6 py-3.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-7 h-7 rounded-lg bg-pale-blue flex items-center justify-center shrink-0">
                      <span className="text-xs font-bold text-pale-blue-foreground uppercase">
                        {entry.email[0]}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm text-slate-900 font-medium truncate">{entry.email}</p>
                      <p className="text-xs text-slate-400">
                        Added {new Date(entry.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(entry)}
                    disabled={deleting === entry.id}
                    className="shrink-0 text-slate-300 hover:text-red-500 disabled:opacity-40 transition-colors p-1"
                    title="Remove access"
                  >
                    {deleting === entry.id
                      ? <div className="w-4 h-4 border-2 border-slate-300 border-t-slate-500 rounded-full animate-spin" />
                      : <Trash2 className="w-4 h-4" />}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const EMPLOYEE_SETUP_SQL = `-- Run this once in your Supabase SQL Editor:
CREATE TABLE IF NOT EXISTS allowed_employees (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE allowed_employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read" ON allowed_employees FOR SELECT TO anon USING (true);
CREATE POLICY "auth_manage" ON allowed_employees FOR ALL TO authenticated USING (true);`;

const ACCOUNTANT_SETUP_SQL = `-- Run this once in your Supabase SQL Editor:
CREATE TABLE IF NOT EXISTS accountant_access (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE accountant_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read" ON accountant_access FOR SELECT TO anon USING (true);
CREATE POLICY "auth_manage" ON accountant_access FOR ALL TO authenticated USING (true);`;

export default function ManageAccess() {
  return (
    <div className="flex-1 overflow-auto bg-slate-50">
      <div className="px-6 py-5 border-b border-slate-100 bg-white">
        <h1 className="text-2xl font-bold text-slate-900">Staff Access</h1>
        <p className="text-slate-500 text-sm mt-0.5">Control who can access STM Daily and STM Financial</p>
      </div>

      <div className="p-6 max-w-xl space-y-10">
        <section>
          <div className="flex items-center gap-2 mb-1">
            <Mail className="w-4 h-4 text-pale-blue-foreground" />
            <h2 className="text-slate-900 font-bold text-sm">STM Daily Access</h2>
          </div>
          <p className="text-slate-500 text-xs mb-4">Employees who can submit daily shift reports.</p>
          <EmailAllowlistCard
            table="allowed_employees"
            cardIcon={UserPlus}
            infoTitle="Email Allowlist"
            infoDescription="Only emails added here can log into the STM Daily app. Add each employee's real email address."
            addSectionTitle="Add Employee Email"
            addButtonLabel="Allow This Employee"
            placeholder="name@company.com"
            listTitle="Allowed Employees"
            emptyHint="Add an email above to let workers submit shifts."
            successMessage={email => `${email} can now submit shifts.`}
            deleteConfirm={email => `Remove ${email} from the allowlist?\nThey will no longer be able to submit shifts.`}
            setupSql={EMPLOYEE_SETUP_SQL}
          />
        </section>

        <section>
          <div className="flex items-center gap-2 mb-1">
            <Calculator className="w-4 h-4 text-pale-blue-foreground" />
            <h2 className="text-slate-900 font-bold text-sm">Accountant Access</h2>
          </div>
          <p className="text-slate-500 text-xs mb-4">
            Accountants can sign in to STM Financial, restricted to the Debt Tracker page only.
          </p>
          <EmailAllowlistCard
            table="accountant_access"
            cardIcon={Calculator}
            infoTitle="Accountant Allowlist"
            infoDescription="Only emails added here can create an Accountant account for STM Financial. Access is limited to Debt Tracker."
            addSectionTitle="Add Accountant Email"
            addButtonLabel="Invite Accountant"
            placeholder="accountant@company.com"
            listTitle="Accountants"
            emptyHint="Add an email above, then the accountant can set their password from the login page."
            successMessage={email => `${email} can now set their password and sign in as Accountant.`}
            deleteConfirm={email => `Remove ${email} from the accountant allowlist?\nThey will no longer be able to sign in as Accountant.`}
            setupSql={ACCOUNTANT_SETUP_SQL}
          />
        </section>
      </div>
    </div>
  );
}
