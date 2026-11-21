-- Manager role: the list of managers, shown on Staff Access as "Manager".
--
-- Owners (role 'ceo' internally) can read, add and remove entries; nobody
-- else can touch the table. Nothing reads this list for access yet:
-- current_app_role() is unchanged, so a manager gets no permissions until
-- manager permissions are added in a later migration.
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
  with check (public.current_app_role() = 'ceo');
