-- Remove the I/C (home income/expense) feature's tables.
--
-- The I/C page is gone from STM Financial. Nothing else in the database uses
-- these tables (checked: no functions, triggers, views or realtime entries;
-- the only foreign key is home_expenses → home_family_members, both dropped
-- here). Data at the time: home_ic_ledger 0 rows, home_family_members 7,
-- home_expenses 1, home_income_entries 1 — a JSON backup was taken first.
drop table if exists public.home_ic_ledger;
drop table if exists public.home_expenses;
drop table if exists public.home_family_members;
drop table if exists public.home_income_entries;
