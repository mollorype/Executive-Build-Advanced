import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { fmtMMK, fmtPipas, type PipaProduct, type ProductStock } from "@/lib/pipa-ledger";
import { loadPools, OPEN, poDate, type PoolLot, type PoolSummary, type PoolsData } from "@/lib/pools";
import { vol } from "@/lib/units";
import { usePipaT, pipaProduct, type PipaT } from "@/lib/pipa-i18n";
import PipaModal, { ErrorNote, fieldCls, labelCls } from "./modal";

// Tap a stock card: what that fuel's stock is made of, pool by pool (oldest
// first — that's what is sold next), each purchase by its PO date or station.
// Owners see each PO as a battery, with its price (or "enter price"), what was
// sold from it and the profit so far. Managers and accountants see P-P only.
// Owners and managers can force close a pool (shortage / spill / other).

const DOT: Record<string, string> = {
  official: "bg-emerald-500", shop: "bg-yellow-400", borrow: "bg-orange-500",
  count_gain: "bg-green-300", opening: "bg-green-300", lend_return: "bg-sky-400",
};
const fmtDate = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });
const signedMMK = (v: number) => `${v >= 0 ? "+" : "−"}${fmtMMK(Math.abs(v))}`;

/** "Nov 22 PO", a station's name, or what kind of stock it is. */
export function lotName(t: PipaT, l: Pick<PoolLot, "source" | "on" | "station">): { main: string; tag: string } {
  switch (l.source) {
    case "official": return { main: t("poOf", { d: poDate(l.on) }), tag: `${t("src_official")}${l.station ? ` · ${l.station}` : ""}` };
    case "shop": return { main: l.station ?? t("src_shop"), tag: t("src_shop") };
    case "borrow": return { main: l.station ?? t("src_borrow"), tag: t("src_borrow") };
    case "lend_return": return { main: l.station ?? t("src_lend_return"), tag: t("src_lend_return") };
    default: return { main: t("src_count"), tag: "" };
  }
}

/** Owners: enter (or change) a Big PO's price; what was sold from it is costed again. */
export function PoPriceDialog({ movementId, label, product, liters, price, transport, other, onClose, onDone }: {
  movementId: string; label: string; product: PipaProduct; liters: number;
  price?: number | null; transport?: number | null; other?: number | null;
  onClose: () => void; onDone: () => void;
}) {
  const t = usePipaT();
  const [p, setP] = useState(price != null ? String(price) : "");
  const [tr, setTr] = useState(transport ? String(transport) : "");
  const [ot, setOt] = useState(other ? String(other) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const nP = parseFloat(p), nT = parseFloat(tr) || 0, nO = parseFloat(ot) || 0;
  async function save() {
    if (isNaN(nP) || nP < 0) return setError(t("priceErr"));
    setBusy(true); setError("");
    const { error: err } = await supabase.rpc("pp_set_po_price", { p_movement: movementId, p_price: nP, p_transport: nT, p_other: nO });
    setBusy(false);
    if (err) return setError(err.code === "PGRST202" || err.code === "42883" ? t("needsUpdate") : err.message);
    onDone();
  }
  return (
    <PipaModal title={t("poPriceTitle", { po: label, fuel: pipaProduct(t, product) })} onClose={onClose}>
      <p className="text-sm text-slate-600">{t("poPriceHelp", { v: `${vol(liters, "pp")} · ${vol(liters, "l")}` })}</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label htmlFor="po-price" className={labelCls}>{t("mmkPerL")} *</label>
          <input id="po-price" type="number" inputMode="decimal" min="0" step="any" value={p} onChange={e => setP(e.target.value)}
            className={`${fieldCls} text-lg font-bold`} placeholder="0" />
        </div>
        <div>
          <label htmlFor="po-transport" className={labelCls}>{t("transportFee")}</label>
          <input id="po-transport" type="number" inputMode="decimal" min="0" step="any" value={tr} onChange={e => setTr(e.target.value)} className={fieldCls} placeholder="0" />
        </div>
        <div>
          <label htmlFor="po-other" className={labelCls}>{t("otherFee")}</label>
          <input id="po-other" type="number" inputMode="decimal" min="0" step="any" value={ot} onChange={e => setOt(e.target.value)} className={fieldCls} placeholder="0" />
        </div>
      </div>
      {!isNaN(nP) && (
        <p className="text-xs text-slate-600 leading-relaxed" data-testid="po-price-sum">
          {t("costPerL", { v: fmtMMK(nP + nT + nO) })}<br />{t("totalFor")}<span className="font-bold text-slate-900">{fmtMMK(nP * liters)}</span>{t("forLiters", { liters: vol(liters, "l") })}
        </p>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
      <button type="button" onClick={save} disabled={busy} data-testid="po-price-save"
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
    <PipaModal title={t("closeTitle", { fuel: pipaProduct(t, pool.product), d: first ? lotName(t, first).main : fmtDate(pool.started_on) })} onClose={onClose}>
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

function Big({ label, liters, tone, testid }: { label: string; liters: number; tone: string; testid?: string }) {
  return (
    <div className={`rounded-lg px-2.5 py-2 ${tone}`} data-testid={testid}>
      <p className="text-[11px] font-semibold opacity-80">{label}</p>
      <p className="text-base font-bold tabular-nums leading-tight whitespace-nowrap">{vol(liters, "pp").replace(" P-P", "")}<span className="text-[10px] ml-0.5">P-P</span></p>
      <p className="text-[10px] opacity-70 tabular-nums">{vol(liters, "l")}</p>
    </div>
  );
}

/** A battery: how full this PO still is (green → amber → red). Short = red outline. */
function Battery({ left, cap, short }: { left: number; cap: number; short: number }) {
  const t = usePipaT();
  const isShort = short > OPEN;
  const pct = isShort ? 0 : cap > 0 ? Math.max(0, Math.min(100, (left / cap) * 100)) : 0;
  const fill = pct >= 50 ? "bg-emerald-500" : pct >= 20 ? "bg-amber-400" : "bg-red-500";
  const shown = pct > 0 && pct < 1 ? "<1" : String(Math.round(pct));
  return (
    <div className="flex items-center gap-3" data-testid="pp-battery">
      <div className="relative flex-1 pr-2">
        <div className={`h-10 rounded-lg border-[3px] p-1 ${isShort ? "border-red-400 bg-red-50" : "border-slate-300"}`}>
          <div className={`h-full rounded ${fill}`} style={{ width: `${pct}%` }} />
        </div>
        <span className={`absolute right-0 top-1/2 -translate-y-1/2 h-4 w-1.5 rounded-r ${isShort ? "bg-red-400" : "bg-slate-300"}`} />
      </div>
      <div className="shrink-0 text-right w-[4.5rem]">
        <p className={`text-2xl font-bold tabular-nums leading-none ${isShort || pct < 20 ? "text-pale-red-foreground" : "text-slate-900"}`} data-testid="pp-battery-pct">{shown}%</p>
        <p className="text-[10px] text-slate-500">{pct <= 0 ? t("usedUp") : t("pctLeft")}</p>
      </div>
    </div>
  );
}

/** One fuel's stock: pools holding fuel, oldest first, with what came in. */
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
  const [pricing, setPricing] = useState<PoolLot | null>(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const r = await loadPools();
    if (r.error) { setError(r.code === "PGRST202" || r.code === "42883" ? t("needsUpdate") : r.error); return; }
    setError(""); setData(r.data);
  }, [t]);
  useEffect(() => { load(); }, [load]);

  // Pools still holding fuel (or short) — and, for owners, any Big PO still waiting for its price. Oldest first.
  const pools = useMemo(() => (data?.pools ?? [])
    .filter(p => p.product === product && !p.closed_at
      && (p.left > OPEN || p.short > OPEN || (owner && p.lots.some(l => l.source === "official" && !l.priced))))
    .reverse(), [data, product, owner]);
  const short = pools.reduce((s, p) => s + p.short, 0);
  const worth = (lots: PoolLot[]) => lots.reduce((s, l) => s + (l.cost ?? 0) * l.remaining, 0);
  const total = pools.reduce((s, p) => s + worth(p.lots), 0);
  const withFuel = pools.filter(p => p.left > OPEN);

  if (closing) {
    return <ClosePoolDialog pool={closing} onClose={() => setClosing(null)}
      onDone={() => { setClosing(null); load(); onChanged?.(t("closeDone")); }} />;
  }
  if (pricing?.movement) {
    return <PoPriceDialog movementId={pricing.movement} label={lotName(t, pricing).main} product={product} liters={pricing.liters}
      price={pricing.price} transport={pricing.fees} other={0} onClose={() => setPricing(null)}
      onDone={() => { setPricing(null); setNotice(t("priceSaved")); load(); }} />;
  }
  return (
    <PipaModal title={t("stockOf", { fuel: pipaProduct(t, product) })} subtitle={t("stockHelp")} onClose={onClose}>
      <div data-testid="pp-fuel-sheet" className="space-y-4">
        {/* What's on hand */}
        <div className="rounded-xl bg-slate-900 text-white p-4">
          <p className="text-xs font-semibold text-slate-300">{t("stockOnHand")}</p>
          <p className="text-3xl font-bold tabular-nums" data-testid="pp-sheet-total">{fmtPipas(stock.pipas)} P-P</p>
          <p className="text-xs text-slate-400 tabular-nums">{vol(stock.liters, "l")}</p>
          {owner && total > 0 && <p className="mt-2 text-sm font-semibold text-emerald-300 tabular-nums" data-testid="pp-sheet-worth">{t("worthLeft")} {fmtMMK(total)}</p>}
        </div>

        {notice && <p className="text-sm font-medium text-pale-green-foreground" role="status">{notice}</p>}
        {error && <p role="alert" className="text-sm text-pale-red-foreground">{error}</p>}
        {!data && !error && <Loader2 className="w-5 h-5 text-slate-300 animate-spin" />}
        {short > OPEN && (
          <p className="flex items-start gap-2 text-xs text-pale-red-foreground bg-pale-red border border-red-200 rounded-xl px-3 py-2" data-testid="pp-sheet-short">
            <AlertTriangle className="w-4 h-4 shrink-0" /> {t("shortNote", { v: vol(short, "pp") })}
          </p>
        )}
        {data && pools.length === 0 && short <= OPEN && <p className="text-sm text-slate-500">{t("noStock")}</p>}

        {pools.map(p => {
          const first = p.lots[0];
          const head = first ? lotName(t, first) : { main: fmtDate(p.started_on), tag: "" };
          const next = withFuel.length > 1 && withFuel[0] === p;
          const po = p.lots.find(l => l.source === "official");
          const sold = p.lots.reduce((s, l) => s + (l.sold ?? 0), 0);
          const unpricedSold = p.lots.some(l => (l.sold ?? 0) > OPEN && l.cogs == null);
          const profit = p.lots.reduce((s, l) => s + (l.cogs != null ? (l.revenue ?? 0) - l.cogs : 0), 0);
          return (
            <section key={p.id} className={`border rounded-xl p-3 space-y-3 ${next ? "border-amber-300 bg-amber-50/40" : "border-slate-200"}`} data-testid="pp-sheet-pool">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-lg font-bold text-slate-900">{head.main}</p>
                  {head.tag && <p className="text-[11px] text-slate-500">{head.tag}</p>}
                </div>
                {next && <span className="shrink-0 text-[10px] font-bold rounded-full px-2 py-0.5 bg-amber-100 text-amber-800">{t("soldNext")}</span>}
              </div>

              {owner ? (
                <>
                  {/* Owners: the PO as a battery, with its price and profit */}
                  <Battery left={p.left} cap={p.cap} short={p.short} />
                  <p className="text-sm tabular-nums text-slate-700" data-testid="pp-battery-nums">
                    <span className="text-xl font-bold text-slate-900">{vol(p.short > OPEN ? 0 : p.left, "pp")}</span>
                    <span className="text-slate-500"> / {vol(p.cap, "pp")}</span>
                    {p.short > OPEN && <span className="ml-2 font-bold text-pale-red-foreground">{t("pShort")} {vol(p.short, "pp")}</span>}
                  </p>
                  {po && (po.priced && po.price != null ? (
                    <div className="flex items-center justify-between gap-2 rounded-lg bg-blue-50 px-3 py-2">
                      <p className="text-sm tabular-nums text-blue-900" data-testid="pp-po-price">
                        <span className="font-bold">{fmtMMK(po.cost ?? po.price)}/L</span>
                        {(po.fees ?? 0) > 0 && <span className="text-[11px] text-blue-700"> ({fmtMMK(po.price)} + {fmtMMK(po.fees ?? 0)})</span>}
                      </p>
                      {po.movement && <button type="button" onClick={() => setPricing(po)} className="text-xs font-semibold text-blue-700 underline">{t("editPrice")}</button>}
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2" data-testid="pp-po-noprice">
                      <p className="text-sm font-bold text-pale-red-foreground">{t("priceNeeded")}</p>
                      {po.movement && (
                        <button type="button" onClick={() => setPricing(po)} data-testid="pp-po-enter-price"
                          className="text-sm font-bold text-white bg-red-600 rounded-lg px-3 py-1.5">{t("enterPrice")}</button>
                      )}
                    </div>
                  ))}
                  {sold > OPEN && (
                    <p className="text-xs tabular-nums text-slate-600" data-testid="pp-po-profit">
                      {unpricedSold ? t("soldNoPrice", { v: vol(sold, "pp") })
                        : <>{t("soldProfit", { v: vol(sold, "pp"), p: "" })}<span className={`font-bold ${profit >= 0 ? "text-pale-green-foreground" : "text-pale-red-foreground"}`}>{signedMMK(profit)}</span></>}
                    </p>
                  )}
                  {worth(p.lots) > 0 && (
                    <p className="text-xs text-slate-600 tabular-nums">{t("worthLeft")} <span className="font-bold text-slate-900">{fmtMMK(worth(p.lots))}</span></p>
                  )}
                </>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  <Big label={t("pIn")} liters={p.cap} tone="bg-slate-50 text-slate-800" testid="pp-sheet-in" />
                  <Big label={t("pOut")} liters={p.out} tone="bg-slate-50 text-slate-800" testid="pp-sheet-out" />
                  {p.short > OPEN
                    ? <Big label={t("pShort")} liters={p.short} tone="bg-red-50 text-pale-red-foreground" testid="pp-sheet-pshort" />
                    : <Big label={t("pLeft")} liters={p.left} tone="bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200" testid="pp-sheet-left" />}
                </div>
              )}

              <div>
                <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">{t("cameIn")}</p>
                <ul className="divide-y divide-slate-100">
                  {p.lots.map((l, k) => {
                    const n = lotName(t, l);
                    return (
                      <li key={k} className="py-2 flex items-start gap-2" data-testid="pp-sheet-lot">
                        <i className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${DOT[l.source] ?? "bg-sky-400"}`} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold text-slate-900 break-words">{n.main}</p>
                          <p className="text-[11px] text-slate-500">{n.tag ? `${n.tag} · ` : ""}{fmtDate(l.on)}</p>
                          {owner && l.cost != null && (
                            <p className="text-[11px] text-slate-600 tabular-nums" data-testid="pp-sheet-cost">
                              {t("costWorth", { cost: fmtMMK(l.cost), v: fmtMMK(l.cost * l.remaining) })}
                            </p>
                          )}
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-lg font-bold text-slate-900 tabular-nums leading-tight">+{vol(l.liters, "pp")}</p>
                          <p className={`text-[11px] font-semibold tabular-nums ${l.remaining > OPEN ? "text-emerald-700" : "text-slate-400"}`}>{t("leftOf", { v: vol(l.remaining, "pp") })}</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>

              {canClose && p.left > OPEN && (
                <button type="button" onClick={() => setClosing(p)} data-testid="pp-sheet-close"
                  className="w-full text-sm font-semibold text-pale-red-foreground bg-pale-red border border-red-200 rounded-xl py-2.5">
                  {t("forceClose")}
                </button>
              )}
            </section>
          );
        })}
      </div>
    </PipaModal>
  );
}
