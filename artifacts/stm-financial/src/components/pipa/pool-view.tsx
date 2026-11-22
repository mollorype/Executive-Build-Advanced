import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, Loader2, Lock } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { PIPA_PRODUCTS, type PipaProduct } from "@/lib/pipa-ledger";
import { setPPLiters, vol, type VolUnit } from "@/lib/units";
import { usePipaT, pipaProduct, type PipaT } from "@/lib/pipa-i18n";
import PipaModal, { ErrorNote, fieldCls, labelCls } from "./modal";

// Fuel pools (one per fuel): a Big PO starts one, later stock joins it, sales
// come off the oldest fuel first. The bar is only a picture — 20 P-P fills it —
// the numbers under it are exact. Owners and managers can close a pool: what
// the app still shows in it is written off as a loss.

export type PoolLot = { source: string; on: string; liters: number; remaining: number; written: number };
export type Pool = {
  id: string; product: PipaProduct; started_on: string; created_at: string;
  closed_at: string | null; closed_by: string | null; close_reason: "shortage" | "spill" | "other" | null; close_note: string | null;
  lots: PoolLot[];
};
export type PoolSummary = Pool & { cap: number; left: number; written: number; out: number; short: number; newest: boolean };
type PoolsData = { ppLiters: number; pools: PoolSummary[] };

const FULL_PP = 20;   // P-P that fill a bar
const OPEN = 0.0005;
const SRC: Record<string, { key: "src_official" | "src_shop" | "src_borrow" | "src_count" | "src_lend_return"; solid: string; faded: string }> = {
  official:    { key: "src_official",    solid: "bg-emerald-500", faded: "bg-emerald-500/25" },
  shop:        { key: "src_shop",        solid: "bg-yellow-400",  faded: "bg-yellow-400/30" },
  borrow:      { key: "src_borrow",      solid: "bg-orange-500",  faded: "bg-orange-500/25" },
  count_gain:  { key: "src_count",       solid: "bg-green-300",   faded: "bg-green-300/35" },
  opening:     { key: "src_count",       solid: "bg-green-300",   faded: "bg-green-300/35" },
  lend_return: { key: "src_lend_return", solid: "bg-sky-400",     faded: "bg-sky-400/25" },
};
const src = (s: string) => SRC[s] ?? SRC.lend_return;
const STRIPES = { backgroundImage: "repeating-linear-gradient(45deg, #94a3b8 0 3px, #e2e8f0 3px 6px)" };
const num = (v: unknown) => Number(v) || 0;
const fmtDate = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });
const fmtWhen = (s: string) => new Date(s).toLocaleDateString("en-GB", { timeZone: "Asia/Yangon", day: "numeric", month: "short" });

/** Pools from the database, with their totals; a fuel's shortage is shown on its newest pool. */
export function summarize(raw: unknown): PoolsData {
  const d = (raw ?? {}) as { pp_liters?: unknown; short?: Record<string, unknown>; pools?: Record<string, unknown>[] };
  const seen = new Set<string>();
  const pools = (d.pools ?? []).map(p => {
    const lots = ((p.lots ?? []) as Record<string, unknown>[]).map(l => ({
      source: String(l.source), on: String(l.on), liters: num(l.liters), remaining: num(l.remaining), written: num(l.written),
    }));
    const cap = lots.reduce((s, l) => s + l.liters, 0);
    const left = lots.reduce((s, l) => s + l.remaining, 0);
    const written = lots.reduce((s, l) => s + l.written, 0);
    const product = String(p.product) as PipaProduct;
    const newest = !seen.has(product);          // listed newest first per fuel
    seen.add(product);
    return {
      id: String(p.id), product, started_on: String(p.started_on), created_at: String(p.created_at),
      closed_at: (p.closed_at as string | null) ?? null, closed_by: (p.closed_by as string | null) ?? null,
      close_reason: (p.close_reason as Pool["close_reason"]) ?? null, close_note: (p.close_note as string | null) ?? null,
      lots, cap, left, written, out: Math.max(0, cap - left - written),
      short: newest ? num(d.short?.[product]) : 0, newest,
    };
  });
  return { ppLiters: num(d.pp_liters) || 215, pools };
}

/** Load the pools (owners, accountants, managers). */
export async function loadPools(): Promise<{ data: PoolsData | null; error: string | null; code?: string }> {
  const { data, error } = await supabase.rpc("pp_pools", { p_days: 60 });
  if (error) return { data: null, error: error.message, code: error.code };
  const out = summarize(data);
  setPPLiters(out.ppLiters);
  return { data: out, error: null };
}

/** Open but nothing left, and not the fuel's newest pool: done with. */
const usedUp = (p: PoolSummary) => !p.closed_at && !p.newest && p.left <= OPEN && p.short <= OPEN;

const whyText = (t: PipaT, p: Pool) =>
  `${p.close_reason ? t(`r_${p.close_reason}`) : ""}${p.close_note ? ` · ${p.close_note}` : ""}${p.closed_by ? ` · ${p.closed_by}` : ""}`;

function Num({ label, liters, unit, tone = "text-slate-900", testid }: { label: string; liters: number; unit: VolUnit; tone?: string; testid?: string }) {
  return (
    <div className="min-w-0" data-testid={testid}>
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className={`text-sm font-bold tabular-nums ${tone}`}>{vol(liters, unit)}</p>
      <p className="text-[10px] text-slate-400 tabular-nums">{vol(liters, unit === "pp" ? "l" : "pp")}</p>
    </div>
  );
}

function PoolCard({ p, ppL, unit, canClose, olderOpen, onClose }: {
  p: PoolSummary; ppL: number; unit: VolUnit; canClose: boolean; olderOpen: boolean; onClose: (p: PoolSummary) => void;
}) {
  const t = usePipaT();
  const full = FULL_PP * ppL;
  const over = p.cap - full;
  const first = p.lots[0];
  const pct = (l: number, of: number) => (of > 0 ? (l / of) * 100 : 0);
  return (
    <div className={`bg-white border rounded-xl p-4 space-y-3 ${olderOpen ? "border-amber-300" : "border-slate-100"}`} data-testid="pp-pool">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-900">{t("poolFrom", { d: fmtDate(p.started_on) })}</p>
          {first && <p className="text-[11px] text-slate-500">{t(src(first.source).key)} · {vol(first.liters, unit)}</p>}
        </div>
        <span className={`shrink-0 inline-flex items-center gap-1 text-[10px] font-bold rounded-full px-2 py-0.5 ${p.closed_at || usedUp(p) ? "bg-slate-100 text-slate-500" : "bg-emerald-100 text-emerald-800"}`}
          data-testid="pp-pool-status">
          {p.closed_at && <Lock className="w-3 h-3" />}{p.closed_at ? t("poolClosed") : usedUp(p) ? t("poolUsedUp") : t("poolOpen")}
        </span>
      </div>
      {olderOpen && (
        <p className="flex items-start gap-1.5 text-[11px] text-amber-800 bg-amber-50 rounded-lg px-2 py-1.5" data-testid="pp-pool-older">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {t("olderOpen")}
        </p>
      )}

      {/* The picture: 20 P-P = full bar; each purchase its colour; faded = sold, striped = written off */}
      <div>
        <div className="flex items-center gap-2">
          <div className="flex-1 h-5 rounded-full bg-slate-100 overflow-hidden" aria-hidden>
            <div className="flex h-full" style={{ width: `${Math.min(100, pct(p.cap, full))}%` }}>
              {p.lots.map((l, i) => {
                const out = Math.max(0, l.liters - l.remaining - l.written);
                const c = src(l.source);
                return (
                  <div key={i} className={`flex h-full ${i ? "border-l-2 border-white" : ""}`} style={{ width: `${pct(l.liters, p.cap)}%` }} data-src={l.source}>
                    <div className={c.faded} style={{ width: `${pct(out, l.liters)}%` }} />
                    <div style={{ ...STRIPES, width: `${pct(l.written, l.liters)}%` }} />
                    <div className={c.solid} style={{ width: `${pct(l.remaining, l.liters)}%` }} />
                  </div>
                );
              })}
            </div>
          </div>
          {over > OPEN && <span className="shrink-0 text-[11px] font-bold text-slate-600 tabular-nums" data-testid="pp-pool-over">+{vol(over, "pp")} ▶</span>}
        </div>
        {p.short > OPEN && (
          <div className="mt-1.5 h-2 rounded-full bg-red-100 overflow-hidden" aria-hidden>
            <div className="h-full bg-red-500" style={{ width: `${Math.min(100, pct(p.short, full))}%` }} />
          </div>
        )}
      </div>

      {/* The numbers — exact */}
      <div className={`grid ${p.written > OPEN ? "grid-cols-4" : "grid-cols-3"} gap-2`}>
        <Num label={t("pTotal")} liters={p.cap} unit={unit} testid="pp-pool-total" />
        <Num label={t("pOut")} liters={p.out} unit={unit} testid="pp-pool-out" />
        {p.short > OPEN
          ? <Num label={t("pShort")} liters={p.short} unit={unit} tone="text-pale-red-foreground" testid="pp-pool-short" />
          : <Num label={t("pLeft")} liters={p.left} unit={unit} tone={p.left > OPEN ? "text-pale-green-foreground" : "text-slate-400"} testid="pp-pool-left" />}
        {p.written > OPEN && <Num label={t("pWritten")} liters={p.written} unit={unit} tone="text-slate-500" testid="pp-pool-written" />}
      </div>
      {p.short > OPEN && <p className="text-[11px] text-pale-red-foreground">{t("shortNote", { v: vol(p.short, unit) })}</p>}

      {/* What went in */}
      <ul className="space-y-0.5">
        {p.lots.map((l, i) => (
          <li key={i} className="flex items-center gap-1.5 text-[11px] text-slate-500 tabular-nums">
            <i className={`w-2 h-2 rounded-sm shrink-0 ${src(l.source).solid}`} />
            <span className="text-slate-700">{t(src(l.source).key)}</span> · {vol(l.liters, unit)} · {fmtDate(l.on)}
          </li>
        ))}
      </ul>

      {p.closed_at ? (
        <p className="text-[11px] text-slate-500 break-words" data-testid="pp-pool-closed">{t("closedLine", { d: fmtWhen(p.closed_at), why: whyText(t, p) })}</p>
      ) : canClose && p.left > OPEN && (
        <button type="button" onClick={() => onClose(p)} data-testid="pp-pool-close"
          className="w-full text-sm font-semibold text-pale-red-foreground bg-pale-red border border-red-200 rounded-xl py-2">
          {t("closeBtn")}
        </button>
      )}
    </div>
  );
}

/** Close one pool: what's left is written off (shortage / spill / other). */
export function ClosePoolDialog({ pool, unit, onClose, onDone }: { pool: PoolSummary; unit: VolUnit; onClose: () => void; onDone: () => void }) {
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
  return (
    <PipaModal title={t("closeTitle", { fuel: pipaProduct(t, pool.product), d: fmtDate(pool.started_on) })} onClose={onClose}>
      <p className="text-sm text-slate-700" data-testid="pp-close-left">
        {pool.left > OPEN ? t("closeLeft", { v: vol(pool.left, unit) }) : t("closeEmpty")}
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

/** Every fuel's pools: open ones (oldest first — that's the fuel being used), closed ones folded away. */
export default function PoolView({ unit, canClose, reloadKey = 0, onChanged }: {
  unit: VolUnit; canClose: boolean; reloadKey?: number; onChanged?: (message: string) => void;
}) {
  const t = usePipaT();
  const [data, setData] = useState<PoolsData | null>(null);
  const [error, setError] = useState("");
  const [closing, setClosing] = useState<PoolSummary | null>(null);
  const [showClosed, setShowClosed] = useState<Partial<Record<PipaProduct, boolean>>>({});

  const load = useCallback(async () => {
    const r = await loadPools();
    if (r.error) { setError(r.code === "PGRST202" || r.code === "42883" ? t("needsUpdate") : r.error); return; }
    setError(""); setData(r.data);
  }, [t]);
  useEffect(() => { load(); }, [load, reloadKey]);

  const byFuel = useMemo(() => PIPA_PRODUCTS.map(p => {
    const mine = (data?.pools ?? []).filter(x => x.product === p);
    // In use: open with fuel left (oldest first — that's what is sold first), plus the newest pool. Earlier: closed or used up.
    return { p, open: mine.filter(x => !x.closed_at && !usedUp(x)).reverse(), closed: mine.filter(x => x.closed_at || usedUp(x)) };
  }).filter(g => g.open.length + g.closed.length > 0), [data]);

  return (
    <section className="space-y-3" data-testid="pp-pools">
      <div>
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest">{t("poolsTitle")}</h2>
        <p className="text-[11px] text-slate-500 mt-0.5">{t("poolsHelp")}</p>
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[11px] text-slate-600">
          {(["official", "shop", "borrow", "opening", "lend_return"] as const).map(k => (
            <span key={k} className="flex items-center gap-1"><i className={`w-2.5 h-2.5 rounded-sm ${SRC[k].solid}`} />{t(SRC[k].key)}</span>
          ))}
          <span className="text-slate-400">· {t("barFaded")} · {t("barStriped")}</span>
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-pale-red-foreground">{error}</p>}
      {!data && !error && <Loader2 className="w-5 h-5 text-slate-300 animate-spin" />}
      {data && byFuel.length === 0 && <p className="bg-white border border-slate-100 rounded-xl p-4 text-sm text-slate-500">{t("noPools")}</p>}
      {data && byFuel.map(g => (
        <div key={g.p} className="space-y-2" data-testid={`pp-pools-${g.p}`}>
          <h3 className="text-sm font-bold text-slate-900">{pipaProduct(t, g.p)}</h3>
          {g.open.map((x, i) => (
            <PoolCard key={x.id} p={x} ppL={data.ppLiters} unit={unit} canClose={canClose}
              olderOpen={i < g.open.length - 1 && x.left > OPEN} onClose={setClosing} />
          ))}
          {g.closed.length > 0 && (
            <>
              <button type="button" onClick={() => setShowClosed(s => ({ ...s, [g.p]: !s[g.p] }))} aria-expanded={!!showClosed[g.p]}
                className="flex items-center gap-1 text-xs font-semibold text-slate-500" data-testid={`pp-pools-closed-${g.p}`}>
                <ChevronDown className={`w-4 h-4 transition-transform ${showClosed[g.p] ? "rotate-180" : ""}`} /> {t("closedPools", { n: g.closed.length })}
              </button>
              {showClosed[g.p] && g.closed.map(x => (
                <PoolCard key={x.id} p={x} ppL={data.ppLiters} unit={unit} canClose={false} olderOpen={false} onClose={setClosing} />
              ))}
            </>
          )}
        </div>
      ))}
      {closing && (
        <ClosePoolDialog pool={closing} unit={unit} onClose={() => setClosing(null)}
          onDone={() => { setClosing(null); load(); onChanged?.(t("closeDone")); }} />
      )}
    </section>
  );
}
