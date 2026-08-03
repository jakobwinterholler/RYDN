import { useMemo, useState } from "react";
import type { Ultra } from "../../types";
import UltraCard from "../UltraCard";
import RydnMark from "../ui/RydnMark";
import {
  countUltrasByKind,
  filterUltrasByKind,
  TRIPS_FILTER_OPTIONS,
  type TripsFilterId,
} from "../../trips/kind";
import {
  DEFAULT_TRIPS_SORT,
  groupTripsByYear,
  loadTripsSort,
  saveTripsSort,
  sortTrips,
  TRIPS_SORT_OPTIONS,
  type TripsSortId,
} from "../../trips/sort";

export function TripsSpace({
  completed,
  libraryCount,
  onOpenUltra,
  onGoLibrary,
  onGroup,
}: {
  completed: Ultra[];
  libraryCount: number;
  onOpenUltra: (id: string) => void;
  onGoLibrary: () => void;
  onGroup: () => void;
}) {
  const [filter, setFilter] = useState<TripsFilterId>("all");
  const [sortId, setSortId] = useState<TripsSortId>(() => loadTripsSort() || DEFAULT_TRIPS_SORT);

  const counts = useMemo(() => countUltrasByKind(completed), [completed]);
  const filtered = useMemo(() => filterUltrasByKind(completed, filter), [completed, filter]);
  const sorted = useMemo(() => sortTrips(filtered, sortId), [filtered, sortId]);
  const yearGroups = useMemo(
    () => (sortId === "year" && sorted.length >= 4 ? groupTripsByYear(sorted) : null),
    [sorted, sortId],
  );

  const onSortChange = (id: TripsSortId) => {
    setSortId(id);
    saveTripsSort(id);
  };

  return (
    <div className="space">
      <header className="space__head">
        <h1 className="space__title">Multi-day trips</h1>
        <p className="space__sub">Finished races, long rides, and bikepacks — your cabinet of multi-day trips.</p>
        <div className="space__actions">
          {libraryCount > 0 && (
            <button type="button" className="btn btn--secondary" onClick={onGroup}>
              Group into trip
            </button>
          )}
        </div>
      </header>

      {completed.length === 0 ? (
        <div className="empty">
          <RydnMark size={28} className="empty__mark" />
          <h2 className="empty__title">No trips yet</h2>
          <p className="empty__body">
            Sync completed rides in Library, then group related days into a multi-day trip.
          </p>
          <div className="empty__actions">
            <button type="button" className="btn btn--primary" onClick={onGoLibrary}>
              Open Library
            </button>
            {libraryCount > 0 && (
              <button type="button" className="btn btn--secondary" onClick={onGroup}>
                Group into trip
              </button>
            )}
          </div>
        </div>
      ) : (
        <section className="space__section">
          <div className="trips-toolbar">
            <div className="trips-seg" role="tablist" aria-label="Filter trips">
              {TRIPS_FILTER_OPTIONS.map((opt) => {
                const n = counts[opt.id];
                const hideEmpty = opt.id !== "all" && n === 0 && completed.length > 0;
                if (hideEmpty && filter !== opt.id) return null;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="tab"
                    aria-selected={filter === opt.id}
                    className={`trips-seg__btn${filter === opt.id ? " active" : ""}`}
                    onClick={() => setFilter(opt.id)}
                  >
                    {opt.label}
                    <span className="trips-seg__count">{n}</span>
                  </button>
                );
              })}
            </div>
            <label className="library-sort trips-sort">
              <span className="library-sort__label">Sort</span>
              <select
                className="library-sort__select"
                value={sortId}
                onChange={(e) => onSortChange(e.target.value as TripsSortId)}
                aria-label="Sort trips"
              >
                {TRIPS_SORT_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {sorted.length === 0 ? (
            <div className="empty empty--inline">
              <p className="empty__body">No trips in this filter.</p>
            </div>
          ) : (
            // Remount on filter/sort so IntersectionObservers re-attach for newly ordered cards.
            <div key={`${filter}-${sortId}`}>
              {yearGroups
                ? yearGroups.map((g) => (
                    <div key={g.year ?? "other"} className="trips-year">
                      <h2 className="trips-year__label">{g.year ?? "Other"}</h2>
                      <div className="ultra-grid">
                        {g.items.map((u) => (
                          <UltraCard key={u.id} ultra={u} onOpen={onOpenUltra} showShelfExtras />
                        ))}
                      </div>
                    </div>
                  ))
                : (
                    <div className="ultra-grid">
                      {sorted.map((u) => (
                        <UltraCard key={u.id} ultra={u} onOpen={onOpenUltra} showShelfExtras />
                      ))}
                    </div>
                  )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
