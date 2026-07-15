---
name: Debt Tracker Architecture
description: How the Debt Tracker is built across STM Financial and STM Daily — tables, score logic, and the daily-to-debt wiring pattern.
---

## Supabase tables required (must be created manually in Supabase SQL editor)
- `debt_profiles`: id, name, relation, phone_number, date, total_debt, current_balance, score, last_payment_at, created_at
- `debt_transactions`: id, profile_id (FK → debt_profiles), amount (negative=payment, positive=new debt), date, note, transaction_number, source ("manual"|"daily_app"), created_at
- RLS: both tables need `USING (true) WITH CHECK (true)` permissive policies

## Score logic (stored in debt_profiles.score, updated client-side on each transaction)
- Start: 50. +5 per payment. +10 if balance hits 0. -5 if >30 days since last payment. -10 if >60 days.
- Daily app submissions give a flat +5 bump (no full recalculation — done for simplicity).
- Full recalculation happens in `calculateScore()` in `debt-supabase.ts` when opening a profile detail.

## STM Daily → Debt Tracker wiring
- `ExpenseItem` has an optional `profileId?: string`.
- ExpensesPanel name field is a live-search combobox querying `debt_profiles` via `.ilike()`.
- On shift submit (handleConfirm), for each expense with a profileId: insert `debt_transaction` (amount = -expense.amount), fetch profile, update `current_balance` and `score (+5)` and `last_payment_at`.
- If Supabase tables don't exist yet, the debt transaction inserts will silently fail — the shift still saves normally.

**Why:** Keeping debt transactions as a side-effect of shift submit (not blocking) means the daily app keeps working even if the debt tables haven't been created in Supabase yet.
