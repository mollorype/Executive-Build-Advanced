import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { PIPA_STATIONS_TABLE, type PipaStation } from "@/lib/pipa-ledger";
import PipaModal, { ErrorNote, fieldCls, labelCls, primaryBtn } from "./modal";
import { Loader2, Trash2 } from "lucide-react";

/** Add a station, or edit/delete an existing one. */
export default function StationDialog({ station, onClose, onSaved }: {
  station: PipaStation | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(station?.name ?? "");
  const [phone, setPhone] = useState(station?.phone ?? "");
  const [note, setNote] = useState(station?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Station name is required."); return; }
    setBusy(true); setError("");
    const row = { name: name.trim(), phone: phone.trim() || null, note: note.trim() || null };
    const { error: err } = station
      ? await supabase.from(PIPA_STATIONS_TABLE).update(row).eq("id", station.id)
      : await supabase.from(PIPA_STATIONS_TABLE).insert(row);
    setBusy(false);
    if (err) { setError(err.message); return; }
    onSaved();
  }

  async function remove() {
    if (!station || !window.confirm(`Delete station "${station.name}"?`)) return;
    setBusy(true); setError("");
    const { error: err } = await supabase.from(PIPA_STATIONS_TABLE).delete().eq("id", station.id);
    setBusy(false);
    if (err) {
      // 23503: movements still reference it (ON DELETE RESTRICT) — history must not lose its station.
      setError(err.code === "23503"
        ? "This station has P-P history, so it can't be deleted. Its records stay in the ledger."
        : err.message);
      return;
    }
    onSaved();
  }

  return (
    <PipaModal title={station ? "Edit station" : "Add station"} subtitle="A station you buy from, borrow from or lend to" onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <div>
          <label htmlFor="st-name" className={labelCls}>Name *</label>
          <input id="st-name" value={name} onChange={e => setName(e.target.value)} className={fieldCls} placeholder="e.g. Shwe Pyi Station" autoFocus />
        </div>
        <div>
          <label htmlFor="st-phone" className={labelCls}>Phone</label>
          <input id="st-phone" type="tel" value={phone} onChange={e => setPhone(e.target.value)} className={fieldCls} placeholder="09-…" />
        </div>
        <div>
          <label htmlFor="st-note" className={labelCls}>Note</label>
          <input id="st-note" value={note} onChange={e => setNote(e.target.value)} className={fieldCls} placeholder="Location, contact person…" />
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
        <button type="submit" disabled={busy} className={primaryBtn}>
          {busy && <Loader2 className="w-4 h-4 animate-spin" />} {station ? "Save changes" : "Add station"}
        </button>
        {station && (
          <button type="button" onClick={remove} disabled={busy}
            className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold text-pale-red-foreground hover:bg-pale-red rounded-xl py-2 transition-colors">
            <Trash2 className="w-3.5 h-3.5" /> Delete station
          </button>
        )}
      </form>
    </PipaModal>
  );
}
