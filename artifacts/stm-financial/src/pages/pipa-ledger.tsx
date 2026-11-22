import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { supabase } from "@/lib/supabase";
import {
  PIPA_PRODUCTS, PIPA_STATIONS_TABLE,
  fmtLiters, fmtMMK, fmtPipas, normalizeMovement, priceBreakdown, purchasePrices, stationBalances, stockByProduct,
  type MovementKind, type PipaMovement, type PipaStation,
} from "@/lib/pipa-ledger";
import MovementDialog from "@/components/pipa/movement-dialog";
import StationDialog from "@/components/pipa/station-dialog";
import CountDialog from "@/components/pipa/count-dialog";
import DeductDialog from "@/components/pipa/deduct-dialog";
import StockCards from "@/components/pipa/stock-cards";
import { useAuth } from "@/lib/auth-context";
import { usePPSettings } from "@/lib/pp-settings";
import { usePipaT, pipaProduct } from "@/lib/pipa-i18n";
import { AlertTriangle, ClipboardCheck, History, Phone, Plus, Receipt, Store, Truck } from "lucide-react";

type Dialog =
  | { type: "movement"; kind?: MovementKind; stationId?: string; official?: boolean }
  | { type: "station"; station: PipaStation | null; reopenMovement?: boolean; reopenOfficial?: boolean }
  | { type: "count" }
  | { type: "deduct" }
  | null;

export default function PipaLedger() {
  const t = usePipaT();
  const { profile } = useAuth();
  const owner = profile?.role === "ceo";
  const [, setLocation] = useLocation();
  const { settings } = usePPSettings();
  const [stations, setStations] = useState<PipaStation[]>([]);
  const [movements, setMovements] = useState<PipaMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notice, setNoticeText] = useState("");
  const noticeTimer = useRef<number | undefined>(undefined);
  // A success message fades after 3 s; an error stays. A newer message always
  // replaces an older one (and cancels its fade, so it can't wipe the new one).
  const setNotice = useCallback((message: string, fade = false) => {
    window.clearTimeout(noticeTimer.current);
    setNoticeText(message);
    if (fade && message) noticeTimer.current = window.setTimeout(() => setNoticeText(""), 3000);
  }, []);
  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  const load = useCallback(async () => {
    const [st, mv] = await Promise.all([
      supabase.from(PIPA_STATIONS_TABLE).select("*").order("name"),
      // Through the database, which leaves out purchase prices if the owner hid them.
      supabase.rpc("pp_movements"),
    ]);
    const err = st.error ?? mv.error;
    if (err) {
      setLoadError(err.code === "PGRST205" || err.code === "42P01" ? t("notInstalled")
        : err.code === "PGRST202" || err.code === "42883" ? t("needsUpdate") : err.message);
      return;
    }
    setLoadError("");
    setStations((st.data ?? []) as PipaStation[]);
    setMovements(((mv.data ?? []) as Record<string, unknown>[]).map(r => normalizeMovement(r)));
  }, [t]);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);

  const stock = useMemo(() => stockByProduct(movements), [movements]);
  const balances = useMemo(() => stationBalances(movements), [movements]);
  const prices = useMemo(() => purchasePrices(movements), [movements]);
  const stationName = useMemo(() => Object.fromEntries(stations.map(s => [s.id, s.name])), [stations]);
  const lastBuy = useMemo(() => {
    const out: Record<string, PipaMovement> = {};
    for (const m of movements) if (m.kind === "buy" && m.station_id && !out[m.station_id]) out[m.station_id] = m; // newest first
    return out;
  }, [movements]);

  function done(message: string) {
    setDialog(null);
    setNotice(message, true);
    load();
  }

  const actionBtn = "flex items-center gap-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold rounded-xl px-3 py-2 text-sm transition-colors";

  return (
    <div className="flex-1 overflow-auto bg-slate-50">
      <div className="px-4 md:px-6 py-5 border-b border-slate-100 bg-white">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{t("title")}</h1>
            <p className="text-slate-400 text-sm mt-0.5">{t("subtitle")}</p>
          </div>
          <button onClick={() => setDialog({ type: "movement" })} disabled={!!loadError}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold rounded-xl px-4 py-2 text-sm transition-colors">
            <Plus className="w-4 h-4" /> {t("record")}
          </button>
        </div>
      </div>

      <div className="p-4 md:p-6 space-y-5">
        {loadError && (
          <div role="alert" className="flex items-start gap-2 bg-pale-red border border-red-200 rounded-xl px-4 py-3 text-sm text-pale-red-foreground">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {loadError}
          </div>
        )}
        {notice && <p className="text-sm font-medium text-pale-green-foreground" role="status">{notice}</p>}

        <div className="flex flex-wrap gap-2">
          <button onClick={() => setDialog({ type: "movement", official: true })} disabled={!!loadError} data-testid="pp-official-btn"
            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold rounded-xl px-3 py-2 text-sm transition-colors">
            <Truck className="w-4 h-4" /> {t("officialBtn")}
          </button>
          <button onClick={() => setDialog({ type: "deduct" })} disabled={!!loadError} className={actionBtn}><Receipt className="w-4 h-4" /> {t("deductBtn")}</button>
          <button onClick={() => setDialog({ type: "count" })} disabled={!!loadError} className={actionBtn}><ClipboardCheck className="w-4 h-4" /> {t("countBtn")}</button>
          <button onClick={() => setDialog({ type: "station", station: null })} disabled={!!loadError} className={actionBtn}><Store className="w-4 h-4" /> {t("addStation")}</button>
          <button onClick={() => setLocation(owner ? "/profit?tab=history" : "/pipa-ledger/history")} className={actionBtn} data-testid="pp-open-history"><History className="w-4 h-4" /> {t("history")}</button>
        </div>
        {settings.auto_deduct && !loadError && <p className="text-[11px] text-slate-500 -mt-3" data-testid="pp-auto-note">{t("autoOn")}</p>}

        {/* Stock on hand — in litres, and in P-P, as two separate sets of cards */}
        <StockCards stock={stock} loading={loading} />

        {/* Stations */}
        <section>
          <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">{t("stations")}</h2>
          {!loading && stations.length === 0 ? (
            <div className="bg-white border border-slate-100 rounded-xl p-6 text-center">
              <Store className="w-8 h-8 text-slate-200 mx-auto mb-2" />
              <p className="text-sm text-slate-500">{t("stationsEmpty")}</p>
              <button onClick={() => setDialog({ type: "station", station: null })} disabled={!!loadError}
                className="mt-3 text-sm font-semibold text-pale-blue-foreground">{t("addAStation")}</button>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 gap-3">
              {stations.map(st => {
                const owing = PIPA_PRODUCTS.flatMap(p => {
                  const o = balances[st.id]?.[p];
                  if (!o) return [];
                  return [
                    ...(o.weOwe > 0 ? [{ p, n: o.weOwe, we: true }] : []),
                    ...(o.theyOwe > 0 ? [{ p, n: o.theyOwe, we: false }] : []),
                  ];
                });
                const lb = lastBuy[st.id];
                const lbPrice = lb?.price_mode && lb.unit_price != null ? priceBreakdown(lb.price_mode, lb.unit_price, lb.pipas, lb.liters_per_pipa) : null;
                return (
                  <div key={st.id} className="bg-white border border-slate-100 rounded-xl p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <button onClick={() => setDialog({ type: "station", station: st })} className="text-left min-w-0">
                        <p className="text-slate-900 font-semibold text-sm truncate">{st.name}</p>
                        {st.note && <p className="text-xs text-slate-400 truncate">{st.note}</p>}
                      </button>
                      {st.phone && (
                        <a href={`tel:${st.phone}`} className="shrink-0 flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900">
                          <Phone className="w-3 h-3" /> {st.phone}
                        </a>
                      )}
                    </div>
                    {owing.length === 0 ? (
                      <p className="text-xs text-slate-400">{t("settled")}</p>
                    ) : (
                      <ul className="space-y-0.5">
                        {owing.map(o => (
                          <li key={`${o.p}-${o.we}`} className={`text-sm font-semibold ${o.we ? "text-pale-red-foreground" : "text-pale-green-foreground"}`}>
                            {o.we ? t("youOwe") : t("theyOwe")} {fmtPipas(o.n)} P-P · {pipaProduct(t, o.p)}
                          </li>
                        ))}
                      </ul>
                    )}
                    {lb && lbPrice && (
                      <p className="text-xs text-slate-500">
                        {t("lastBought", { product: pipaProduct(t, lb.product), perLiter: fmtMMK(lbPrice.perLiter), perPipa: fmtMMK(lbPrice.perPipa), date: lb.occurred_on })}
                      </p>
                    )}
                    <div className="flex gap-2 pt-1">
                      <button onClick={() => setDialog({ type: "movement", kind: "buy", stationId: st.id })}
                        className="text-xs font-semibold text-pale-blue-foreground bg-pale-blue rounded-lg px-2.5 py-1.5">{t("record")}</button>
                      <button onClick={() => setLocation(`/pipa-ledger/history?station=${st.id}`)}
                        className="text-xs font-semibold text-slate-600 bg-slate-100 rounded-lg px-2.5 py-1.5">{t("history")}</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Price comparison (empty when the owner hides prices from this account) */}
        {Object.keys(prices).length > 0 && (
          <section>
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">{t("prices")}</h2>
            <div className="grid md:grid-cols-2 gap-3">
              {PIPA_PRODUCTS.filter(p => prices[p]?.length).map(p => (
                <div key={p} className="bg-white border border-slate-100 rounded-xl p-4">
                  <p className="text-sm font-semibold text-slate-900 mb-2">{pipaProduct(t, p)}</p>
                  <ul className="space-y-1.5">
                    {prices[p]!.map((row, i) => (
                      <li key={row.stationId} className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="min-w-0 truncate text-slate-700">
                          {stationName[row.stationId] ?? "—"}
                          {i === 0 && prices[p]!.length > 1 && <span className="ml-1.5 text-[10px] font-bold text-pale-green-foreground bg-emerald-500/15 rounded px-1.5 py-0.5">{t("cheapest")}</span>}
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="font-semibold text-slate-900 tabular-nums">{fmtMMK(row.lastPerLiter)}</span>
                          <span className="block text-[11px] text-slate-400">{t("lastAvg", { date: row.lastOn, avg: fmtMMK(row.avgPerLiter) })}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        )}

      </div>

      {dialog?.type === "movement" && (
        <MovementDialog
          stations={stations}
          balances={balances}
          initialKind={dialog.kind}
          initialStationId={dialog.stationId}
          official={dialog.official}
          onAddStation={() => setDialog({ type: "station", station: null, reopenMovement: true, reopenOfficial: !!dialog.official })}
          onClose={() => setDialog(null)}
          onSaved={() => done(t("saved"))}
        />
      )}
      {dialog?.type === "station" && (
        <StationDialog
          station={dialog.station}
          onClose={() => setDialog(dialog.reopenMovement ? { type: "movement", official: dialog.reopenOfficial } : null)}
          onSaved={() => {
            if (dialog.reopenMovement) { load(); setDialog({ type: "movement", official: dialog.reopenOfficial }); }
            else done(dialog.station ? t("stationSaved") : t("stationAdded"));
          }}
        />
      )}
      {dialog?.type === "count" && <CountDialog stock={stock} onClose={() => setDialog(null)} onSaved={() => done(t("countSaved"))} />}
      {dialog?.type === "deduct" && <DeductDialog owner={owner} autoOn={settings.auto_deduct} unit="pp" onClose={() => setDialog(null)} onSaved={done} />}
    </div>
  );
}
