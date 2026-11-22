// P-P / profit settings (one row, changed by owners in Settings).

import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { setPPLiters } from "./units";

export type PPSettings = {
  default_pp_liters: number;
  auto_deduct: boolean;
  managers_see_prices: boolean;
  profit_auto: "off" | "week" | "month";
  profit_report: "off" | "weekly" | "monthly";
  reset_at?: string | null;   // when an owner last deleted all P-P data (shifts before it aren't deducted)
  updated_at: string | null;
  updated_by: string | null;
};

export const PP_DEFAULTS: PPSettings = {
  default_pp_liters: 215, auto_deduct: true, managers_see_prices: true, profit_auto: "off", profit_report: "off",
  updated_at: null, updated_by: null,
};

/** Loads the settings (defaults until loaded, or if the table isn't there yet). */
export function usePPSettings() {
  const [settings, setSettings] = useState<PPSettings>(PP_DEFAULTS);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  const load = useCallback(async () => {
    const { data, error } = await supabase.from("pp_settings").select("*").maybeSingle();
    if (error || !data) { setState("missing"); return; }
    const s = { ...PP_DEFAULTS, ...(data as Partial<PPSettings>), default_pp_liters: Number((data as PPSettings).default_pp_liters) || 215 };
    setPPLiters(s.default_pp_liters);
    setSettings(s);
    setState("ready");
  }, []);
  useEffect(() => { load(); }, [load]);
  return { settings, state, reload: load, setSettings };
}
