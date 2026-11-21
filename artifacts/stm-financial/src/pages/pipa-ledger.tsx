import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  PIPA_MOVEMENTS_TABLE, PIPA_PRODUCTS, PIPA_STATIONS_TABLE,
  fmtLiters, fmtMMK, fmtPipas, normalizeMovement, priceBreakdown, purchasePrices, stationBalances, stockByProduct, stockDelta,
  type MovementKind, type PipaMovement, type PipaStation,
} from "@/lib/pipa-ledger";
import MovementDialog from "@/components/pipa/movement-dialog";
import StationDialog from "@/components/pipa/station-dialog";
import CountDialog from "@/components/pipa/count-dialog";
import DeductShiftsDialog from "@/components/pipa/deduct-shifts-dialog";
import { usePipaT, pipaProduct, type PipaT } from "@/lib/pipa-i18n";
import { confirmDialog } from "@/components/confirm-dialog";
import { AlertTriangle, ClipboardCheck, Cylinder, Loader2, Phone, Plus, Receipt, Store, Trash2, X } from "lucide-react";

type Dialog =
  | { type: "movement"; kind?: MovementKind; stationId?: string }
  | { type: "station"; station: PipaStation | null; reopenMovement?: boolean }
  | { type: "count" }
  | { type: "deduct" }
  | null;

/** History line for one movement. */
function describe(m: PipaMovement, station: string, t: PipaT): { title: string; detail: string } {
  const qty = `${fmtPipas(Math.abs(m.pipas))} P-P · ${pipaProduct(t, m.product)}`;
  const price = m.price_mode && m.unit_price != null
    ? (() => {
        const b = priceBreakdown(m.price_mode, m.unit_price, m.pipas, m.liters_per_pipa);
        return t("h_price", { perPipa: fmtMMK(b.perPipa), perLiter: fmtMMK(b.perLiter), total: fmtMMK(b.total) });
      })()
    : "";
  const withPrice = (d: string) => (price ? `${d} · ${price}` : d);
  switch (m.kind) {
    case "buy":             return { title: t("h_buy", { qty }), detail: withPrice(t("h_buy_d", { station })) };
    case "borrow":          return { title: t("h_borrow", { qty }), detail: t("h_borrow_d", { station }) };
    case "borrow_returned": return { title: t("h_borrow_returned", { qty }), detail: t("h_borrow_returned_d", { station }) };
    case "borrow_paid":     return { title: t("h_borrow_paid", { qty }), detail: withPrice(t("h_borrow_paid_d", { station })) };
    case "lend":            return { title: t("h_lend", { qty }), detail: t("h_lend_d", { station }) };
    case "lend_returned":   return { title: t("h_lend_returned", { qty }), detail: t("h_lend_returned_d", { station }) };
    case "lend_paid":       return { title: t("h_lend_paid", { station, qty }), detail: withPrice(t("h_lend_paid_d")) };
    case "used":            return { title: t("h_used", { qty }), detail: "" };
    case "adjust":          return { title: t("h_adjust", { qty: `${m.pipas > 0 ? "+" : "−"}${qty}` }), detail: "" };
  }
}

export default function PipaLedger() {
  const t = usePipaT();
  const [stations, setStations] = useState<PipaStation[]>([]);
  const [movements, setMovements] = useState<PipaMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [historyStation, setHistoryStation] = useState("");
  const [notice, setNotice] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [st, mv] = await Promise.all([
      supabase.from(PIPA_STATIONS_TABLE).select("*").order("name"),
      supabase.from(PIPA_MOVEMENTS_TABLE).select("*")
        .order("occurred_on", { ascending: false }).order("created_at", { ascending: false }),
    ]);
    const err = st.error ?? mv.error;
    if (err) {
      setLoadError(err.code === "PGRST205" || err.code === "42P01"
        ? t("notInstalled")
        : err.message);
      return;
    }
    setLoadError("");
    setStations((st.data ?? []) as PipaStation[]);
    setMovements((mv.data ?? []).map(r => normalizeMovement(r as Record<string, unknown>)));
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
  const history = historyStation ? movements.filter(m => m.station_id === historyStation) : movements;

  function done(message: string) {
    setDialog(null);
    setNotice(message);
    load();
    setTimeout(() => setNotice(""), 3000);
  }

  async function remove(m: PipaMovement) {
    const isShiftBatch = !!m.shift_batch_id;
    const msg = isShiftBatch
      ? t("confirmUndoShift")
      : t("confirmDelete", { title: describe(m, stationName[m.station_id ?? ""] ?? "", t).title }) + (m.po_id ? t("poKept") : "");
    if (!(await confirmDialog(msg, { danger: true, confirmLabel: isShiftBatch ? t("undoShift") : undefined }))) return;
    setDeletingId(m.id);
    const { error, count } = isShiftBatch
      ? await supabase.rpc("undo_pipa_shift_usage", { p_batch: m.shift_batch_id }).then(r => ({ error: r.error, count: 1 }))
      : await supabase.from(PIPA_MOVEMENTS_TABLE).delete({ count: "exact" }).eq("id", m.id);
    setDeletingId(null);
    if (error) { setNotice(t("deleteFailed", { msg: error.message })); return; }
    if (!count) { setNotice(t("notDeleted")); load(); return; }   // RLS refuses by matching nothing
    done(isShiftBatch ? t("shiftUndone") : t("recordDeleted"));
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
        {notice && <p className="text-sm font-medium text-pale-green-foreground">{notice}</p>}

        <div className="flex flex-wrap gap-2">
          <button onClick={() => setDialog({ type: "deduct" })} disabled={!!loadError} className={actionBtn}><Receipt className="w-4 h-4" /> {t("deductBtn")}</button>
          <button onClick={() => setDialog({ type: "count" })} disabled={!!loadError} className={actionBtn}><ClipboardCheck className="w-4 h-4" /> {t("countBtn")}</button>
          <button onClick={() => setDialog({ type: "station", station: null })} disabled={!!loadError} className={actionBtn}><Store className="w-4 h-4" /> {t("addStation")}</button>
        </div>

        {/* Stock on hand */}
        <section>
          <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">{t("stockOnHand")}</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {PIPA_PRODUCTS.map(p => {
              const s = stock[p];
              const negative = s.pipas < 0;
              return (
                <div key={p} className={`bg-white border rounded-xl p-4 ${negative ? "border-red-200" : "border-slate-100"}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <Cylinder className="w-4 h-4 text-slate-400" />
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{pipaProduct(t, p)}</span>
                  </div>
                  {loading ? <Loader2 className="w-5 h-5 text-slate-300 animate-spin" /> : (
                    <>
                      <p className={`text-2xl font-bold tabular-nums ${negative ? "text-pale-red-foreground" : "text-slate-900"}`}>
                        {fmtPipas(s.pipas)} <span className="text-sm font-semibold text-slate-400">P-P</span>
                      </p>
                      <p className="text-xs text-slate-500 tabular-nums">{fmtLiters(s.liters)}</p>
                      {negative && <p className="text-[11px] text-pale-red-foreground mt-1">{t("belowZero")}</p>}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </section>

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
                      <button onClick={() => setHistoryStation(st.id)}
                        className="text-xs font-semibold text-slate-600 bg-slate-100 rounded-lg px-2.5 py-1.5">{t("history")}</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Price comparison */}
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

        {/* History */}
        <section>
          <div className="flex items-center justify-between gap-2 mb-2">
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest">{t("history")}</h2>
            {historyStation && (
              <button onClick={() => setHistoryStation("")}
                className="flex items-center gap-1 text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg px-2 py-1">
                {stationName[historyStation]} <X className="w-3 h-3" />
              </button>
            )}
          </div>
          {loading ? (
            <div className="py-8 text-center"><Loader2 className="w-6 h-6 text-blue-500/50 animate-spin mx-auto" /></div>
          ) : history.length === 0 ? (
            <p className="bg-white border border-slate-100 rounded-xl p-6 text-center text-sm text-slate-500">{t("noMovements")}</p>
          ) : (
            <ul className="bg-white border border-slate-100 rounded-xl divide-y divide-slate-100">
              {history.map(m => {
                const d = describe(m, stationName[m.station_id ?? ""] ?? "—", t);
                const delta = stockDelta(m);
                return (
                  <li key={m.id} className="flex items-start gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-900">{d.title}</p>
                      {d.detail && <p className="text-xs text-slate-600 break-words">{d.detail}</p>}
                      <p className="text-xs text-slate-400 mt-0.5 break-words">
                        {m.occurred_on}{m.note ? ` · ${m.note}` : ""}{m.po_id ? t("inPO") : ""}
                      </p>
                    </div>
                    <span className={`shrink-0 text-sm font-bold tabular-nums ${delta > 0 ? "text-pale-green-foreground" : delta < 0 ? "text-pale-red-foreground" : "text-slate-400"}`}
                      title={t("stockEffect")}>
                      {delta > 0 ? "+" : delta < 0 ? "−" : "±"}{fmtPipas(Math.abs(delta))}
                    </span>
                    <button onClick={() => remove(m)} disabled={deletingId === m.id}
                      aria-label={m.shift_batch_id ? t("undoShift") : t("deleteRecord")}
                      className="shrink-0 p-2 -m-1 text-slate-400 hover:text-pale-red-foreground hover:bg-pale-red rounded-lg transition-colors">
                      {deletingId === m.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="text-[11px] text-slate-400 mt-2">
            {t("cashNote")}
          </p>
        </section>
      </div>

      {dialog?.type === "movement" && (
        <MovementDialog
          stations={stations}
          balances={balances}
          initialKind={dialog.kind}
          initialStationId={dialog.stationId}
          onAddStation={() => setDialog({ type: "station", station: null, reopenMovement: true })}
          onClose={() => setDialog(null)}
          onSaved={() => done(t("saved"))}
        />
      )}
      {dialog?.type === "station" && (
        <StationDialog
          station={dialog.station}
          onClose={() => setDialog(dialog.reopenMovement ? { type: "movement" } : null)}
          onSaved={() => {
            if (dialog.reopenMovement) { load(); setDialog({ type: "movement" }); }
            else done(dialog.station ? t("stationSaved") : t("stationAdded"));
          }}
        />
      )}
      {dialog?.type === "count" && <CountDialog stock={stock} onClose={() => setDialog(null)} onSaved={() => done(t("countSaved"))} />}
      {dialog?.type === "deduct" && <DeductShiftsDialog onClose={() => setDialog(null)} onSaved={() => done(t("deducted"))} />}
    </div>
  );
}
