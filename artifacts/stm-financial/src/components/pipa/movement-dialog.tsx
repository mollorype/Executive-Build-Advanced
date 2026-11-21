import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  DEFAULT_LITERS_PER_PIPA, FORM_KINDS, KIND_INFO, PIPA_MOVEMENTS_TABLE, PIPA_PRODUCTS, PRODUCT_LABELS,
  fmtLiters, fmtMMK, fmtPipas, outstandingFor, priceBreakdown, yangonToday,
  type MovementKind, type PipaProduct, type PipaStation, type PriceMode, type StationBalances,
} from "@/lib/pipa-ledger";
import PipaModal, { ErrorNote, fieldCls, labelCls, primaryBtn } from "./modal";
import { Loader2 } from "lucide-react";

const KIND_HELP: Record<MovementKind, string> = {
  buy: "P-P you bought from a station.",
  borrow: "P-P a station gave you, to return later.",
  lend: "P-P you gave a station, to get back later.",
  borrow_returned: "P-P you gave back to a station you borrowed from.",
  lend_returned: "P-P a station gave back to you.",
  borrow_paid: "You paid cash instead of returning borrowed P-P.",
  lend_paid: "A station paid you cash instead of returning P-P.",
  used: "P-P sold, or poured into the pumps.",
  adjust: "",
};

export default function MovementDialog({ stations, balances, initialKind = "buy", initialStationId = "", onAddStation, onClose, onSaved }: {
  stations: PipaStation[];
  balances: StationBalances;
  initialKind?: MovementKind;
  initialStationId?: string;
  onAddStation: () => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [kind, setKind] = useState<MovementKind>(initialKind);
  const [stationId, setStationId] = useState(initialStationId);
  const [product, setProduct] = useState<PipaProduct>("92");
  const [pipas, setPipas] = useState("");
  const [occurredOn, setOccurredOn] = useState(yangonToday());
  const [priceMode, setPriceMode] = useState<PriceMode>("per_pipa");
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
    if (info.station && !stationId) return setError("Choose a station.");
    if (!(nPipas > 0)) return setError("Enter how many P-P (more than 0).");
    if (!(nLiters > 0)) return setError("P-P size must be more than 0 litres.");
    if (cap != null && nPipas > cap + 1e-9) {
      return setError(cap === 0
        ? `Nothing is owed for ${PRODUCT_LABELS[product]} with ${stationName}.`
        : `Only ${fmtPipas(cap)} P-P of ${PRODUCT_LABELS[product]} are owed with ${stationName}.`);
    }
    if (info.price && (isNaN(nPrice) || nPrice < 0)) return setError("Enter the price.");

    setBusy(true);
    let poId: string | null = null;
    if (kind === "buy" && addToPO && price) {
      // Same shape the PO Registry's own "New PO" form inserts, in litres of the real fuel.
      const { data: po, error: poErr } = await supabase.from("fuel_purchase_orders").insert({
        name: `P-P · ${stationName} · ${occurredOn}`,
        product_type: product,
        status: "QUEUED",
        initial_volume: price.liters,
        remaining_volume: price.liters,
        calibration_factor: 1,
        wholesale_price: price.perLiter,
        is_verified: false,
        total_volume_sold: 0,
      }).select("id").single();
      if (poErr) { setBusy(false); return setError(`Couldn't add the purchase order: ${poErr.message}`); }
      poId = po.id as string;
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
      po_id: poId,
    });
    if (mvErr) {
      // Don't leave an orphan PO behind if the movement itself failed.
      if (poId) await supabase.from("fuel_purchase_orders").delete().eq("id", poId);
      setBusy(false);
      return setError(mvErr.message);
    }
    setBusy(false);
    onSaved();
  }

  const chip = (active: boolean) =>
    `px-3 py-2 rounded-xl text-sm font-semibold border transition-colors ${active ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-700 border-slate-200 hover:border-slate-300"}`;

  return (
    <PipaModal title="Record P-P movement" subtitle={KIND_HELP[kind]} onClose={onClose}>
      <form id="pipa-movement" onSubmit={save} className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {FORM_KINDS.map(k => (
            <button key={k} type="button" onClick={() => { setKind(k); setError(""); }} className={chip(kind === k)}>
              {KIND_INFO[k].label}
            </button>
          ))}
        </div>

        {info.station && (
          <div>
            <label htmlFor="mv-station" className={labelCls}>Station *</label>
            {stations.length === 0 ? (
              <button type="button" onClick={onAddStation}
                className="w-full text-sm font-semibold text-pale-blue-foreground bg-pale-blue rounded-xl py-2.5">
                + Add your first station
              </button>
            ) : (
              <div className="flex gap-2">
                <select id="mv-station" value={stationId} onChange={e => setStationId(e.target.value)} className={fieldCls}>
                  <option value="">Choose…</option>
                  {stations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <button type="button" onClick={onAddStation} aria-label="Add station"
                  className="shrink-0 px-3 rounded-xl border border-slate-200 text-slate-600 font-bold hover:bg-slate-50">+</button>
              </div>
            )}
          </div>
        )}

        <div>
          <span className={labelCls}>Fuel</span>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {PIPA_PRODUCTS.map(p => (
              <button key={p} type="button" onClick={() => setProduct(p)} className={chip(product === p)}>{PRODUCT_LABELS[p]}</button>
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
            <label htmlFor="mv-date" className={labelCls}>Date</label>
            <input id="mv-date" type="date" value={occurredOn} onChange={e => setOccurredOn(e.target.value)} className={fieldCls} />
          </div>
        </div>

        {cap != null && stationId && (
          <p className="text-xs text-slate-500 -mt-2">
            Owed for {PRODUCT_LABELS[product]} with {stationName}: <span className="font-semibold text-slate-900">{fmtPipas(cap)} P-P</span>
          </p>
        )}

        {info.price && (
          <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setPriceMode("per_pipa")} className={chip(priceMode === "per_pipa")}>Price per P-P</button>
              <button type="button" onClick={() => setPriceMode("per_liter")} className={chip(priceMode === "per_liter")}>Price per litre</button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="mv-price" className={labelCls}>{priceMode === "per_pipa" ? "MMK / P-P" : "MMK / litre"} *</label>
                <input id="mv-price" type="number" inputMode="decimal" min="0" step="any" value={unitPrice}
                  onChange={e => setUnitPrice(e.target.value)} className={fieldCls} placeholder="0" />
              </div>
              <div>
                <label htmlFor="mv-size" className={labelCls}>P-P size (L)</label>
                <input id="mv-size" type="number" inputMode="decimal" min="0" step="any" value={litersPerPipa}
                  onChange={e => setLitersPerPipa(e.target.value)} className={fieldCls} />
              </div>
            </div>
            {price && nPipas > 0 && (
              <p className="text-xs text-slate-600 leading-relaxed">
                = <span className="font-semibold">{fmtMMK(price.perLiter)}/L</span> · {fmtMMK(price.perPipa)}/P-P
                <br />Total <span className="font-bold text-slate-900">{fmtMMK(price.total)}</span> for {fmtLiters(price.liters)}
              </p>
            )}
          </div>
        )}

        {!info.price && (
          <div className="w-1/2 pr-1.5">
            <label htmlFor="mv-size2" className={labelCls}>P-P size (L)</label>
            <input id="mv-size2" type="number" inputMode="decimal" min="0" step="any" value={litersPerPipa}
              onChange={e => setLitersPerPipa(e.target.value)} className={fieldCls} />
          </div>
        )}

        {kind === "buy" && (
          <label className="flex items-start gap-2.5 text-sm text-slate-700">
            <input type="checkbox" checked={addToPO} onChange={e => setAddToPO(e.target.checked)} className="mt-0.5 w-4 h-4 accent-blue-600" />
            <span>Also add to <span className="font-semibold">PO Registry</span> (queued, in litres) so profit tracking includes it</span>
          </label>
        )}

        <div>
          <label htmlFor="mv-note" className={labelCls}>Note</label>
          <input id="mv-note" value={note} onChange={e => setNote(e.target.value)} className={fieldCls} placeholder="Optional" />
        </div>

        {error && <ErrorNote>{error}</ErrorNote>}
        <button type="submit" disabled={busy} className={primaryBtn}>
          {busy && <Loader2 className="w-4 h-4 animate-spin" />} Save
        </button>
      </form>
    </PipaModal>
  );
}
