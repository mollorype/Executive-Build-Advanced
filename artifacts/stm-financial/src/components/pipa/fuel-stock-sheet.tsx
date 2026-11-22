import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { fmtMMK, fmtPipas, type PipaProduct, type ProductStock } from "@/lib/pipa-ledger";
import { loadPools, OPEN, type PoolLot, type PoolSummary, type PoolsData } from "@/lib/pools";
import { vol } from "@/lib/units";
import { usePipaT, pipaProduct, type PipaT } from "@/lib/pipa-i18n";
import PipaModal, { ErrorNote, fieldCls, labelCls } from "./modal";

// Tap a stock card: what that fuel's stock is made of, pool by pool (oldest
// first — that's what is sold next), each purchase with its PO number or
// station. Owners also see what it cost; managers and accountants see P-P only.
// Owners and managers can force close a pool (shortage / spill / other).

const DOT: Record<string, string> = {
  official: "bg-emerald-500", shop: "bg-yellow-400", borrow: "bg-orange-500",
  count_gain: "bg-green-300", opening: "bg-green-300", lend_return: "bg-sky-400",
};
const fmtDate = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });

/** "PO #12", a station's name, or what kind of stock it is. */
function lotName(t: PipaT, l: PoolLot): { main: string; tag: string } {
  switch (l.source) {
    case "official": return { main: l.po ? t("poNo", { n: l.po }) : t("src_official"), tag: `${t("src_official")}${l.station ? ` · ${l.station}` : ""}` };
    case "shop": return { main: l.station ?? t("src_shop"), tag: t("src_shop") };
    case "borrow": return { main: l.station ?? t("src_borrow"), tag: t("src_borrow") };
    case "lend_return": return { main: l.station ?? t("src_lend_return"), tag: t("src_lend_return") };
    default: return { main: t("src_count"), tag: "" };
  }
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

  const load = useCallback(async () => {
    const r = await loadPools();
    if (r.error) { setError(r.code === "PGRST202" || r.code === "42883" ? t("needsUpdate") : r.error); return; }
    setError(""); setData(r.data);
  }, [t]);
  useEffect(() => { load(); }, [load]);

  // Pools still holding fuel (or short), oldest first — that's what is sold next.
  const pools = useMemo(() => (data?.pools ?? [])
    .filter(p => p.product === product && !p.closed_at && (p.left > OPEN || p.short > OPEN))
    .reverse(), [data, product]);
  const short = pools.reduce((s, p) => s + p.short, 0);
  const worth = (lots: PoolLot[]) => lots.reduce((s, l) => s + (l.cost ?? 0) * l.remaining, 0);
  const total = pools.reduce((s, p) => s + worth(p.lots), 0);

  if (closing) {
    return <ClosePoolDialog pool={closing} onClose={() => setClosing(null)}
      onDone={() => { setClosing(null); load(); onChanged?.(t("closeDone")); }} />;
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

        {error && <p role="alert" className="text-sm text-pale-red-foreground">{error}</p>}
        {!data && !error && <Loader2 className="w-5 h-5 text-slate-300 animate-spin" />}
        {short > OPEN && (
          <p className="flex items-start gap-2 text-xs text-pale-red-foreground bg-pale-red border border-red-200 rounded-xl px-3 py-2" data-testid="pp-sheet-short">
            <AlertTriangle className="w-4 h-4 shrink-0" /> {t("shortNote", { v: vol(short, "pp") })}
          </p>
        )}
        {data && pools.length === 0 && short <= OPEN && <p className="text-sm text-slate-500">{t("noStock")}</p>}

        {pools.map((p, i) => {
          const first = p.lots[0];
          const head = first ? lotName(t, first) : { main: fmtDate(p.started_on), tag: "" };
          return (
            <section key={p.id} className={`border rounded-xl p-3 space-y-3 ${i === 0 && pools.length > 1 ? "border-amber-300 bg-amber-50/40" : "border-slate-200"}`} data-testid="pp-sheet-pool">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-base font-bold text-slate-900">{head.main} <span className="text-xs font-medium text-slate-500">· {t("fromDate", { d: fmtDate(p.started_on) })}</span></p>
                  {head.tag && <p className="text-[11px] text-slate-500">{head.tag}</p>}
                </div>
                {i === 0 && pools.length > 1 && <span className="shrink-0 text-[10px] font-bold rounded-full px-2 py-0.5 bg-amber-100 text-amber-800">{t("soldNext")}</span>}
              </div>

              <div className="grid grid-cols-3 gap-2">
                <Big label={t("pIn")} liters={p.cap} tone="bg-slate-50 text-slate-800" testid="pp-sheet-in" />
                <Big label={t("pOut")} liters={p.out} tone="bg-slate-50 text-slate-800" testid="pp-sheet-out" />
                {p.short > OPEN
                  ? <Big label={t("pShort")} liters={p.short} tone="bg-red-50 text-pale-red-foreground" testid="pp-sheet-pshort" />
                  : <Big label={t("pLeft")} liters={p.left} tone="bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200" testid="pp-sheet-left" />}
              </div>

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

              {owner && worth(p.lots) > 0 && (
                <p className="text-xs text-slate-600 tabular-nums">{t("worthLeft")} <span className="font-bold text-slate-900">{fmtMMK(worth(p.lots))}</span></p>
              )}
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
