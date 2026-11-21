// Salary Management — reading and writing.
//
// Employees are debt_profiles with relation 'Employee' (that's how STM Daily
// finds them to link cash), each with one employee_salary_pool row (monthly
// base salary) and employee_salary_items. Row-level security limits all of it
// to owners and accountants; a database trigger stops the browser from
// creating or rewriting STM Daily entries (see 20261121090000_salary_management.sql).

import { supabase, DEBT_TABLES, type DebtProfile } from "./debt-supabase";
import type { SalaryItem, SalaryItemStatus, SalaryItemType } from "./salary-math";

export const EMPLOYEE_RELATION = "Employee" as const;
const POOL = "employee_salary_pool";
const ITEMS = "employee_salary_items";

export type Employee = DebtProfile & { base_salary: number };

type Result<T> = { data: T; error: string | null; setupNeeded?: boolean };

/** Columns added by the salary migration are missing → it hasn't been run yet. */
function needsSetup(message: string | undefined): boolean {
  return !!message && /salary_month|column .* does not exist|could not find .*column/i.test(message);
}

export async function loadEmployees(): Promise<Result<Employee[]>> {
  const [profiles, pools] = await Promise.all([
    supabase.from(DEBT_TABLES.PROFILES).select("*").eq("relation", EMPLOYEE_RELATION).order("name"),
    supabase.from(POOL).select("profile_id, base_salary"),
  ]);
  const error = profiles.error?.message ?? pools.error?.message ?? null;
  const base = new Map((pools.data ?? []).map(p => [p.profile_id as string, Number(p.base_salary) || 0]));
  const employees = ((profiles.data ?? []) as DebtProfile[]).map(p => ({ ...p, base_salary: base.get(p.id) ?? 0 }));
  return { data: employees, error };
}

/** Everything that counts in `month`, plus every pending entry (whatever month it's from). */
export async function loadItems(month: string, profileId?: string): Promise<Result<SalaryItem[]>> {
  let q = supabase.from(ITEMS).select("*").or(`salary_month.eq.${month},status.eq.pending`);
  if (profileId) q = q.eq("profile_id", profileId);
  const { data, error } = await q.order("date", { ascending: false });
  return {
    data: ((data ?? []) as SalaryItem[]).map(i => ({ ...i, amount: Number(i.amount) || 0 })),
    error: error?.message ?? null,
    setupNeeded: needsSetup(error?.message),
  };
}

export async function createEmployee(name: string, phone: string, baseSalary: number, today: string): Promise<string | null> {
  const phones = phone.trim() ? [phone.trim()] : [];
  const { data, error } = await supabase
    .from(DEBT_TABLES.PROFILES)
    .insert({ name: name.trim(), relation: EMPLOYEE_RELATION, phone_number: phones[0] ?? null, phone_numbers: phones, date: today, current_balance: 0 })
    .select("id")
    .single();
  if (error || !data) return error?.message ?? "Couldn't add the employee.";
  return setBaseSalary(data.id as string, baseSalary);
}

export async function updateEmployee(id: string, name: string, phone: string, baseSalary: number): Promise<string | null> {
  const phones = phone.trim() ? [phone.trim()] : [];
  const { error } = await supabase
    .from(DEBT_TABLES.PROFILES)
    .update({ name: name.trim(), phone_number: phones[0] ?? null, phone_numbers: phones })
    .eq("id", id)
    .eq("relation", EMPLOYEE_RELATION);
  if (error) return error.message;
  return setBaseSalary(id, baseSalary);
}

async function setBaseSalary(profileId: string, baseSalary: number): Promise<string | null> {
  const { error } = await supabase
    .from(POOL)
    .upsert({ profile_id: profileId, base_salary: Math.max(0, baseSalary), updated_at: new Date().toISOString() }, { onConflict: "profile_id" });
  return error?.message ?? null;
}

/** Deletes the employee; their salary pool and items go with them (ON DELETE CASCADE). */
export async function deleteEmployee(id: string): Promise<string | null> {
  const { error, count } = await supabase
    .from(DEBT_TABLES.PROFILES)
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("relation", EMPLOYEE_RELATION);
  if (error) return error.message;
  return count ? null : "Nothing was deleted — you may not have permission.";
}

export async function addItem(item: {
  profile_id: string; type: SalaryItemType; amount: number; date: string; salary_month: string; label: string | null;
}): Promise<string | null> {
  const { error } = await supabase.from(ITEMS).insert(item);
  return error?.message ?? null;
}

/** Deduct (applied) / dismiss / undo (pending) an STM Daily entry. Applying puts it in `salaryMonth`. */
export async function decideItem(id: string, status: SalaryItemStatus, salaryMonth?: string): Promise<string | null> {
  const patch: Record<string, string> = { status };
  if (salaryMonth) patch.salary_month = salaryMonth;
  const { error, data } = await supabase.from(ITEMS).update(patch).eq("id", id).select("id");
  if (error) return error.message;
  return data?.length ? null : "Nothing was changed — you may not have permission.";
}

export async function deleteItem(id: string): Promise<string | null> {
  const { error, count } = await supabase.from(ITEMS).delete({ count: "exact" }).eq("id", id);
  if (error) return error.message;
  return count ? null : "Nothing was deleted — you may not have permission.";
}
