import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { UserPlus, Calculator, Check, AlertCircle, Shield, Trash2, Mail, RefreshCw, Copy, Crown, Briefcase, type LucideIcon } from "lucide-react";
import CeoAccessSection from "@/components/ceo-access-section";
import StaffLoginsSection from "@/components/staff-logins-section";
import { confirmDialog } from "@/components/confirm-dialog";
import { makeT } from "@/lib/app-i18n";

const useT = makeT({
  // Allowlist card
  invalidEmail: { en: "Please enter a valid email address.", my: "မှန်ကန်သော email လိပ်စာ ထည့်ပါ။" },
  already: { en: "{email} is already in the allowlist.", my: "{email} သည် စာရင်းထဲတွင် ရှိပြီးသား ဖြစ်သည်။" },
  setupRequired: { en: "One-time setup required", my: "တစ်ကြိမ် စနစ်ထည့်သွင်းရန် လိုအပ်သည်" },
  setupHelp: { en: "Run this SQL once in your Supabase SQL Editor to create the allowlist table:", my: "စာရင်း table ဖန်တီးရန် ဤ SQL ကို Supabase SQL Editor တွင် တစ်ကြိမ် run ပါ:" },
  copied: { en: "Copied!", my: "ကူးပြီး!" },
  copySql: { en: "Copy SQL", my: "SQL ကူးရန်" },
  emailAddress: { en: "Email Address", my: "Email လိပ်စာ" },
  adding: { en: "Adding…", my: "ထည့်နေသည်…" },
  refresh: { en: "Refresh list", my: "စာရင်း ပြန်ဖွင့်ရန်" },
  loading: { en: "Loading…", my: "ဖွင့်နေသည်…" },
  noneYet: { en: "No one added yet.", my: "မည်သူမျှ မထည့်ရသေးပါ။" },
  added: { en: "Added {date}", my: "{date} တွင် ထည့်ခဲ့" },
  removeAccess: { en: "Remove access", my: "ခွင့်ပြုချက် ဖယ်ရန်" },
  notRemoved: { en: "{email} wasn't removed — your account may not be allowed to. Refresh and try again.", my: "{email} ကို မဖယ်ရပါ — သင့်အကောင့် ခွင့်မရှိနိုင်ပါ။ ပြန်ဖွင့်ပြီး ထပ်ကြိုးစားပါ။" },
  // Page
  title: { en: "Staff Access", my: "ဝန်ထမ်း ခွင့်ပြုချက်" },
  subtitle: { en: "Control who can access STM Daily and STM Financial", my: "STM Daily နှင့် STM Financial ကို မည်သူ သုံးနိုင်မည်ကို စီမံပါ" },
  owner: { en: "Owner", my: "ပိုင်ရှင်" },
  ownerDesc: { en: "Owners can see and change everything. Adding or removing one needs your password and is announced on Telegram.", my: "ပိုင်ရှင်များသည် အားလုံးကို ကြည့်ပြီး ပြင်နိုင်သည်။ ထည့်ရန် သို့မဟုတ် ဖယ်ရန် သင့် password လိုပြီး Telegram တွင် ကြေညာပါမည်။" },
  selling: { en: "Selling Staff", my: "အရောင်း ဝန်ထမ်း" },
  sellingDesc: { en: "Selling staff sign in to STM Daily to submit daily shift reports.", my: "အရောင်း ဝန်ထမ်းများသည် နေ့စဉ် ဆိုင်းစာရင်း တင်ရန် STM Daily သို့ ဝင်ပါသည်။" },
  sellInfoTitle: { en: "Email Allowlist", my: "Email ခွင့်ပြုစာရင်း" },
  sellInfoDesc: { en: "Only emails added here can log into the STM Daily app. Add each staff member's real email address.", my: "ဤနေရာတွင် ထည့်ထားသော email များသာ STM Daily သို့ ဝင်နိုင်သည်။ ဝန်ထမ်းတစ်ဦးစီ၏ email အမှန်ကို ထည့်ပါ။" },
  sellAddTitle: { en: "Add Selling Staff Email", my: "အရောင်း ဝန်ထမ်း email ထည့်ရန်" },
  sellAddBtn: { en: "Add Selling Staff", my: "အရောင်း ဝန်ထမ်း ထည့်ရန်" },
  sellEmpty: { en: "Add an email above to let workers submit shifts.", my: "ဝန်ထမ်းများ ဆိုင်းတင်နိုင်ရန် အပေါ်တွင် email ထည့်ပါ။" },
  sellOk: { en: "{email} can now submit shifts.", my: "{email} ယခု ဆိုင်း တင်နိုင်ပါပြီ။" },
  sellDel: { en: "Remove {email} from the allowlist?\nThey will no longer be able to submit shifts.", my: "{email} ကို စာရင်းမှ ဖယ်မလား?\nဆိုင်း ထပ်တင်နိုင်တော့မည် မဟုတ်ပါ။" },
  accountant: { en: "Accountant", my: "စာရင်းကိုင်" },
  accountants: { en: "Accountants", my: "စာရင်းကိုင်များ" },
  accDesc: { en: "Accountants can sign in to STM Financial, restricted to the Debt Tracker, Salary and P-P Ledger pages.", my: "စာရင်းကိုင်များသည် STM Financial သို့ ဝင်နိုင်ပြီး အကြွေးစာရင်း၊ လစာ နှင့် P-P စာရင်း စာမျက်နှာများသာ သုံးနိုင်သည်။" },
  accInfoTitle: { en: "Accountant Allowlist", my: "စာရင်းကိုင် ခွင့်ပြုစာရင်း" },
  accInfoDesc: { en: "Only emails added here can create an Accountant account for STM Financial. Access is limited to Debt Tracker, Salary and P-P Ledger.", my: "ဤနေရာတွင် ထည့်ထားသော email များသာ STM Financial စာရင်းကိုင် အကောင့် ဖွင့်နိုင်သည်။ အကြွေးစာရင်း၊ လစာ နှင့် P-P စာရင်း သာ သုံးနိုင်သည်။" },
  accAddTitle: { en: "Add Accountant Email", my: "စာရင်းကိုင် email ထည့်ရန်" },
  accAddBtn: { en: "Invite Accountant", my: "စာရင်းကိုင် ဖိတ်ရန်" },
  accEmpty: { en: "Add an email above, then the accountant can set their password from the login page.", my: "အပေါ်တွင် email ထည့်ပါ၊ ထို့နောက် စာရင်းကိုင်သည် login စာမျက်နှာမှ password သတ်မှတ်နိုင်သည်။" },
  accOk: { en: "{email} can now set their password and sign in as Accountant.", my: "{email} ယခု password သတ်မှတ်ပြီး စာရင်းကိုင် အဖြစ် ဝင်နိုင်ပါပြီ။" },
  accDel: { en: "Remove {email} from the accountant allowlist?\nThey will no longer be able to sign in as Accountant.", my: "{email} ကို စာရင်းကိုင် စာရင်းမှ ဖယ်မလား?\nစာရင်းကိုင် အဖြစ် ထပ်ဝင်နိုင်တော့မည် မဟုတ်ပါ။" },
  manager: { en: "Manager", my: "မန်နေဂျာ" },
  managers: { en: "Managers", my: "မန်နေဂျာများ" },
  mgrDesc: { en: "Managers can sign in to STM Financial, restricted to the P-P Ledger: P-P stock, purchases, stations and deducting shift sales (which also updates the owner's POs). PO Registry stays owner-only.", my: "မန်နေဂျာများသည် STM Financial သို့ ဝင်နိုင်ပြီး P-P စာရင်း သာ သုံးနိုင်သည် — P-P လက်ကျန်၊ အဝယ်၊ ဆိုင်များ နှင့် ဆိုင်း အရောင်း နုတ်ခြင်း (ပိုင်ရှင်၏ PO များလည်း တပြိုင်နက် နုတ်သည်)။ PO မှတ်ပုံတင်ကို ပိုင်ရှင်သာ သုံးနိုင်သည်။" },
  mgrInfoTitle: { en: "Manager List", my: "မန်နေဂျာ စာရင်း" },
  mgrInfoDesc: { en: "Only emails added here can create a Manager account for STM Financial (from the login page). Only an owner can add or remove managers.", my: "ဤနေရာတွင် ထည့်ထားသော email များသာ STM Financial မန်နေဂျာ အကောင့် ဖွင့်နိုင်သည် (login စာမျက်နှာမှ)။ ပိုင်ရှင်သာ မန်နေဂျာ ထည့်/ဖယ် နိုင်သည်။" },
  mgrAddTitle: { en: "Add Manager Email", my: "မန်နေဂျာ email ထည့်ရန်" },
  mgrAddBtn: { en: "Add Manager", my: "မန်နေဂျာ ထည့်ရန်" },
  mgrEmpty: { en: "Add an email above, then the manager can set their password from the login page.", my: "အပေါ်တွင် email ထည့်ပါ၊ ထို့နောက် မန်နေဂျာသည် login စာမျက်နှာမှ password သတ်မှတ်နိုင်သည်။" },
  mgrOk: { en: "{email} can now set their password and sign in as Manager.", my: "{email} ယခု password သတ်မှတ်ပြီး မန်နေဂျာ အဖြစ် ဝင်နိုင်ပါပြီ။" },
  mgrDel: { en: "Remove {email} from the manager list?\nThey will no longer be able to sign in as Manager.", my: "{email} ကို မန်နေဂျာ စာရင်းမှ ဖယ်မလား?\nမန်နေဂျာ အဖြစ် ထပ်ဝင်နိုင်တော့မည် မဟုတ်ပါ။" },
});

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
  const t = useT();
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
      // PGRST205: PostgREST can't find the table (not created yet)
      if (error.message.includes("does not exist") || error.code === "42P01" || error.code === "PGRST116" || error.code === "PGRST205") {
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
      setResult({ success: false, message: t("invalidEmail") });
      return;
    }

    setLoading(true);
    setResult(null);

    const { error } = await supabase.from(table).insert({ email: trimmed });

    setLoading(false);

    if (error) {
      if (error.code === "23505") {
        setResult({ success: false, message: t("already", { email: trimmed }) });
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
    if (!(await confirmDialog(deleteConfirm(entry.email), { danger: true, confirmLabel: t("removeAccess") }))) return;
    setDeleting(entry.id);
    const { error, count } = await supabase.from(table).delete({ count: "exact" }).eq("id", entry.id);
    setDeleting(null);
    // Say why instead of doing nothing (RLS refuses by matching no rows).
    if (error || !count) setResult({ success: false, message: error ? error.message : t("notRemoved", { email: entry.email }) });
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
            <p className="text-pale-gold-foreground font-semibold text-sm">{t("setupRequired")}</p>
          </div>
          <p className="text-pale-gold-foreground/80 text-xs mb-3">
            {t("setupHelp")}
          </p>
          <pre className="bg-slate-900 rounded-lg p-3 text-xs text-slate-100 font-mono overflow-x-auto whitespace-pre-wrap mb-3">
            {setupSql}
          </pre>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 text-xs bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-lg px-3 py-1.5 transition-colors"
          >
            <Copy className="w-3 h-3" />
            {copied ? t("copied") : t("copySql")}
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
              {t("emailAddress")}
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
              <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> {t("adding")}</>
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
              aria-label={t("refresh")}
              className="text-slate-400 hover:text-slate-600 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${fetching ? "animate-spin" : ""}`} />
            </button>
          </div>

          {fetching ? (
            <div className="px-6 py-8 text-center text-slate-400 text-sm">{t("loading")}</div>
          ) : entries.length === 0 ? (
            <div className="px-6 py-8 text-center">
              <Mail className="w-8 h-8 text-slate-200 mx-auto mb-2" />
              <p className="text-slate-400 text-sm">{t("noneYet")}</p>
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
                        {t("added", { date: new Date(entry.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) })}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(entry)}
                    disabled={deleting === entry.id}
                    className="shrink-0 text-slate-300 hover:text-red-500 disabled:opacity-40 transition-colors p-1"
                    title={t("removeAccess")}
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

// Owners only: read, add and remove. Nothing reads this list for access yet.
const MANAGER_SETUP_SQL = `-- Run this once in your Supabase SQL Editor:
create table if not exists public.manager_access (
  id uuid primary key default gen_random_uuid(),
  email text unique not null check (email = lower(email)),
  created_at timestamptz not null default now()
);
alter table public.manager_access enable row level security;
revoke all on public.manager_access from anon;
drop policy if exists "owner_manage" on public.manager_access;
create policy "owner_manage" on public.manager_access
  for all to authenticated
  using (public.current_app_role() = 'ceo')
  with check (public.current_app_role() = 'ceo');`;

export default function ManageAccess() {
  const t = useT();
  return (
    <div className="flex-1 overflow-auto bg-slate-50">
      <div className="px-6 py-5 border-b border-slate-100 bg-white">
        <h1 className="text-2xl font-bold text-slate-900">{t("title")}</h1>
        <p className="text-slate-500 text-sm mt-0.5">{t("subtitle")}</p>
      </div>

      <div className="p-6 max-w-xl space-y-10">
        <section>
          <div className="flex items-center gap-2 mb-1">
            <Crown className="w-4 h-4 text-pale-gold-foreground" />
            <h2 className="text-slate-900 font-bold text-sm">{t("owner")}</h2>
          </div>
          <p className="text-slate-500 text-xs mb-4">
            {t("ownerDesc")}
          </p>
          <CeoAccessSection />
        </section>

        <section>
          <div className="flex items-center gap-2 mb-1">
            <Mail className="w-4 h-4 text-pale-blue-foreground" />
            <h2 className="text-slate-900 font-bold text-sm">{t("selling")}</h2>
          </div>
          <p className="text-slate-500 text-xs mb-4">{t("sellingDesc")}</p>
          <EmailAllowlistCard
            table="allowed_employees"
            cardIcon={UserPlus}
            infoTitle={t("sellInfoTitle")}
            infoDescription={t("sellInfoDesc")}
            addSectionTitle={t("sellAddTitle")}
            addButtonLabel={t("sellAddBtn")}
            placeholder="name@company.com"
            listTitle={t("selling")}
            emptyHint={t("sellEmpty")}
            successMessage={email => t("sellOk", { email })}
            deleteConfirm={email => t("sellDel", { email })}
            setupSql={EMPLOYEE_SETUP_SQL}
          />
          <div className="mt-4">
            <StaffLoginsSection />
          </div>
        </section>

        <section>
          <div className="flex items-center gap-2 mb-1">
            <Calculator className="w-4 h-4 text-pale-blue-foreground" />
            <h2 className="text-slate-900 font-bold text-sm">{t("accountant")}</h2>
          </div>
          <p className="text-slate-500 text-xs mb-4">
            {t("accDesc")}
          </p>
          <EmailAllowlistCard
            table="accountant_access"
            cardIcon={Calculator}
            infoTitle={t("accInfoTitle")}
            infoDescription={t("accInfoDesc")}
            addSectionTitle={t("accAddTitle")}
            addButtonLabel={t("accAddBtn")}
            placeholder="accountant@company.com"
            listTitle={t("accountants")}
            emptyHint={t("accEmpty")}
            successMessage={email => t("accOk", { email })}
            deleteConfirm={email => t("accDel", { email })}
            setupSql={ACCOUNTANT_SETUP_SQL}
          />
        </section>

        <section>
          <div className="flex items-center gap-2 mb-1">
            <Briefcase className="w-4 h-4 text-pale-blue-foreground" />
            <h2 className="text-slate-900 font-bold text-sm">{t("manager")}</h2>
          </div>
          <p className="text-slate-500 text-xs mb-4">
            {t("mgrDesc")}
          </p>
          <EmailAllowlistCard
            table="manager_access"
            cardIcon={Briefcase}
            infoTitle={t("mgrInfoTitle")}
            infoDescription={t("mgrInfoDesc")}
            addSectionTitle={t("mgrAddTitle")}
            addButtonLabel={t("mgrAddBtn")}
            placeholder="manager@company.com"
            listTitle={t("managers")}
            emptyHint={t("mgrEmpty")}
            successMessage={email => t("mgrOk", { email })}
            deleteConfirm={email => t("mgrDel", { email })}
            setupSql={MANAGER_SETUP_SQL}
          />
        </section>
      </div>
    </div>
  );
}
