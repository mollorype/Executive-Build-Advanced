import { useEffect, useState } from "react";
import { submitShift, supabase, ShiftPayload } from "./supabase";

/*
  ══════════════════════════════════════════════════════════════
  OPTIONAL — stronger duplicate protection
  ══════════════════════════════════════════════════════════════
  The client already guards against duplicate submissions (see
  flushQueue() below), but for a belt-and-suspenders server-side
  guarantee, run this once in the Supabase SQL editor:

  ALTER TABLE daily_sales_reports
    ADD COLUMN IF NOT EXISTS client_submission_id text UNIQUE;
  ══════════════════════════════════════════════════════════════
*/

const QUEUE_KEY = "stm_daily_offline_queue";
const RETRY_INTERVAL_MS = 20_000;

export type QueueStatus = "pending" | "syncing" | "synced";

export interface LinkedExpensePayload {
  profileId: string;
  amount: number;
  txnType: "payment" | "debt";
  txnNumber: string;
  localDateTimeStr: string;
  employeeName: string;
}

export interface QueuedShift {
  id: string;
  payload: ShiftPayload;
  linkedExpenses: LinkedExpensePayload[];
  createdAt: number;
  attempts: number;
  lastError?: string;
  status: QueueStatus;
  syncedAt?: number;
}

const SYNCED_RETENTION_MS = 10 * 60_000; // keep "synced" items around briefly so the UI can show a confirmation

// ─── Storage ────────────────────────────────────────────────────────────────
function loadQueue(): QueuedShift[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveQueue(queue: QueuedShift[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

// ─── Pub-sub ────────────────────────────────────────────────────────────────
type Listener = () => void;
const listeners = new Set<Listener>();

function emitChange() {
  listeners.forEach(l => l());
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ─── Queue operations ───────────────────────────────────────────────────────
export function getQueue(): QueuedShift[] {
  return loadQueue();
}

export function enqueueShift(
  payload: Omit<ShiftPayload, "client_submission_id">,
  linkedExpenses: LinkedExpensePayload[]
): QueuedShift {
  const id = crypto.randomUUID();
  const item: QueuedShift = {
    id,
    payload: { ...payload, client_submission_id: id },
    linkedExpenses,
    createdAt: Date.now(),
    attempts: 0,
    status: "pending",
  };
  const queue = loadQueue();
  queue.push(item);
  saveQueue(queue);
  emitChange();
  return item;
}

function updateQueueItem(id: string, patch: Partial<QueuedShift>) {
  const queue = loadQueue();
  const idx = queue.findIndex(q => q.id === id);
  if (idx === -1) return;
  queue[idx] = { ...queue[idx], ...patch };
  saveQueue(queue);
  emitChange();
}

function pruneSynced() {
  const cutoff = Date.now() - SYNCED_RETENTION_MS;
  const queue = loadQueue();
  const kept = queue.filter(q => q.status !== "synced" || (q.syncedAt ?? 0) > cutoff);
  if (kept.length !== queue.length) {
    saveQueue(kept);
    emitChange();
  }
}

/** Status of a specific queued shift, for UI that needs to track one submission. "synced" also covers the case where the item has already been pruned from the queue. */
export function getItemStatus(id: string): QueueStatus {
  const item = loadQueue().find(q => q.id === id);
  return item ? item.status : "synced";
}

// ─── Linked-expense side effects (debt_transactions / debt_profiles) ────────
async function replayLinkedExpenses(linkedExpenses: LinkedExpensePayload[]) {
  for (const expense of linkedExpenses) {
    const paymentAmt = expense.txnType === "debt" ? expense.amount : -expense.amount;

    await supabase.from("debt_transactions").insert({
      profile_id: expense.profileId,
      amount: paymentAmt,
      date: expense.localDateTimeStr,
      note: `Payment via Daily Shift — ${expense.employeeName}`,
      transaction_number: expense.txnNumber,
      source: "daily_app",
    });

    const { data: prof } = await supabase
      .from("debt_profiles")
      .select("current_balance, score")
      .eq("id", expense.profileId)
      .single();

    if (prof) {
      const newBalance = prof.current_balance + paymentAmt;
      const newScore = Math.min(100, (prof.score ?? 50) + 5);
      await supabase.from("debt_profiles").update({
        current_balance: newBalance,
        score: newScore,
        last_payment_at: expense.localDateTimeStr,
      }).eq("id", expense.profileId);
    }
  }
}

// ─── Flush ──────────────────────────────────────────────────────────────────
let flushing = false;

export async function flushQueue(): Promise<void> {
  if (flushing) return; // avoid overlapping flush passes (online event + interval firing together)
  flushing = true;
  try {
    pruneSynced();

    if (typeof navigator !== "undefined" && !navigator.onLine) return;

    // Snapshot pending items — process serially so linked debt_profiles
    // read-modify-write stays correct across items.
    const pending = loadQueue().filter(q => q.status === "pending");

    for (const item of pending) {
      updateQueueItem(item.id, { status: "syncing" });

      const { error } = await submitShift(item.payload);

      if (error) {
        updateQueueItem(item.id, { status: "pending", lastError: error.message, attempts: item.attempts + 1 });
        break; // stop this pass — don't hammer a dead connection for every remaining item
      }

      try {
        await replayLinkedExpenses(item.linkedExpenses);
      } catch {
        // best-effort, same as the original inline implementation — the main
        // report already saved successfully, so don't block on this.
      }

      updateQueueItem(item.id, { status: "synced", syncedAt: Date.now() });
    }
  } finally {
    flushing = false;
  }
}

// ─── React hooks ────────────────────────────────────────────────────────────
const SYNCED_FLASH_MS = 2_500;

function countPending() {
  return getQueue().filter(q => q.status !== "synced").length;
}

export function useOfflineSync() {
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [pendingCount, setPendingCount] = useState(countPending);
  const [justSynced, setJustSynced] = useState(false);

  useEffect(() => {
    let flashTimer: ReturnType<typeof setTimeout> | undefined;
    let prevPending = countPending();

    const refreshPendingCount = () => {
      const next = countPending();
      if (prevPending > 0 && next === 0) {
        setJustSynced(true);
        clearTimeout(flashTimer);
        flashTimer = setTimeout(() => setJustSynced(false), SYNCED_FLASH_MS);
      }
      prevPending = next;
      setPendingCount(next);
    };
    const unsubscribe = subscribe(refreshPendingCount);

    function handleOnline() {
      setIsOnline(true);
      flushQueue();
    }
    function handleOffline() {
      setIsOnline(false);
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    flushQueue();

    const interval = setInterval(() => {
      if (navigator.onLine && getQueue().some(q => q.status !== "synced")) {
        flushQueue();
      }
    }, RETRY_INTERVAL_MS);

    return () => {
      unsubscribe();
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(interval);
      clearTimeout(flashTimer);
    };
  }, []);

  return { isOnline, pendingCount, justSynced };
}

/** Tracks the live status of one specific queued shift (e.g. for the Success screen). */
export function useQueueItemStatus(id: string | null): QueueStatus | null {
  const [status, setStatus] = useState<QueueStatus | null>(id ? getItemStatus(id) : null);

  useEffect(() => {
    if (!id) { setStatus(null); return; }
    setStatus(getItemStatus(id));
    const unsubscribe = subscribe(() => setStatus(getItemStatus(id)));
    return unsubscribe;
  }, [id]);

  return status;
}
