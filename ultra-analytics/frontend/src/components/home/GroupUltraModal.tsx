import { useState } from "react";
import { createUltra } from "../../api";
import type { RideSummary } from "../../types";
import type { UltraKind } from "../../trips/kind";
import FocusLock from "../ui/FocusLock";
import ScoreLine from "../ui/ScoreLine";
import { cleanUltraTitle } from "../ui/titles";
import TripKindControl from "../ui/TripKindControl";

export function GroupUltraModal({
  rides,
  seed,
  onClose,
  onCreated,
}: {
  rides: RideSummary[];
  seed?: { activityIds?: string[]; name?: string } | null;
  onClose: () => void;
  onCreated: () => void | Promise<void>;
}) {
  const seedIds = (seed?.activityIds ?? []).filter((id) => rides.some((r) => r.id === id));

  const [name, setName] = useState(cleanUltraTitle(seed?.name?.trim() || ""));
  const [result, setResult] = useState("");
  const [kind, setKind] = useState<UltraKind>("ultra");
  const [selected, setSelected] = useState<string[]>(seedIds);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onKindChange = (next: UltraKind) => {
    setKind(next);
    if (next !== "race") setResult("");
  };

  const toggle = (id: string) => {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  const inferredYear = (() => {
    const days = rides
      .filter((r) => selected.includes(r.id))
      .map((r) => (r.date ? String(r.date).slice(0, 4) : ""))
      .filter(Boolean)
      .sort();
    return days[0] || null;
  })();

  const submit = async () => {
    if (!name.trim() || selected.length === 0) return;
    const selectedRides = rides.filter((r) => selected.includes(r.id));
    const days = selectedRides
      .map((r) => (r.date ? String(r.date).slice(0, 10) : ""))
      .filter(Boolean)
      .sort();
    setBusy(true);
    setError(null);
    try {
      await createUltra({
        name: cleanUltraTitle(name.trim()),
        activityIds: selected,
        year: inferredYear ? Number(inferredYear) : undefined,
        result: kind === "race" ? result.trim() || undefined : undefined,
        dateStart: days[0] || undefined,
        dateEnd: days[days.length - 1] || undefined,
        status: "reviewed",
        kind,
      });
      await onCreated();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <FocusLock open onClose={onClose} labelledBy="group-ultra-title" variant="sheet">
        <header className="sheet__header">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <h2 id="group-ultra-title" className="sheet__title">
            Create trip
          </h2>
          <button
            type="button"
            className="btn btn--primary sheet__save"
            disabled={busy || !name.trim() || selected.length === 0}
            onClick={() => void submit()}
          >
            {busy ? "…" : "Create"}
          </button>
        </header>

        <div className="sheet__body edit-trip">
          <label className="field">
            <span>Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="The Capitals"
              autoFocus
            />
          </label>
          <div className="field">
            <span>Type</span>
            <TripKindControl value={kind} onChange={onKindChange} />
          </div>
          {kind === "race" && (
            <label className="field">
              <span>Result</span>
              <input
                value={result}
                onChange={(e) => setResult(e.target.value)}
                placeholder="14th · Winner · DNF"
                list="create-result-suggestions"
              />
              <datalist id="create-result-suggestions">
                <option value="Winner" />
                <option value="2nd" />
                <option value="3rd" />
                <option value="DNF" />
                <option value="DNS" />
              </datalist>
            </label>
          )}
          <p className="field__hint">
            Pick the source days below. Year{inferredYear ? ` (${inferredYear})` : ""}, countries, and dates come from
            the rides.
          </p>
          <div className="group-list">
            {rides.length === 0 && <div className="space-loading">No source days in Library.</div>}
            {rides.map((r) => (
              <label key={r.id} className={`group-row${selected.includes(r.id) ? " on" : ""}`}>
                <input
                  type="checkbox"
                  checked={selected.includes(r.id)}
                  onChange={() => toggle(r.id)}
                />
                <span className="group-row__name">{r.name}</span>
                <ScoreLine
                  className="group-row__score"
                  distanceKm={r.distanceKm}
                  elevationGainM={r.elevationGainM}
                  durationS={r.durationS}
                />
              </label>
            ))}
          </div>
          {error && <div className="modal__error">{error}</div>}
        </div>

        <footer className="sheet__footer sheet__footer--mobile">
          <button
            type="button"
            className="btn btn--primary btn--block"
            disabled={busy || !name.trim() || selected.length === 0}
            onClick={() => void submit()}
          >
            {busy ? "Saving…" : `Create trip (${selected.length})`}
          </button>
        </footer>
    </FocusLock>
  );
}
