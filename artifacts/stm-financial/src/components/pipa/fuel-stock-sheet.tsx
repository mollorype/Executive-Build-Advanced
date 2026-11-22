import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronRight, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { fmtMMK, fmtPipas, type PipaProduct, type PriceMode, type ProductStock } from "@/lib/pipa-ledger";
import { loadPools, OPEN, type PoolLot, type PoolSummary, type PoolsData } from "@/lib/pools";
import { ppLiters, vol } from "@/lib/units";
import { usePipaT, pipaProduct, type PipaT } from "@/lib/pipa-i18n";
import PipaModal, { ErrorNote, fieldCls, labelCls } from "./modal";

// Tap a stock card: one simple row per purchase still holding fuel (oldest
// first — sold next), each with how full it still is. Only the owner can tap a
// row, to add or change its price (that's what profit needs). Owners and
// managers can force close a pool (shortage / spill / other).

const DOT: Record<string, string> = {
  official: "bg-emerald-500", shop: "bg-yellow-400", borrow: "bg-orange-500",
  count_gain: "bg-green-300", opening: "bg-green-300", lend_return: "bg-sky-400",
};
const fmtDate = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });

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

/** Force close one pool: what's left is written off (shortage / spill / other). */
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
    <PipaModal title={t("closeTitle", { fuel: pipaProduct(t, pool.product), d: first ? `${lotName(t, first)} · ${fmtDate(first.on)}` : fmtDate(pool.started_on) })} onClose={onClose}>
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

/** One fuel's stock: a simple row per purchase still holding fuel. */
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

  // Open pools, oldest first; in each, the purchases still holding fuel — and, for
  // owners, any still waiting for a price (profit needs it).
  const groups = useMemo(() => (data?.pools ?? [])
    .filter(p => p.product === product && !p.closed_at)
    .reverse()
    .map(p => ({ pool: p, rows: p.lots.filter(l => l.remaining > OPEN || (owner && PRICEABLE.has(l.source) && !l.priced)) }))
    .filter(g => g.rows.length > 0 || g.pool.short > OPEN), [data, product, owner]);
  const short = groups.reduce((s, g) => s + g.pool.short, 0);

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
        {data && groups.length === 0 && short <= OPEN && <p className="text-sm text-slate-500">{t("noStock")}</p>}

        {groups.map(({ pool, rows }) => (
          <div key={pool.id} className="space-y-2" data-testid="pp-sheet-pool">
            <ul className="space-y-2">
              {rows.map((l, k) => {
                const target = priceTarget(l);
                const inner = (
                  <>
                    <div className="flex items-center gap-2">
                      <i className={`w-2.5 h-2.5 rounded-full shrink-0 ${DOT[l.source] ?? "bg-sky-400"}`} />
                      <span className="min-w-0 flex-1 text-sm font-bold text-slate-900 truncate">{lotName(t, l)}</span>
                      <span className="text-[11px] text-slate-500">{fmtDate(l.on)}</span>
                      {target && <ChevronRight className="w-4 h-4 text-slate-300" />}
                    </div>
                    <p className="mt-1 text-base font-bold tabular-nums text-slate-900">
                      {vol(l.remaining, "pp")} <span className="text-xs font-semibold text-slate-400">/ {vol(l.liters, "pp")}</span>
                    </p>
                    <Level left={l.remaining} total={l.liters} />
                    {owner && PRICEABLE.has(l.source) && (l.priced && l.cost != null
                      ? <p className="mt-1 text-[11px] text-blue-700 font-semibold tabular-nums" data-testid="pp-row-price">{fmtMMK(l.cost)}/L</p>
                      : <p className="mt-1 text-[11px] font-bold text-pale-red-foreground" data-testid="pp-row-noprice">{t("priceNeeded")} · {t("tapToAdd")}</p>)}
                  </>
                );
                return (
                  <li key={k} data-testid="pp-sheet-lot">
                    {target ? (
                      <button type="button" onClick={() => setPricing(target)} className="w-full text-left rounded-xl border border-slate-200 bg-white px-3 py-2.5 active:bg-slate-50">{inner}</button>
                    ) : (
                      <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">{inner}</div>
                    )}
                  </li>
                );
              })}
            </ul>
            {canClose && pool.left > OPEN && (
              <button type="button" onClick={() => setClosing(pool)} data-testid="pp-sheet-close"
                className="w-full text-xs font-semibold text-pale-red-foreground bg-pale-red border border-red-200 rounded-lg py-2">
                {t("forceClose")}
              </button>
            )}
          </div>
        ))}
      </div>
    </PipaModal>
  );
}
