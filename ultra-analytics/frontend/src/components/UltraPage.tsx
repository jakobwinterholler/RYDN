import { useCallback, useEffect, useMemo, useRef, useState, type TouchEvent } from "react";
import { getUltra, patchUltra, deleteUltra } from "../api";
import type { RideSummary, Ultra, UltraDetail, UltraDay } from "../types";
import { flagFromCode, parseCountryCodes } from "./ui/countries";
import { fmtDate } from "./ui/format";
import FocusLock from "./ui/FocusLock";
import Icon from "./ui/Icon";
import RoutePreview from "./ui/RoutePreview";
import RydnLoader from "./ui/RydnLoader";
import ScoreLine, { fmtElapsed } from "./ui/ScoreLine";
import UltraElevProfile from "./ui/UltraElevProfile";
import { cleanDayTitle, cleanUltraTitle } from "./ui/titles";

/** Opening choreography: hold pre-draw → play after map paints (each Ultra mount). */
type IntroReveal = "hold" | "play" | false;

interface Props {
  ultraId: string;
  onBack: () => void;
  onOpenRide: (rideId: string) => void;
  onOpenAnalytics: () => void;
  onDeleted?: () => void;
}

function countryCodesOf(ultra: Ultra): string[] {
  if (ultra.countryCodes?.length) {
    return ultra.countryCodes.map((c) => c.toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c));
  }
  if (ultra.countryCode && /^[A-Za-z]{2}$/.test(ultra.countryCode)) {
    return [ultra.countryCode.toUpperCase()];
  }
  return [];
}

function dayKey(iso: string | null | undefined): string {
  return iso ? String(iso).slice(0, 10) : "";
}

function inRange(iso: string | null | undefined, start: string, end: string): boolean {
  const d = dayKey(iso);
  if (!d) return false;
  if (start && d < start) return false;
  if (end && d > end) return false;
  return true;
}

function fmtRange(start?: string | null, end?: string | null): string | null {
  if (!start && !end) return null;
  if (start && end && start !== end) {
    return `${fmtDate(start)} – ${fmtDate(end)}`;
  }
  return fmtDate(start || end || null);
}

export default function UltraPage({ ultraId, onBack, onOpenRide, onOpenAnalytics, onDeleted }: Props) {
  const [detail, setDetail] = useState<UltraDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  /** hold → play after map paint so the ~900ms open sequence is visible. */
  const [introReveal, setIntroReveal] = useState<IntroReveal>(() =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? false
      : "hold",
  );
  const introStarted = useRef(false);
  const introRaf = useRef<number[]>([]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setDetail(null);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setIntroReveal(reduced ? false : "hold");
    introStarted.current = false;
    introRaf.current.forEach((id) => cancelAnimationFrame(id));
    introRaf.current = [];
    getUltra(ultraId)
      .then((d) => !cancelled && setDetail(d))
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
      introRaf.current.forEach((id) => cancelAnimationFrame(id));
      introRaf.current = [];
    };
  }, [ultraId]);

  const startIntroReveal = useCallback(() => {
    if (introStarted.current) return;
    introStarted.current = true;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setIntroReveal(false);
      return;
    }
    // Double rAF: commit hold pose, paint, then start CSS draw so it isn't finished pre-paint.
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => setIntroReveal("play"));
      introRaf.current.push(raf2);
    });
    introRaf.current.push(raf1);
  }, []);

  const saveIds = async (activityIds: string[], opts?: { orderManual?: boolean }) => {
    setBusy(true);
    setError(null);
    try {
      setDetail(
        await patchUltra(ultraId, {
          activityIds,
          ...(opts?.orderManual ? { activityOrderManual: true } : {}),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const removeDay = async (day: UltraDay) => {
    if (!detail) return;
    const block = day.activityIds?.length ? day.activityIds : [day.id];
    const n = block.length;
    const ok = window.confirm(
      n > 1
        ? `Remove this day (${n} ride recordings) from the Ultra? The rides stay in your Library.`
        : "Remove this day from the Ultra? The ride stays in your Library.",
    );
    if (!ok) return;
    const drop = new Set(block);
    const next = detail.ultra.activityIds.filter((id) => !drop.has(id));
    await saveIds(next);
  };

  const moveDay = async (day: UltraDay, dir: -1 | 1) => {
    if (!detail) return;
    const blocks = detail.days.map((d) => (d.activityIds?.length ? d.activityIds : [d.id]));
    const i = day.dayIndex - 1;
    const j = i + dir;
    if (i < 0 || j < 0 || j >= blocks.length) return;
    [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
    await saveIds(blocks.flat(), { orderManual: true });
  };

  if (error && !detail) {
    return (
      <div className="ultra-page">
        <header className="ultra-page__nav">
          <button type="button" className="icon-btn" onClick={onBack} aria-label="Back">
            <Icon name="chevronLeft" size={22} />
          </button>
        </header>
        <div className="space-loading">{error}</div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="app-loading">
        <RydnLoader label="Opening Ultra…" />
      </div>
    );
  }

  const { ultra, days, route, library } = detail;
  const codes = countryCodesOf(ultra);
  const flags = codes.map(flagFromCode).filter(Boolean);
  const finished = ultra.area !== "planning";
  const rangeLabel = fmtRange(ultra.dateStart, ultra.dateEnd);
  const result = (ultra.result || ultra.finishPlace || "").trim();
  const mark = finished ? "trophy" : "mountain";
  const title = cleanUltraTitle(ultra.name);

  return (
    <div className="ultra-page">
      <header className="ultra-page__nav">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="Back to Ultras">
          <Icon name="chevronLeft" size={22} />
        </button>
        <button type="button" className="btn btn--ghost ultra-page__edit" onClick={() => setEditOpen(true)}>
          <Icon name="edit" size={18} />
          Edit
        </button>
      </header>

      {error && (
        <div className="banner banner--err" role="alert">
          {error}
          <button type="button" className="banner__dismiss" onClick={() => setError(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      <div className="ultra-page__hero">
        <div className="ultra-page__topline">
          <div className="ultra-page__identity">
            <span className="ultra-page__mark" aria-hidden="true">
              <Icon name={mark} size={18} weight="medium" />
            </span>
            {ultra.year ? <span className="ultra-page__year">{ultra.year}</span> : null}
          </div>
          {finished && (
            <span className="ultra-card__done" title="Completed" aria-label="Completed">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <circle cx="7" cy="7" r="6.25" stroke="currentColor" strokeWidth="1.25" />
                <path
                  d="M4.1 7.15L6.05 9.05L9.9 4.9"
                  stroke="currentColor"
                  strokeWidth="1.35"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          )}
        </div>
        <h1 className="ultra-page__title">{title}</h1>
        {(flags.length > 0 || result) && (
          <div className="ultra-page__sub">
            {flags.length > 0 && (
              <div className="ultra-card__flags" aria-label={`Countries: ${codes.join(", ")}`}>
                {flags.map((f, i) => (
                  <span key={codes[i]} className="ultra-card__flag">
                    {f}
                  </span>
                ))}
              </div>
            )}
            {result && <span className="ultra-page__result">{result}</span>}
          </div>
        )}
        {rangeLabel && <p className="ultra-page__range">{rangeLabel}</p>}
      </div>

      <div className="ultra-page__certificate">
        <RoutePreview
          className="ultra-page__map"
          points={route.points}
          segments={route.segments}
          reveal={introReveal}
          onReady={startIntroReveal}
        />

        {route.elevation &&
        route.elevation.axisKm.length >= 2 &&
        route.elevation.elevationM.length >= 2 ? (
          <UltraElevProfile
            axisKm={route.elevation.axisKm}
            elevationM={route.elevation.elevationM}
            sleep={route.sleep}
            reveal={introReveal}
          />
        ) : null}

        <div className="ultra-page__score">
          <ScoreLine
            distanceKm={ultra.distanceKm}
            elevationGainM={ultra.elevationGainM}
            durationS={ultra.durationS}
            showNp
            npW={ultra.npW}
          />
          {(ultra.rideElapsedTimeS != null || ultra.movingTimeS != null) && (
            <p className="ultra-page__time-breakdown" aria-label="Ride elapsed and moving time">
              {ultra.rideElapsedTimeS != null && ultra.rideElapsedTimeS > 0 && (
                <span>Ride elapsed {fmtElapsed(ultra.rideElapsedTimeS)}</span>
              )}
              {ultra.rideElapsedTimeS != null &&
                ultra.rideElapsedTimeS > 0 &&
                ultra.movingTimeS != null &&
                ultra.movingTimeS > 0 && (
                  <span className="ultra-page__time-sep" aria-hidden>
                    ·
                  </span>
                )}
              {ultra.movingTimeS != null && ultra.movingTimeS > 0 && (
                <span>Moving {fmtElapsed(ultra.movingTimeS)}</span>
              )}
            </p>
          )}
        </div>

        <button type="button" className="ultra-analytics-link" onClick={onOpenAnalytics}>
          <span>See Ultra Analytics</span>
          <Icon name="chevronRight" size={18} />
        </button>
      </div>

      <section className="ultra-page__days">
        <div className="ultra-page__days-head">
          <h2 className="space__label">Days</h2>
          <button type="button" className="btn btn--secondary" onClick={() => setAddOpen(true)} disabled={busy}>
            <Icon name="plus" size={18} />
            Add rides
          </button>
        </div>

        {days.length === 0 ? (
          <div className="empty empty--compact">
            <p className="empty__body">
              This Ultra has no days yet. Open Library, select related source rides, and add them here —
              then Overview and Analytics unlock.
            </p>
            <button type="button" className="btn btn--primary" onClick={() => setAddOpen(true)}>
              Add rides
            </button>
          </div>
        ) : (
          <ul className="day-list">
            {days.map((day) => {
              const partIds = day.activityIds?.length ? day.activityIds : [day.id];
              return (
              <DayRow
                key={`day-${day.dayIndex}-${partIds.join("-")}`}
                day={day}
                canUp={day.dayIndex > 1}
                canDown={day.dayIndex < days.length}
                busy={busy}
                onOpenRide={onOpenRide}
                onRemove={() => void removeDay(day)}
                onUp={() => void moveDay(day, -1)}
                onDown={() => void moveDay(day, 1)}
              />
              );
            })}
          </ul>
        )}
      </section>

      {editOpen && (
        <EditUltraSheet
          ultra={ultra}
          onClose={() => setEditOpen(false)}
          onSaved={async (d) => {
            setDetail(d);
            setEditOpen(false);
          }}
          onDeleted={() => {
            setEditOpen(false);
            (onDeleted || onBack)();
          }}
        />
      )}

      {addOpen && (
        <AddRidesSheet
          ultra={ultra}
          library={library}
          busy={busy}
          onClose={() => setAddOpen(false)}
          onSave={async (idsToAdd) => {
            const merged = [...ultra.activityIds];
            for (const id of idsToAdd) {
              if (!merged.includes(id)) merged.push(id);
            }
            await saveIds(merged);
            setAddOpen(false);
          }}
        />
      )}
    </div>
  );
}

function DayRow({
  day,
  canUp,
  canDown,
  busy,
  onOpenRide,
  onRemove,
  onUp,
  onDown,
}: {
  day: UltraDay;
  canUp: boolean;
  canDown: boolean;
  busy: boolean;
  onOpenRide: (rideId: string) => void;
  onRemove: () => void;
  onUp: () => void;
  onDown: () => void;
}) {
  const startX = useRef<number | null>(null);
  const [dx, setDx] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const recordingCount = day.recordingCount ?? day.activityIds?.length ?? 1;
  const hasMultiple = recordingCount > 1;

  const onTouchStart = (e: TouchEvent) => {
    startX.current = e.touches[0].clientX;
    setDx(0);
  };
  const onTouchMove = (e: TouchEvent) => {
    if (startX.current == null) return;
    setDx(Math.min(0, e.touches[0].clientX - startX.current));
  };
  const onTouchEnd = () => {
    if (dx < -72) onRemove();
    startX.current = null;
    setDx(0);
  };

  return (
    <li className="day-row-block">
      <div className="day-row-wrap">
        <div className="day-row__reveal" aria-hidden="true">
          Remove
        </div>
        <div
          className="day-row"
          style={{ transform: `translateX(${dx}px)` }}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          <button type="button" className="day-row__main" onClick={() => onOpenRide(day.id)}>
            <span className="day-row__day">Day {day.dayIndex}</span>
            <span className="day-row__name">{cleanDayTitle(day.name)}</span>
            <span className="day-row__meta">
              {fmtDate(day.date)}
              <ScoreLine
                className="day-row__score"
                distanceKm={day.distanceKm}
                elevationGainM={day.elevationGainM}
                durationS={day.durationS}
              />
              {hasMultiple && (
                <span className="day-row__recordings">
                  Built from {recordingCount} ride recordings
                </span>
              )}
            </span>
          </button>
          <div className="day-row__actions">
            {hasMultiple && (
              <button
                type="button"
                className="icon-btn"
                disabled={busy}
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
                aria-label={expanded ? "Hide recordings" : "Show recordings"}
              >
                <Icon name={expanded ? "chevronLeft" : "chevronRight"} size={18} className="icon--rotate-90" />
              </button>
            )}
            <button type="button" className="icon-btn" disabled={!canUp || busy} onClick={onUp} aria-label="Move up">
              <Icon name="chevronLeft" size={18} className="icon--rotate-90" />
            </button>
            <button
              type="button"
              className="icon-btn"
              disabled={!canDown || busy}
              onClick={onDown}
              aria-label="Move down"
            >
              <Icon name="chevronRight" size={18} className="icon--rotate-90" />
            </button>
            <button type="button" className="icon-btn icon-btn--danger" disabled={busy} onClick={onRemove} aria-label="Remove from Ultra">
              <Icon name="minus" size={18} />
            </button>
          </div>
        </div>
      </div>
      {expanded && hasMultiple && (
        <ul className="day-row__parts">
          {(day.recordings || []).map((rec, i) => (
            <li key={rec.id}>
              <button type="button" className="day-row__part" onClick={() => onOpenRide(rec.id)}>
                <span className="day-row__part-label">Recording {i + 1}</span>
                <span className="day-row__part-name">{rec.name}</span>
                <ScoreLine
                  className="day-row__score"
                  distanceKm={rec.distanceKm}
                  elevationGainM={rec.elevationGainM}
                  durationS={rec.durationS}
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function EditUltraSheet({
  ultra,
  onClose,
  onSaved,
  onDeleted,
}: {
  ultra: Ultra;
  onClose: () => void;
  onSaved: (d: UltraDetail) => void | Promise<void>;
  onDeleted: () => void;
}) {
  const [name, setName] = useState(cleanUltraTitle(ultra.name));
  const [result, setResult] = useState((ultra.result || ultra.finishPlace || "").trim());
  const [countries, setCountries] = useState((ultra.countryCodes || []).join(", "));
  const [countriesTouched, setCountriesTouched] = useState(false);
  const [dateStart, setDateStart] = useState(ultra.dateStart || "");
  const [dateEnd, setDateEnd] = useState(ultra.dateEnd || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const body: Parameters<typeof patchUltra>[1] = {
        name: cleanUltraTitle(name.trim()),
        result: result.trim() || null,
        dateStart: dateStart || null,
        dateEnd: dateEnd || null,
      };
      if (countriesTouched) {
        body.countryCodes = parseCountryCodes(countries);
        body.countriesManual = true;
      }
      const d = await patchUltra(ultra.id, body);
      await onSaved(d);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const remove = async () => {
    const ok = window.confirm(
      "Delete this Ultra? Source days stay in your Library — only the collection is removed.",
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await deleteUltra(ultra.id);
      onDeleted();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const autoHint = ultra.countriesManual
    ? "Edited manually — save to keep your override."
    : countries
      ? "Detected from GPS. Edit only if wrong."
      : "Will detect from GPS when rides have tracks.";

  return (
    <FocusLock open onClose={onClose} labelledBy="edit-ultra-title" variant="sheet">
        <header className="sheet__header">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <h2 id="edit-ultra-title" className="sheet__title">
            Edit Ultra
          </h2>
          <button
            type="button"
            className="btn btn--primary sheet__save"
            disabled={busy || !name.trim()}
            onClick={() => void submit()}
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </header>

        <div className="sheet__body">
          <p className="modal__lead">
            Year {ultra.year ?? "—"} comes from your rides. Change only what software cannot know.
          </p>

          <label className="field">
            <span>Ultra name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus enterKeyHint="done" />
          </label>

          <label className="field">
            <span>Result</span>
            <input
              value={result}
              onChange={(e) => setResult(e.target.value)}
              placeholder="14th · Winner · DNF"
              list="ultra-result-suggestions"
            />
            <datalist id="ultra-result-suggestions">
              <option value="Winner" />
              <option value="2nd" />
              <option value="3rd" />
              <option value="DNF" />
              <option value="DNS" />
            </datalist>
          </label>

          <label className="field">
            <span>Countries</span>
            <input
              value={countries}
              onChange={(e) => {
                setCountries(e.target.value);
                setCountriesTouched(true);
              }}
              placeholder="ES, FR"
            />
            <span className="field__hint">{autoHint}</span>
          </label>

          <div className="field-row">
            <label className="field">
              <span>From</span>
              <input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} />
            </label>
            <label className="field">
              <span>To</span>
              <input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} />
            </label>
          </div>
          <p className="field__hint">Dates update automatically when you add or remove rides.</p>

          {error && <div className="modal__error">{error}</div>}

          <button
            type="button"
            className="btn btn--ghost"
            style={{ color: "var(--danger)", marginTop: 24 }}
            disabled={busy}
            onClick={() => void remove()}
          >
            Delete Ultra
          </button>
        </div>

        <footer className="sheet__footer sheet__footer--mobile">
          <button
            type="button"
            className="btn btn--primary btn--block"
            disabled={busy || !name.trim()}
            onClick={() => void submit()}
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </footer>
    </FocusLock>
  );
}

function AddRidesSheet({
  ultra,
  library,
  busy,
  onClose,
  onSave,
}: {
  ultra: Ultra;
  library: RideSummary[];
  busy: boolean;
  onClose: () => void;
  onSave: (idsToAdd: string[]) => void | Promise<void>;
}) {
  const defaultStart = ultra.dateStart || dayKey(ultra.date) || "";
  const defaultEnd = ultra.dateEnd || ultra.dateStart || dayKey(ultra.date) || "";
  const [query, setQuery] = useState("");
  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(defaultEnd);
  const [showAll, setShowAll] = useState(!defaultStart && !defaultEnd);
  const [picked, setPicked] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return library.filter((r) => {
      if (!showAll && (start || end) && !inRange(r.date, start, end)) return false;
      if (q && !(r.name || "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [library, query, showAll, start, end]);

  const toggle = (id: string) => {
    setPicked((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  const submit = async () => {
    if (picked.length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      await onSave(picked);
    } finally {
      setSaving(false);
    }
  };

  return (
    <FocusLock open onClose={onClose} labelledBy="add-rides-title" variant="sheet">
        <header className="sheet__header">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <h2 id="add-rides-title" className="sheet__title">
            Add rides
          </h2>
          <button
            type="button"
            className="btn btn--primary sheet__save"
            disabled={saving || busy || picked.length === 0}
            onClick={() => void submit()}
          >
            {saving ? "…" : picked.length ? `Add ${picked.length}` : "Add"}
          </button>
        </header>

        <div className="sheet__body">
          <p className="modal__lead">Library days within this Ultra’s dates — tap to add.</p>

          <label className="field field--search">
            <Icon name="search" size={18} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search Library"
              enterKeyHint="search"
            />
          </label>

          <div className="field-row">
            <label className="field">
              <span>From</span>
              <input
                type="date"
                value={start}
                onChange={(e) => {
                  setStart(e.target.value);
                  setShowAll(false);
                }}
              />
            </label>
            <label className="field">
              <span>To</span>
              <input
                type="date"
                value={end}
                onChange={(e) => {
                  setEnd(e.target.value);
                  setShowAll(false);
                }}
              />
            </label>
          </div>

          <div className="add-rides__filters">
            <button type="button" className={`chip${showAll ? "" : " is-on"}`} onClick={() => setShowAll(false)}>
              Ultra dates
            </button>
            <button type="button" className={`chip${showAll ? " is-on" : ""}`} onClick={() => setShowAll(true)}>
              All Library
            </button>
          </div>

          <div className="pick-list">
            {filtered.length === 0 && <div className="space-loading">No matching rides.</div>}
            {filtered.map((r) => {
              const on = picked.includes(r.id);
              return (
                <button
                  key={r.id}
                  type="button"
                  className={`pick-row${on ? " on" : ""}`}
                  onClick={() => toggle(r.id)}
                >
                  <span className={`pick-row__check${on ? " is-on" : ""}`} aria-hidden="true">
                    {on ? <Icon name="check" size={16} /> : null}
                  </span>
                  <span className="pick-row__body">
                    <span className="pick-row__name">{r.name}</span>
                    <span className="pick-row__meta">{fmtDate(r.date)}</span>
                    <ScoreLine distanceKm={r.distanceKm} elevationGainM={r.elevationGainM} durationS={r.durationS} />
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <footer className="sheet__footer sheet__footer--mobile">
          <button
            type="button"
            className="btn btn--primary btn--block"
            disabled={saving || busy || picked.length === 0}
            onClick={() => void submit()}
          >
            {saving ? "Saving…" : `Add ${picked.length || ""} ride${picked.length === 1 ? "" : "s"}`.trim()}
          </button>
        </footer>
    </FocusLock>
  );
}
