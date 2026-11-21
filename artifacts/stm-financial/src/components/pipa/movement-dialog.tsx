import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  DEFAULT_LITERS_PER_PIPA, FORM_KINDS, KIND_INFO, PIPA_MOVEMENTS_TABLE, PIPA_PRODUCTS,
  fmtLiters, fmtMMK, fmtPipas, outstandingFor, priceBreakdown, yangonToday,
  type MovementKind, type PipaProduct, type PipaStation, type PriceMode, type StationBalances,
} from "@/lib/pipa-ledger";
import PipaModal, { ErrorNote, fieldCls, labelCls, primaryBtn } from "./modal";
import { Loader2 } from "lucide-react";
import { usePipaT, pipaKind, pipaProduct } from "@/lib/pipa-i18n";

export default function MovementDialog({ stations, balances, initialKind = "buy", initialStationId = "", onAddStation, onClose, onSaved }: {
  stations: PipaStation[];
  balances: StationBalances;
  initialKind?: MovementKind;
  initialStationId?: string;
  onAddStation: () => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = usePipaT();
  const [kind, setKind] = useState<MovementKind>(initialKind);
  const [stationId, setStationId] = useState(initialStationId);
  const [product, setProduct] = useState<PipaProduct>("92");
  const [pipas, setPipas] = useState("");
  const [occurredOn, setOccurredOn] = useState(yangonToday());
  // Fuel is priced per litre, so that's the default; P-P price is one tap away.
  const [priceMode, setPriceMode] = useState<PriceMode>("per_liter");
  const [unitPrice, setUnitPrice] = useState("");
  const [litersPerPipa, setLitersPerPipa] = useState(String(DEFAULT_LITERS_PER_PIPA));
  const [note, setNote] = useState("");
  const [addToPO, setAddToPO] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const info = KIND_INFO[kind];
  const nPipas = parseFloat(pipas) || 0;
  const nPrice = parseFloat(unitPrice);
  const nLiters = parseFloat(litersPerPipa) || 0;
  const cap = outstandingFor(balances, kind, info.station ? stationId || null : null, product);
  const price = useMemo(
    () => (info.price && !isNaN(nPrice) && nLiters > 0 ? priceBreakdown(priceMode, nPrice, nPipas, nLiters) : null),
    [info.price, nPrice, nPipas, nLiters, priceMode],
  );
  const stationName = stations.find(s => s.id === stationId)?.name ?? "";

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (info.station && !stationId) return setError(t("chooseStationErr"));
    if (!(nPipas > 0)) return setError(t("pipasErr"));
    if (!(nLiters > 0)) return setError(t("sizeErr"));
    if (cap != null && nPipas > cap + 1e-9) {
      return setError(cap === 0
        ? t("nothingOwed", { product: pipaProduct(t, product), station: stationName })
        : t("onlyOwed", { n: fmtPipas(cap), product: pipaProduct(t, product), station: stationName }));
    }
    if (info.price && (isNaN(nPrice) || nPrice < 0)) return setError(t("priceErr"));

    setBusy(true);
    if (kind === "buy" && addToPO) {
      // The purchase and its queued PO (in litres, at the price per litre) are
      // saved together by the database — accountants and managers can't write
      // POs themselves, and nothing is left half-saved.
      const { error: buyErr } = await supabase.rpc("record_pipa_buy", {
        p_movement: {
          occurred_on: occurredOn, station_id: stationId, product, pipas: nPipas,
          liters_per_pipa: nLiters, price_mode: priceMode, unit_price: nPrice, note: note.trim() || null,
        },
        p_add_po: true,
      });
      setBusy(false);
      if (buyErr) {
        return setError(buyErr.code === "PGRST202" || buyErr.code === "42883"
          ? t("buyNotInstalled")
          : t("poFailed", { msg: buyErr.message }));
      }
      return onSaved();
    }

    const { error: mvErr } = await supabase.from(PIPA_MOVEMENTS_TABLE).insert({
      occurred_on: occurredOn,
      kind,
      station_id: info.station ? stationId : null,
      product,
      pipas: nPipas,
      liters_per_pipa: nLiters,
      price_mode: info.price ? priceMode : null,
      unit_price: info.price ? nPrice : null,
      total_amount: price ? price.total : null,
      note: note.trim() || null,
    });
    if (mvErr) {
      setBusy(false);
      return setError(mvErr.message);
    }
    setBusy(false);
    onSaved();
  }

  const chip = (active: boolean) =>
    `px-3 py-2 rounded-xl text-sm font-semibold border transition-colors ${active ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-700 border-slate-200 hover:border-slate-300"}`;

  return (
    <PipaModal title={t("mvTitle")} subtitle={t(`help_${kind}`) || undefined} onClose={onClose}>
      <form id="pipa-movement" onSubmit={save} className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {FORM_KINDS.map(k => (
            <button key={k} type="button" onClick={() => { setKind(k); setError(""); }} className={chip(kind === k)}>
              {pipaKind(t, k)}
            </button>
          ))}
        </div>

        {info.station && (
          <div>
            <label htmlFor="mv-station" className={labelCls}>{t("station")}</label>
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
          <div>
            <label htmlFor="mv-pipas" className={labelCls}>P-P *</label>
            <input id="mv-pipas" type="number" inputMode="decimal" min="0" step="any" value={pipas}
              onChange={e => setPipas(e.target.value)} className={fieldCls} placeholder="0" />
          </div>
          <div>
            <label htmlFor="mv-date" className={labelCls}>{t("date")}</label>
            <input id="mv-date" type="date" value={occurredOn} onChange={e => setOccurredOn(e.target.value)} className={fieldCls} />
          </div>
        </div>

        {cap != null && stationId && (
          <p className="text-xs text-slate-500 -mt-2">
            {t("owedFor", { product: pipaProduct(t, product), station: stationName })}<span className="font-semibold text-slate-900">{fmtPipas(cap)} P-P</span>
          </p>
        )}

        {info.price && (
          <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setPriceMode("per_liter")} className={chip(priceMode === "per_liter")} aria-pressed={priceMode === "per_liter"}>{t("pricePerL")}</button>
              <button type="button" onClick={() => setPriceMode("per_pipa")} className={chip(priceMode === "per_pipa")} aria-pressed={priceMode === "per_pipa"}>{t("pricePerPP")}</button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="mv-price" className={labelCls}>{priceMode === "per_pipa" ? t("mmkPerPP") : t("mmkPerL")} *</label>
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

        {!info.price && (
          <div className="w-1/2 pr-1.5">
            <label htmlFor="mv-size2" className={labelCls}>{t("ppSize")}</label>
            <input id="mv-size2" type="number" inputMode="decimal" min="0" step="any" value={litersPerPipa}
              onChange={e => setLitersPerPipa(e.target.value)} className={fieldCls} />
          </div>
        )}

        {kind === "buy" && (
          <label className="flex items-start gap-2.5 text-sm text-slate-700">
            <input type="checkbox" checked={addToPO} onChange={e => setAddToPO(e.target.checked)} className="mt-0.5 w-4 h-4 accent-blue-600" />
            <span>{t("addToPOa")}<span className="font-semibold">{t("poRegistry")}</span>{t("addToPOb")}</span>
          </label>
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
