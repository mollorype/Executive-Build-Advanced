import { useEffect, useState } from "react";
import type { DebtProfile, DebtTransaction } from "./debt-supabase";

const PROFILES_KEY = "stm_fin_debt_profiles_cache_v1";
const TXN_KEY_PREFIX = "stm_fin_debt_txns_cache_v1_";

function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeCache(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable/full — cached data just won't be there offline; not fatal.
  }
}

export function cacheDebtProfiles(profiles: DebtProfile[]) {
  writeCache(PROFILES_KEY, profiles);
}

export function getCachedDebtProfiles(): DebtProfile[] {
  return readCache<DebtProfile[]>(PROFILES_KEY) ?? [];
}

export function cacheDebtTransactions(profileId: string, transactions: DebtTransaction[]) {
  writeCache(TXN_KEY_PREFIX + profileId, transactions);
}

export function getCachedDebtTransactions(profileId: string): DebtTransaction[] {
  return readCache<DebtTransaction[]>(TXN_KEY_PREFIX + profileId) ?? [];
}

/**
 * Tracks browser connectivity. Calls `onReconnect` once whenever the browser
 * transitions from offline back to online, so callers can silently re-fetch
 * fresh data and replace the cached fallback.
 */
export function useOnlineStatus(onReconnect?: () => void): boolean {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true);
      onReconnect?.();
    }
    function handleOffline() {
      setIsOnline(false);
    }
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [onReconnect]);

  return isOnline;
}
