import { useEffect, useState } from "react";
import { ChevronRight, Cylinder, Droplets, Loader2 } from "lucide-react";
import { PIPA_PRODUCTS, fmtLiters, fmtPipas, type PipaProduct, type ProductStock } from "@/lib/pipa-ledger";
import { usePipaT, pipaProduct } from "@/lib/pipa-i18n";

const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Counts from 0 up to `target` (ease-out), ending on the exact value. */
export function useCountUp(target: number, run: boolean, ms = 900): number {
  const [v, setV] = useState(run && !reducedMotion() ? 0 : target);
  useEffect(() => {
    if (!run || reducedMotion()) { setV(target); return; }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      setV(p < 1 ? Math.round(target * eased) : target);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, run, ms]);
  return v;
}

function Card({ product, value, unit, negative, loading, animate, index, group, onOpen }: {
  product: PipaProduct; value: number; unit: "L" | "P-P"; negative: boolean; loading: boolean; animate: boolean; index: number; group: "l" | "pp";
  onOpen?: (p: PipaProduct) => void;
}) {
  const t = usePipaT();
  const shown = useCountUp(value, animate && !loading);
  const Icon = group === "l" ? Droplets : Cylinder;
  return (
    <button type="button" onClick={() => onOpen?.(product)} disabled={!onOpen}
      className={`w-full text-left bg-white border rounded-xl p-4 transition-transform ${negative ? "border-red-200" : "border-slate-100"} ${animate ? "pp-rise hover:-translate-y-0.5 hover:shadow-sm" : ""} ${onOpen ? "active:scale-[0.98] cursor-pointer" : "cursor-default"}`}
      style={animate ? { animationDelay: `${index * 70}ms` } : undefined} data-testid={`pp-stock-${group}-${product}`}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4 text-slate-400" />
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{pipaProduct(t, product)}</span>
        {onOpen && <ChevronRight className="ml-auto w-4 h-4 text-slate-300" />}
      </div>
      {loading ? <Loader2 className="w-5 h-5 text-slate-300 animate-spin" /> : (
        <>
          <p className={`text-2xl font-bold tabular-nums ${negative ? "text-pale-red-foreground" : "text-slate-900"}`}>
            {group === "l" ? fmtLiters(shown).replace(/ L$/, "") : fmtPipas(shown)} <span className="text-sm font-semibold text-slate-400">{unit}</span>
          </p>
          {negative && <p className="text-[11px] text-pale-red-foreground mt-1">{t("belowZero")}</p>}
        </>
      )}
    </button>
  );
}

/** Stock in litres and stock in P-P, as two separate sets of fuel cards. */
export default function StockCards({ stock, loading, animate = false, onOpen }: {
  stock: Record<PipaProduct, ProductStock>;
  loading: boolean;
  animate?: boolean;
  /** Tap a card: that fuel's stock detail. */
  onOpen?: (p: PipaProduct) => void;
}) {
  const t = usePipaT();
  const groups = [
    { key: "l" as const, title: t("stockLiters"), unit: "L" as const, value: (p: PipaProduct) => stock[p].liters },
    { key: "pp" as const, title: t("stockPP"), unit: "P-P" as const, value: (p: PipaProduct) => stock[p].pipas },
  ];
  return (
    <>
      {groups.map((g, gi) => (
        <section key={g.key} data-testid={`pp-stock-group-${g.key}`}>
          <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">{g.title}
            {onOpen && gi === 0 && <span className="ml-2 normal-case tracking-normal font-medium text-slate-400">· {t("tapDetails")}</span>}</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {PIPA_PRODUCTS.map((p, i) => (
              <Card key={p} product={p} value={g.value(p)} unit={g.unit} negative={stock[p].pipas < 0} loading={loading}
                animate={animate} index={gi * PIPA_PRODUCTS.length + i} group={g.key} onOpen={onOpen} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
