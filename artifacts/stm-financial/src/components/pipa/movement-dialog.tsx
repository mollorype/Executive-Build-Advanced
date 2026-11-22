import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  FORM_KINDS, KIND_INFO, PIPA_PRODUCTS,
  fmtLiters, fmtMMK, fmtPipas, outstandingFor, priceBreakdown, yangonToday,
  type MovementKind, type PipaProduct, type PipaStation, type PriceMode, type StationBalances,
} from "@/lib/pipa-ledger";
import { fromUnit, ppLiters, readUnit, saveUnit, vol, type VolUnit } from "@/lib/units";
import PipaModal, { ErrorNote, fieldCls, labelCls, primaryBtn } from "./modal";
import { Loader2 } from "lucide-react";
import { usePipaT, pipaKind, pipaProduct } from "@/lib/pipa-i18n";

/**
 * Record a P-P line. `official` opens it as the big official PO purchase
 * (its own button on the P-P Ledger): litres or P-P, priced per litre only,
 * with transport and other fees. Otherwise "Buy" is a purchase from a shop.
 */
export default function MovementDialog({ stations, balances, initialKind = "buy", initialStationId = "", official: officialMode = false, canPrice = false, onAddStation, onClose, onSaved }: {
  stations: PipaStation[];
  balances: StationBalances;
  initialKind?: MovementKind;
  initialStationId?: string;
  official?: boolean;
  /** Owners may type a price (or add it later); everyone else records date and quantity only. */
  canPrice?: boolean;
  onAddStation: () => void;
  onClose: () => void;
  /** After saving: what was saved. */
  onSaved: (saved: { kind: MovementKind; product: PipaProduct; official: boolean }) => void;
}) {
  const t = usePipaT();
  const [kind, setKind] = useState<MovementKind>(officialMode ? "buy" : initialKind);
  const [stationId, setStationId] = useState(initialStationId);
  const [product, setProduct] = useState<PipaProduct>("92");
  const [pipas, setPipas] = useState("");
  const [qty, setQty] = useState("");                 // official purchase, in `unit`
  const [unit, setUnit] = useState<VolUnit>(readUnit);
  const [occurredOn, setOccurredOn] = useState(yangonToday());
  // Fuel is priced per litre, so that's the default; P-P price is one tap away.
  const [priceMode, setPriceMode] = useState<PriceMode>("per_liter");
  const [unitPrice, setUnitPrice] = useState("");
  const [litersPerPipa, setLitersPerPipa] = useState(String(ppLiters()));
  const [transport, setTransport] = useState("");
  const [otherFee, setOtherFee] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const info = KIND_INFO[kind];
  const official = officialMode;
  const nPipas = parseFloat(pipas) || 0;
  const nPrice = parseFloat(unitPrice);
  const nLiters = parseFloat(litersPerPipa) || 0;
  const nQtyL = fromUnit(parseFloat(qty) || 0, unit);
  const nFees = (parseFloat(transport) || 0) + (parseFloat(otherFee) || 0);
  const cap = outstandingFor(balances, kind, info.station ? stationId || null : null, product);
  const priced = canPrice && info.price && unitPrice.trim() !== "";   // a price is never required
  const price = useMemo(
    () => (priced && !official && !isNaN(nPrice) && nLiters > 0 ? priceBreakdown(priceMode, nPrice, nPipas, nLiters) : null),
    [priced, official, nPrice, nPipas, nLiters, priceMode],
  );
  const stationName = stations.find(s => s.id === stationId)?.name ?? "";

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (info.station && !stationId) return setError(t("chooseStationErr"));
    if (official) {
      if (!(nQtyL > 0)) return setError(t("qtyErr"));
    } else if (!(nPipas > 0)) return setError(t("pipasErr"));
    if (!(nLiters > 0)) return setError(t("sizeErr"));
    if (cap != null && nPipas > cap + 1e-9) {
      return setError(cap === 0
        ? t("nothingOwed", { product: pipaProduct(t, product), station: stationName })
        : t("onlyOwed", { n: fmtPipas(cap), product: pipaProduct(t, product), station: stationName }));
    }
    if (priced && (isNaN(nPrice) || nPrice < 0)) return setError(t("priceErr"));

    setBusy(true);
    // The database records the line and what it does to stock and costs, together.
    const { error: err } = await supabase.rpc("record_pp_movement", {
      p: {
        kind, product, occurred_on: occurredOn, note: note.trim() || null,
        station_id: info.station ? stationId : null,
        liters_per_pipa: nLiters,
        ...(official
          ? { source: "official", liters: Math.round(nQtyL * 1000) / 1000,
              ...(priced ? { price_mode: "per_liter", unit_price: nPrice,
                  transport_fee: parseFloat(transport) || 0, other_fee: parseFloat(otherFee) || 0 } : {}) }
          : { source: kind === "buy" ? "shop" : null, pipas: nPipas,
              ...(priced ? { price_mode: priceMode, unit_price: nPrice } : {}) }),
      },
    });
    setBusy(false);
    if (err) return setError(err.code === "PGRST202" || err.code === "42883" ? t("needsUpdate") : err.message);
    onSaved({ kind, product, official });
  }

  const chip = (active: boolean) =>
    `px-3 py-2 rounded-xl text-sm font-semibold border transition-colors ${active ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-700 border-slate-200 hover:border-slate-300"}`;
  const switchUnit = (u: VolUnit) => {
    if (u === unit) return;
    const l = nQtyL;
    setUnit(u); saveUnit(u);
    if (l > 0) setQty(String(Math.round((u === "pp" ? l / ppLiters() : l) * 1000) / 1000));
  };

  return (
    <PipaModal title={official ? t("officialTitle") : t("mvTitle")} subtitle={(official ? t("officialHelp") : t(`help_${kind}`)) || undefined} onClose={onClose}>
      <form id="pipa-movement" onSubmit={save} className="space-y-4">
        {!official && (
          <div className="grid grid-cols-2 gap-2">
            {FORM_KINDS.map(k => (
              <button key={k} type="button" onClick={() => { setKind(k); setError(""); }} className={chip(kind === k)}>
                {pipaKind(t, k)}
              </button>
            ))}
          </div>
        )}

        {info.station && (
          <div>
            <label htmlFor="mv-station" className={labelCls}>{official ? t("from") : t("station")}</label>
            {stations.length === 0 ? (
              <button type="button" onClick={onAddStation}
                className="w-full text-sm font-semibold text-pale-blue-foreground bg-pale-blue rounded-xl py-2.5">
                {t("firstStation")}
              </button>
            ) : (
              <div className="flex gap-2">
                <select id="mv-station" value={stationId} onChange={e => setStationId(e.target.value)} className={fieldCls}>
                  <option value="">{t("choose")}</option>
                  {stations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <button type="button" onClick={onAddStation} aria-label={t("addStation")}
                  className="shrink-0 px-3 rounded-xl border border-slate-200 text-slate-600 font-bold hover:bg-slate-50">+</button>
              </div>
            )}
          </div>
        )}

        <div>
          <span className={labelCls}>{t("fuel")}</span>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {PIPA_PRODUCTS.map(p => (
              <button key={p} type="button" onClick={() => setProduct(p)} className={chip(product === p)}>{pipaProduct(t, p)}</button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {official ? (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="mv-qty" className={`${labelCls} !mb-0`}>{t("quantity")}</label>
                <span className="inline-flex rounded-lg bg-slate-100 p-0.5 text-[11px] font-semibold">
                  {(["pp", "l"] as const).map(u => (
                    <button key={u} type="button" onClick={() => switchUnit(u)} aria-pressed={unit === u}
                      className={`px-2 py-0.5 rounded-md ${unit === u ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>{u === "pp" ? "P-P" : "L"}</button>
                  ))}
                </span>
              </div>
              <input id="mv-qty" type="number" inputMode="decimal" min="0" step="any" value={qty}
                onChange={e => setQty(e.target.value)} className={fieldCls} placeholder="0" />
            </div>
          ) : (
            <div>
              <label htmlFor="mv-pipas" className={labelCls}>P-P *</label>
              <input id="mv-pipas" type="number" inputMode="decimal" min="0" step="any" value={pipas}
                onChange={e => setPipas(e.target.value)} className={fieldCls} placeholder="0" />
            </div>
          )}
          <div>
            <label htmlFor="mv-date" className={labelCls}>{t("date")}</label>
            <input id="mv-date" type="date" value={occurredOn} onChange={e => setOccurredOn(e.target.value)} className={fieldCls} />
          </div>
        </div>
        {official && nQtyL > 0 && (
          <p className="text-xs text-slate-500 -mt-2" data-testid="mv-qty-other">= {vol(nQtyL, unit === "pp" ? "l" : "pp")}</p>
        )}

        {cap != null && stationId && (
          <p className="text-xs text-slate-500 -mt-2">
            {t("owedFor", { product: pipaProduct(t, product), station: stationName })}<span className="font-semibold text-slate-900">{fmtPipas(cap)} P-P</span>
          </p>
        )}

        {info.price && !canPrice && (
          <p className="text-xs text-slate-600 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2" data-testid="mv-owner-prices">{t("ownerPrices")}</p>
        )}
        {official && !canPrice && (
          <div className="w-1/2 pr-1.5">
            <label htmlFor="mv-size3" className={labelCls}>{t("ppSize")}</label>
            <input id="mv-size3" type="number" inputMode="decimal" min="0" step="any" value={litersPerPipa}
              onChange={e => setLitersPerPipa(e.target.value)} className={fieldCls} />
          </div>
        )}
        {official && canPrice && (
          <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 space-y-3">
            <p className="text-[11px] text-slate-500">{t("priceLater")}</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="mv-price" className={labelCls}>{t("mmkPerL")}</label>
                <input id="mv-price" type="number" inputMode="decimal" min="0" step="any" value={unitPrice}
                  onChange={e => setUnitPrice(e.target.value)} className={fieldCls} placeholder="0" />
              </div>
              <div>
                <label htmlFor="mv-transport" className={labelCls}>{t("transportFee")}</label>
                <input id="mv-transport" type="number" inputMode="decimal" min="0" step="any" value={transport}
                  onChange={e => setTransport(e.target.value)} className={fieldCls} placeholder="0" />
              </div>
              <div>
                <label htmlFor="mv-other" className={labelCls}>{t("otherFee")}</label>
                <input id="mv-other" type="number" inputMode="decimal" min="0" step="any" value={otherFee}
                  onChange={e => setOtherFee(e.target.value)} className={fieldCls} placeholder="0" />
              </div>
              <div>
                <label htmlFor="mv-size" className={labelCls}>{t("ppSize")}</label>
                <input id="mv-size" type="number" inputMode="decimal" min="0" step="any" value={litersPerPipa}
                  onChange={e => setLitersPerPipa(e.target.value)} className={fieldCls} />
              </div>
            </div>
            {!isNaN(nPrice) && nQtyL > 0 && (
              <p className="text-xs text-slate-600 leading-relaxed" data-testid="mv-official-sum">
                {t("costPerL", { v: fmtMMK(nPrice + nFees) })}
                <br />{t("totalFor")}<span className="font-bold text-slate-900">{fmtMMK(nPrice * nQtyL)}</span>{t("forLiters", { liters: fmtLiters(nQtyL) })}
              </p>
            )}
          </div>
        )}

        {info.price && !official && canPrice && (
          <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 space-y-3">
            <p className="text-[11px] text-slate-500">{t("priceLater")}</p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setPriceMode("per_liter")} className={chip(priceMode === "per_liter")} aria-pressed={priceMode === "per_liter"}>{t("pricePerL")}</button>
              <button type="button" onClick={() => setPriceMode("per_pipa")} className={chip(priceMode === "per_pipa")} aria-pressed={priceMode === "per_pipa"}>{t("pricePerPP")}</button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="mv-price" className={labelCls}>{priceMode === "per_pipa" ? t("mmkPerPP") : t("mmkPerL")}</label>
                <input id="mv-price" type="number" inputMode="decimal" min="0" step="any" value={unitPrice}
                  onChange={e => setUnitPrice(e.target.value)} className={fieldCls} placeholder="0" />
              </div>
              <div>
                <label htmlFor="mv-size" className={labelCls}>{t("ppSize")}</label>
                <input id="mv-size" type="number" inputMode="decimal" min="0" step="any" value={litersPerPipa}
                  onChange={e => setLitersPerPipa(e.target.value)} className={fieldCls} />
              </div>
            </div>
            {price && nPipas > 0 && (
              <p className="text-xs text-slate-600 leading-relaxed">
                = <span className={priceMode === "per_pipa" ? "font-bold text-slate-900" : ""}>{fmtMMK(price.perLiter)}/L</span>
                {" · "}<span className={priceMode === "per_liter" ? "font-bold text-slate-900" : ""}>{fmtMMK(price.perPipa)}/P-P</span>
                <br />{t("totalFor")}<span className="font-bold text-slate-900">{fmtMMK(price.total)}</span>{t("forLiters", { liters: fmtLiters(price.liters) })}
              </p>
            )}
          </div>
        )}

        {(!info.price || (!canPrice && !official)) && (
          <div className="w-1/2 pr-1.5">
            <label htmlFor="mv-size2" className={labelCls}>{t("ppSize")}</label>
            <input id="mv-size2" type="number" inputMode="decimal" min="0" step="any" value={litersPerPipa}
              onChange={e => setLitersPerPipa(e.target.value)} className={fieldCls} />
          </div>
        )}

        <div>
          <label htmlFor="mv-note" className={labelCls}>{t("note")}</label>
          <input id="mv-note" value={note} onChange={e => setNote(e.target.value)} className={fieldCls} placeholder={t("optional")} />
        </div>

        {error && <ErrorNote>{error}</ErrorNote>}
        <button type="submit" disabled={busy} className={primaryBtn}>
          {busy && <Loader2 className="w-4 h-4 animate-spin" />} {t("save")}
        </button>
      </form>
    </PipaModal>
  );
}
