import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { supabase } from "@/lib/supabase";
import {
  PIPA_STATIONS_TABLE,
  fmtLiters, fmtMMK, fmtPipas, normalizeMovement, priceBreakdown, round3, stockDelta,
  type PipaMovement, type PipaProduct, type PipaStation,
} from "@/lib/pipa-ledger";
import { useAuth } from "@/lib/auth-context";
import { usePipaT, pipaProduct, type PipaT } from "@/lib/pipa-i18n";
import { reasonDialog } from "@/components/confirm-dialog";
import { AlertTriangle, ArrowLeft, Loader2, Trash2, Undo2, X } from "lucide-react";

/** A history row: one P-P line, or one shift's "sold" lines together. */
type Item =
  | { type: "line"; m: PipaMovement }
  | { type: "shift"; key: string; shiftId: string | null; name: string; on: string; lines: PipaMovement[]; by: string | null };

/** History line for one movement. */
function describe(m: PipaMovement, station: string, t: PipaT): { title: string; detail: string } {
  const qty = `${fmtPipas(Math.abs(m.pipas))} P-P · ${pipaProduct(t, m.product)}`;
  const price = m.price_mode && m.unit_price != null
    ? (() => {
        const b = priceBreakdown(m.price_mode, m.unit_price, m.pipas, m.liters_per_pipa);
        return t("h_price", { perPipa: fmtMMK(b.perPipa), perLiter: fmtMMK(b.perLiter), total: fmtMMK(m.total_amount ?? b.total) });
      })()
    : "";
  const withPrice = (d: string) => (price ? `${d} · ${price}` : d);
  switch (m.kind) {
    case "buy": {
      if (m.source === "official") {
        const fees = (m.transport_fee ?? 0) + (m.other_fee ?? 0);
        const extra = m.unit_price != null ? ` · ${t("h_fees", { fees: fmtMMK(fees), cost: fmtMMK(m.unit_price + fees) })}` : "";
        return { title: t("h_official", { qty: m.exact_liters ? `${fmtLiters(m.exact_liters)} · ${pipaProduct(t, m.product)}` : qty }), detail: withPrice(t("h_buy_d", { station })) + extra };
      }
      return { title: t("h_buy", { qty }), detail: withPrice(t("h_buy_d", { station })) };
    }
    case "borrow":          return { title: t("h_borrow", { qty }), detail: t("h_borrow_d", { station }) };
    case "borrow_returned": return { title: t("h_borrow_returned", { qty }), detail: t("h_borrow_returned_d", { station }) };
    case "borrow_paid":     return { title: t("h_borrow_paid", { qty }), detail: withPrice(t("h_borrow_paid_d", { station })) };
    case "lend":            return { title: t("h_lend", { qty }), detail: t("h_lend_d", { station }) };
    case "lend_returned":   return { title: t("h_lend_returned", { qty }), detail: t("h_lend_returned_d", { station }) };
    case "lend_paid":       return { title: t("h_lend_paid", { station, qty }), detail: withPrice(t("h_lend_paid_d")) };
    case "used":            return { title: t("h_used", { qty }), detail: "" };
    case "adjust":
      return m.pipas > 0 && m.unit_price != null
        ? { title: t("h_opening", { qty: `+${qty}` }), detail: price }
        : { title: t("h_adjust", { qty: `${m.pipas > 0 ? "+" : "−"}${qty}` }), detail: "" };
  }
}

/** Shift "sold" lines carry the employee's name in their note: "Shift sales: 300 L · Ma Hla". */
const shiftName = (m: PipaMovement) => /·\s*(.+)$/.exec(m.note ?? "")?.[1]?.trim() || "—";

/** Every P-P line, newest first, with delete / undo (a reason is always asked). */
export default function PipaHistory() {
  const t = usePipaT();
  const { profile } = useAuth();
  const owner = profile?.role === "ceo";
  const [, setLocation] = useLocation();
  const search = useSearch();
  const stationFilter = new URLSearchParams(search).get("station") ?? "";
  const [stations, setStations] = useState<PipaStation[]>([]);
  const [movements, setMovements] = useState<PipaMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [notice, setNoticeText] = useState("");
  const noticeTimer = useRef<number | undefined>(undefined);
  // A success message fades after 3 s; an error stays. A newer one replaces an older one.
  const setNotice = useCallback((message: string, fade = false) => {
    window.clearTimeout(noticeTimer.current);
    setNoticeText(message);
    if (fade && message) noticeTimer.current = window.setTimeout(() => setNoticeText(""), 3000);
  }, []);
  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  const load = useCallback(async () => {
    const [st, mv] = await Promise.all([
      supabase.from(PIPA_STATIONS_TABLE).select("*").order("name"),
      supabase.rpc("pp_movements"),   // prices left out if the owner hid them
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

  const stationName = useMemo(() => Object.fromEntries(stations.map(s => [s.id, s.name])), [stations]);

  // One row per P-P line; a shift's "sold" lines (one per fuel) share a row.
  const history = useMemo(() => {
    const list = stationFilter ? movements.filter(m => m.station_id === stationFilter) : movements;
    const items: Item[] = [];
    const shifts = new Map<string, Extract<Item, { type: "shift" }>>();
    for (const m of list) {
      if (!m.shift_batch_id) { items.push({ type: "line", m }); continue; }
      let row = shifts.get(m.shift_batch_id);
      if (!row) {
        row = { type: "shift", key: m.shift_batch_id, shiftId: m.shift_id ?? null, name: shiftName(m), on: m.occurred_on, lines: [], by: m.created_by ?? null };
        shifts.set(m.shift_batch_id, row);
        items.push(row);
      }
      row.lines.push(m);
    }
    return items;
  }, [movements, stationFilter]);

  async function remove(item: Item) {
    const isShift = item.type === "shift";
    const title = isShift
      ? `${t("h_shift", { name: item.name })} · ${item.on}`
      : describe(item.m, stationName[item.m.station_id ?? ""] ?? "", t).title;
    const reason = await reasonDialog(
      (isShift ? t("reasonUndoShift", { title }) : t("reasonDelete", { title })) + (owner ? "" : t("ownerTold")),
      { danger: true, confirmLabel: isShift ? t("undoShift") : undefined, placeholder: t("reasonPh") },
    );
    if (!reason) return;
    const id = isShift ? item.key : item.m.id;
    setDeletingId(id);
    const { error } = isShift
      ? await supabase.rpc("undo_shift_deduction", { p_shift_id: item.shiftId, p_reason: reason })
      : await supabase.rpc("archive_pp_movement", { p_id: item.m.id, p_reason: reason });
    setDeletingId(null);
    if (error) { setNotice(t("deleteFailed", { msg: error.message })); load(); return; }
    setNotice(isShift ? t("shiftUndone") : t("archived"), true);
    load();
  }

  const by = (who: string | null | undefined) => (owner && who && who !== "auto" ? t("by", { who }) : "");

  return (
    <div className="flex-1 overflow-auto bg-slate-50">
      <div className="px-4 md:px-6 py-5 border-b border-slate-100 bg-white">
        <button onClick={() => setLocation("/pipa-ledger")} className="flex items-center gap-1 text-xs font-semibold text-pale-blue-foreground mb-2">
          <ArrowLeft className="w-3.5 h-3.5" /> {t("title")}
        </button>
        <h1 className="text-2xl font-bold text-slate-900">{t("historyTitle")}</h1>
        <p className="text-slate-400 text-sm mt-0.5">{t("historySub")}</p>
      </div>

      <div className="p-4 md:p-6 space-y-4">
        {loadError && (
          <div role="alert" className="flex items-start gap-2 bg-pale-red border border-red-200 rounded-xl px-4 py-3 text-sm text-pale-red-foreground">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {loadError}
          </div>
        )}
        {notice && <p className="text-sm font-medium text-pale-green-foreground" role="status">{notice}</p>}

        {stations.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" role="group" aria-label={t("stations")}>
            <button onClick={() => setLocation("/pipa-ledger/history")}
              className={`shrink-0 text-xs font-semibold rounded-lg px-2.5 py-1.5 border ${!stationFilter ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-200"}`}>
              {t("allLines")}
            </button>
            {stations.map(s => (
              <button key={s.id} onClick={() => setLocation(`/pipa-ledger/history?station=${s.id}`)}
                className={`shrink-0 inline-flex items-center gap-1 text-xs font-semibold rounded-lg px-2.5 py-1.5 border ${stationFilter === s.id ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-200"}`}>
                {s.name}{stationFilter === s.id && <X className="w-3 h-3" />}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="py-8 text-center"><Loader2 className="w-6 h-6 text-blue-500/50 animate-spin mx-auto" /></div>
        ) : history.length === 0 ? (
          <p className="bg-white border border-slate-100 rounded-xl p-6 text-center text-sm text-slate-500">{t("noMovements")}</p>
        ) : (
          <ul className="bg-white border border-slate-100 rounded-xl divide-y divide-slate-100" data-testid="pp-history">
            {history.map(item => {
              if (item.type === "shift") {
                const out = round3(item.lines.reduce((s, m) => s + Math.abs(stockDelta(m)), 0));
                return (
                  <li key={item.key} className="flex items-start gap-3 px-4 py-3" data-testid="pp-shift-row">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-900">{t("h_shift", { name: item.name })}</p>
                      <p className="text-xs text-slate-600 break-words">
                        {item.lines.map(m => `${pipaProduct(t, m.product as PipaProduct)} ${fmtPipas(m.pipas)} P-P (${fmtLiters(m.exact_liters ?? m.pipas * m.liters_per_pipa)})`).join(" · ")}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">{item.on}{by(item.by)}</p>
                    </div>
                    <span className="shrink-0 text-sm font-bold tabular-nums text-pale-red-foreground" title={t("stockEffect")}>−{fmtPipas(out)}</span>
                    <button onClick={() => remove(item)} disabled={deletingId === item.key || !item.shiftId} aria-label={t("undoShift")}
                      className="shrink-0 p-2 -m-1 text-slate-400 hover:text-pale-red-foreground hover:bg-pale-red rounded-lg transition-colors">
                      {deletingId === item.key ? <Loader2 className="w-4 h-4 animate-spin" /> : <Undo2 className="w-4 h-4" />}
                    </button>
                  </li>
                );
              }
              const m = item.m;
              const d = describe(m, stationName[m.station_id ?? ""] ?? "—", t);
              const delta = stockDelta(m);
              return (
                <li key={m.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900">{d.title}</p>
                    {d.detail && <p className="text-xs text-slate-600 break-words">{d.detail}</p>}
                    <p className="text-xs text-slate-400 mt-0.5 break-words">
                      {m.occurred_on}{m.note && m.kind !== "adjust" ? ` · ${m.note}` : ""}{by(m.created_by)}
                    </p>
                  </div>
                  <span className={`shrink-0 text-sm font-bold tabular-nums ${delta > 0 ? "text-pale-green-foreground" : delta < 0 ? "text-pale-red-foreground" : "text-slate-400"}`}
                    title={t("stockEffect")}>
                    {delta > 0 ? "+" : delta < 0 ? "−" : "±"}{fmtPipas(Math.abs(delta))}
                  </span>
                  <button onClick={() => remove(item)} disabled={deletingId === m.id} aria-label={t("deleteRecord")}
                    className="shrink-0 p-2 -m-1 text-slate-400 hover:text-pale-red-foreground hover:bg-pale-red rounded-lg transition-colors">
                    {deletingId === m.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-[11px] text-slate-400">{t("cashNote")}</p>
      </div>
    </div>
  );
}
