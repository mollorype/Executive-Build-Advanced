import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, Pencil, Plus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { fmtMMK, fmtPipas, type PipaProduct, type PriceMode, type ProductStock } from "@/lib/pipa-ledger";
import { loadPools, OPEN, type PoolLot, type PoolSummary, type PoolsData } from "@/lib/pools";
import { ppLiters, vol } from "@/lib/units";
import { usePipaT, pipaProduct, type PipaT } from "@/lib/pipa-i18n";
import PipaModal, { ErrorNote, fieldCls, labelCls } from "./modal";

// Tap a stock card: one card per purchase — a Big PO or P-P bought from a
// station, named with its date — never mixed with another. Oldest first: shift
// sales come off the oldest ("Selling now") at its price. Owners see and add
// prices; owners and managers can force close one purchase (shortage / spill).

const DOT: Record<string, string> = {
  official: "bg-emerald-500", shop: "bg-yellow-400", borrow: "bg-orange-500",
  count_gain: "bg-green-300", opening: "bg-green-300", lend_return: "bg-sky-400",
};
/** "22 Nov" */
export const fmtDate = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });

/** "Big PO", a station's name, or what kind of stock it is. */
export function lotName(t: PipaT, l: Pick<PoolLot, "source" | "station">): string {
  switch (l.source) {
    case "official": return t("src_official");
    case "shop": return l.station ?? t("src_shop");
    case "borrow": return `${t("src_borrow")}${l.station ? ` · ${l.station}` : ""}`;
    case "lend_return": return `${t("src_lend_return")}${l.station ? ` · ${l.station}` : ""}`;
    default: return t("src_count");
  }
}

/** What the owner is pricing. */
export type PriceTarget = {
  movementId: string;
  kind: "buy" | "sell" | "borrow_paid" | "lend_paid" | "adjust";
  official: boolean;
  product: PipaProduct;
  title: string;
  liters: number;
  pipas: number;
  price?: number | null;
  mode?: PriceMode | null;
  fees?: number | null;
};

/** Owners: add (or change) a line's price. Purchases are costed again; sales get their money. */
export function PriceDialog({ target, onClose, onDone }: { target: PriceTarget; onClose: () => void; onDone: () => void }) {
  const t = usePipaT();
  const perLiterOnly = target.official || target.kind === "adjust";
  const [mode, setMode] = useState<PriceMode>(perLiterOnly ? "per_liter" : target.mode ?? "per_pipa");
  const [p, setP] = useState(target.price != null ? String(target.price) : "");
  const [tr, setTr] = useState(target.fees ? String(target.fees) : "");
  const [ot, setOt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const nP = parseFloat(p), nT = parseFloat(tr) || 0, nO = parseFloat(ot) || 0;
  const total = isNaN(nP) ? null : mode === "per_liter" ? nP * target.liters : nP * target.pipas;
  async function save() {
    if (isNaN(nP) || nP < 0) return setError(t("priceErr"));
    setBusy(true); setError("");
    const { error: err } = await supabase.rpc("pp_set_price", {
      p_movement: target.movementId, p_mode: mode, p_price: nP,
      p_transport: target.official ? nT : 0, p_other: target.official ? nO : 0,
    });
    setBusy(false);
    if (err) return setError(err.code === "PGRST202" || err.code === "42883" ? t("needsUpdate") : err.message);
    onDone();
  }
  const chip = (on: boolean) => `px-3 py-2 rounded-xl text-sm font-semibold border ${on ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-700 border-slate-200"}`;
  return (
    <PipaModal title={t("priceTitle", { what: target.title, fuel: pipaProduct(t, target.product) })} onClose={onClose}>
      <p className="text-sm text-slate-600">{vol(target.liters, "pp")} · {vol(target.liters, "l")}. {t("priceHelp")}</p>
      {!perLiterOnly && (
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setMode("per_pipa")} className={chip(mode === "per_pipa")} aria-pressed={mode === "per_pipa"}>{t("pricePerPP")}</button>
          <button type="button" onClick={() => setMode("per_liter")} className={chip(mode === "per_liter")} aria-pressed={mode === "per_liter"}>{t("pricePerL")}</button>
        </div>
      )}
      <div>
        <label htmlFor="pr-price" className={labelCls}>{mode === "per_pipa" ? t("mmkPerPP") : t("mmkPerL")} *</label>
        <input id="pr-price" type="number" inputMode="decimal" min="0" step="any" value={p} onChange={e => setP(e.target.value)}
          className={`${fieldCls} text-lg font-bold`} placeholder="0" />
      </div>
      {target.official && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="pr-transport" className={labelCls}>{t("transportFee")}</label>
            <input id="pr-transport" type="number" inputMode="decimal" min="0" step="any" value={tr} onChange={e => setTr(e.target.value)} className={fieldCls} placeholder="0" />
          </div>
          <div>
            <label htmlFor="pr-other" className={labelCls}>{t("otherFee")}</label>
            <input id="pr-other" type="number" inputMode="decimal" min="0" step="any" value={ot} onChange={e => setOt(e.target.value)} className={fieldCls} placeholder="0" />
          </div>
        </div>
      )}
      {total != null && (
        <p className="text-xs text-slate-600 leading-relaxed" data-testid="price-sum">
          {target.official && <>{t("costPerL", { v: fmtMMK(nP + nT + nO) })}<br /></>}
          {t("totalFor")}<span className="font-bold text-slate-900">{fmtMMK(total)}</span>{t("forLiters", { liters: vol(target.liters, "l") })}
        </p>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
      <button type="button" onClick={save} disabled={busy} data-testid="price-save"
        className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold rounded-xl py-3 text-sm">
        {busy && <Loader2 className="w-4 h-4 animate-spin" />} {t("save")}
      </button>
    </PipaModal>
  );
}

/** Force close one purchase: what's left in it is written off (shortage / spill / other). */
export function ClosePoolDialog({ pool, onClose, onDone }: { pool: PoolSummary; onClose: () => void; onDone: () => void }) {
  const t = usePipaT();
  const [reason, setReason] = useState<"shortage" | "spill" | "other">("shortage");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function go() {
    if (reason === "other" && !note.trim()) return setError(t("closeNoteErr"));
    setBusy(true); setError("");
    const { error: err } = await supabase.rpc("pp_close_pool", { p_pool: pool.id, p_reason: reason, p_note: note.trim() || null });
    setBusy(false);
    if (err) return setError(err.code === "PGRST202" || err.code === "42883" ? t("needsUpdate") : err.message);
    onDone();
  }
  const chip = (on: boolean) => `px-3 py-2 rounded-xl text-sm font-semibold border ${on ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700 border-slate-200"}`;
  const first = pool.lots[0];
  return (
    <PipaModal title={t("closeTitle", { what: first ? `${lotName(t, first)} · ${fmtDate(first.on)}` : fmtDate(pool.started_on), fuel: pipaProduct(t, pool.product) })} onClose={onClose}>
      <p className="text-sm text-slate-700" data-testid="pp-close-left">
        {pool.left > OPEN ? t("closeLeft", { v: vol(pool.left, "pp") }) : t("closeEmpty")}
      </p>
      <div>
        <span className={labelCls}>{t("closeWhy")}</span>
        <div className="grid grid-cols-3 gap-2" role="group">
          {(["shortage", "spill", "other"] as const).map(r => (
            <button key={r} type="button" onClick={() => { setReason(r); setError(""); }} className={chip(reason === r)} aria-pressed={reason === r}>{t(`r_${r}`)}</button>
          ))}
        </div>
      </div>
      <div>
        <label htmlFor="pool-note" className={labelCls}>{t("note")}</label>
        <input id="pool-note" value={note} onChange={e => setNote(e.target.value)} maxLength={500} className={fieldCls} placeholder={t("closeNotePh")} />
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      <button type="button" onClick={go} disabled={busy} data-testid="pp-close-confirm"
        className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold rounded-xl py-3 text-sm">
        {busy && <Loader2 className="w-4 h-4 animate-spin" />} {t("closeConfirm")}
      </button>
    </PipaModal>
  );
}

/** How full a purchase still is: a level bar, green → amber → red. */
function Level({ left, total }: { left: number; total: number }) {
  const pct = total > 0 ? Math.max(0, Math.min(100, (left / total) * 100)) : 0;
  const fill = pct >= 50 ? "bg-emerald-500" : pct >= 20 ? "bg-amber-400" : "bg-red-500";
  return (
    <div className="flex items-center gap-2" data-testid="pp-level">
      <div className="flex-1 h-3 rounded-full bg-slate-100 border border-slate-200 overflow-hidden">
        <div className={`h-full rounded-full ${fill}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-10 text-right text-xs font-bold tabular-nums text-slate-700">{pct > 0 && pct < 1 ? "<1" : Math.round(pct)}%</span>
    </div>
  );
}

// Purchases an owner can price (borrowed / returned P-P are costed by the system).
const PRICEABLE = new Set(["official", "shop", "count_gain", "opening"]);

/** One fuel's stock: one card per purchase, oldest first. */
export default function FuelStockSheet({ product, stock, owner, canClose, onClose, onChanged }: {
  product: PipaProduct;
  /** Stock on hand from the ledger — the same figures as the card. */
  stock: ProductStock;
  owner: boolean;
  canClose: boolean;
  onClose: () => void;
  onChanged?: (message: string) => void;
}) {
  const t = usePipaT();
  const [data, setData] = useState<PoolsData | null>(null);
  const [error, setError] = useState("");
  const [closing, setClosing] = useState<PoolSummary | null>(null);
  const [pricing, setPricing] = useState<PriceTarget | null>(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const r = await loadPools();
    if (r.error) { setError(r.code === "PGRST202" || r.code === "42883" ? t("needsUpdate") : r.error); return; }
    setError(""); setData(r.data);
  }, [t]);
  useEffect(() => { load(); }, [load]);

  // Each purchase on its own, oldest first (the order sales take them). Shown while
  // it still holds fuel — and, for owners, while it waits for its price.
  const rows = useMemo(() => (data?.pools ?? [])
    .filter(p => p.product === product)
    .flatMap(p => p.lots.map(lot => ({ pool: p, lot })))
    .filter(({ pool, lot }) => (!pool.closed_at && lot.remaining > OPEN) || (owner && PRICEABLE.has(lot.source) && !lot.priced))
    .sort((a, b) => a.lot.on.localeCompare(b.lot.on) || a.lot.at.localeCompare(b.lot.at)), [data, product, owner]);
  const selling = rows.find(r => !r.pool.closed_at && r.lot.remaining > OPEN);
  const short = data?.short[product] ?? 0;

  const priceTarget = (l: PoolLot): PriceTarget | null => (owner && l.movement && PRICEABLE.has(l.source) ? {
    movementId: l.movement, kind: l.source === "official" || l.source === "shop" ? "buy" : "adjust",
    official: l.source === "official", product, title: `${lotName(t, l)} · ${fmtDate(l.on)}`,
    liters: l.liters, pipas: l.liters / ppLiters(), price: l.price, mode: "per_liter", fees: l.fees,
  } : null);

  if (closing) {
    return <ClosePoolDialog pool={closing} onClose={() => setClosing(null)}
      onDone={() => { setClosing(null); load(); onChanged?.(t("closeDone")); }} />;
  }
  if (pricing) {
    return <PriceDialog target={pricing} onClose={() => setPricing(null)}
      onDone={() => { setPricing(null); setNotice(t("priceSaved")); load(); }} />;
  }
  return (
    <PipaModal title={t("stockOf", { fuel: pipaProduct(t, product) })} subtitle={owner ? t("stockHelpOwner") : t("stockHelp")} onClose={onClose}>
      <div data-testid="pp-fuel-sheet" className="space-y-3">
        <div className="rounded-xl bg-slate-900 text-white px-4 py-3">
          <p className="text-xs font-semibold text-slate-300">{t("stockOnHand")}</p>
          <p className="text-3xl font-bold tabular-nums" data-testid="pp-sheet-total">{fmtPipas(stock.pipas)} P-P</p>
          <p className="text-xs text-slate-400 tabular-nums">{vol(stock.liters, "l")}</p>
        </div>

        {notice && <p className="text-sm font-medium text-pale-green-foreground" role="status">{notice}</p>}
        {error && <p role="alert" className="text-sm text-pale-red-foreground">{error}</p>}
        {!data && !error && <Loader2 className="w-5 h-5 text-slate-300 animate-spin" />}
        {short > OPEN && (
          <p className="flex items-start gap-2 text-xs text-pale-red-foreground bg-pale-red border border-red-200 rounded-xl px-3 py-2" data-testid="pp-sheet-short">
            <AlertTriangle className="w-4 h-4 shrink-0" /> {t("shortNote", { v: vol(short, "pp") })}
          </p>
        )}
        {data && rows.length === 0 && short <= OPEN && <p className="text-sm text-slate-500">{t("noStock")}</p>}

        <ul className="space-y-2">
          {rows.map(({ pool, lot: l }) => {
            const target = priceTarget(l);
            const now = selling?.lot === l;
            const closable = canClose && !pool.closed_at && l.remaining > OPEN;
            return (
              <li key={`${pool.id}-${l.at}`} data-testid="pp-sheet-lot"
                className={`rounded-xl border bg-white px-3 py-2.5 ${now ? "border-blue-300 ring-1 ring-blue-100" : "border-slate-200"}`}>
                <div className="flex items-center gap-2">
                  <i className={`w-2.5 h-2.5 rounded-full shrink-0 ${DOT[l.source] ?? "bg-sky-400"}`} />
                  <span className="min-w-0 flex-1 text-sm font-bold text-slate-900 truncate" data-testid="pp-lot-name">{lotName(t, l)} · {fmtDate(l.on)}</span>
                  {now && <span className="shrink-0 text-[10px] font-bold rounded-full bg-blue-600 text-white px-2 py-0.5" data-testid="pp-selling">{t("sellingNow")}</span>}
                  {pool.closed_at && <span className="shrink-0 text-[10px] font-bold rounded-full bg-slate-100 text-slate-500 px-2 py-0.5">{t("closedTag")}</span>}
                </div>
                <p className="mt-1 text-base font-bold tabular-nums text-slate-900">
                  {vol(l.remaining, "pp")} <span className="text-xs font-semibold text-slate-400">/ {vol(l.liters, "pp")}</span>
                </p>
                <Level left={l.remaining} total={l.liters} />
                {(target || closable) && (
                  <div className="mt-2 flex items-center justify-between gap-2">
                    {target ? (
                      l.priced && l.cost != null ? (
                        <button type="button" onClick={() => setPricing(target)} data-testid="pp-row-price" aria-label={t("changePrice")}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 bg-blue-50 rounded-lg px-2 py-1 tabular-nums">
                          {fmtMMK(l.cost)}/L <Pencil className="w-3 h-3" />
                        </button>
                      ) : (
                        <button type="button" onClick={() => setPricing(target)} data-testid="pp-row-noprice"
                          className="inline-flex items-center gap-1 text-xs font-bold text-white bg-red-600 rounded-lg px-2.5 py-1">
                          <Plus className="w-3 h-3" /> {t("addPrice")}
                        </button>
                      )
                    ) : <span />}
                    {closable && (
                      <button type="button" onClick={() => setClosing(pool)} data-testid="pp-sheet-close"
                        className="text-xs font-semibold text-pale-red-foreground rounded-lg px-2 py-1 hover:bg-pale-red">
                        {t("forceClose")}
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </PipaModal>
  );
}
