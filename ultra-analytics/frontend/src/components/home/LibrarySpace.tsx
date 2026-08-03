import { useMemo, useState } from "react";
import { connectProviderUrl } from "../../api";
import type { Provider, RideSummary, UltraSuggestion } from "../../types";
import { coachFromLibrary } from "../../coach/rideCoach";
import {
  DEFAULT_LIBRARY_SORT,
  loadLibrarySort,
  saveLibrarySort,
  sortLibraryRides,
  type LibrarySortId,
} from "../../library/sort";
import RideCard from "../RideCard";
import RideCoachCard from "../review/RideCoachCard";
import LibrarySortControl from "../ui/LibrarySortControl";
import RydnMark from "../ui/RydnMark";

export function LibrarySpace({
  days,
  suggestions,
  syncing,
  connectable,
  connectedProvider,
  onSync,
  onUpload,
  onGroup,
  onSuggestGroup,
  onOpenRide,
  onDelete,
}: {
  days: RideSummary[];
  suggestions: UltraSuggestion[];
  syncing: boolean;
  connectable?: Provider;
  connectedProvider?: Provider;
  onSync: () => void;
  onUpload: () => void;
  onGroup: () => void;
  onSuggestGroup: (s: UltraSuggestion) => void;
  onOpenRide: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const topSuggest = suggestions[0];
  const [sortId, setSortId] = useState<LibrarySortId>(() => {
    if (typeof window === "undefined") return DEFAULT_LIBRARY_SORT;
    return loadLibrarySort();
  });

  const sortedDays = useMemo(() => sortLibraryRides(days, sortId), [days, sortId]);
  const coachTips = useMemo(() => coachFromLibrary(days), [days]);

  const onSortChange = (id: LibrarySortId) => {
    setSortId(id);
    saveLibrarySort(id);
  };

  return (
    <div className="space">
      <header className="space__head">
        <h1 className="space__title">Library</h1>
        <p className="space__sub">Source days from Strava or uploads — group them into a trip.</p>
        <div className="space__actions">
          {connectedProvider && (
            <button type="button" className="btn btn--strava" onClick={onSync} disabled={syncing}>
              {syncing ? "Syncing…" : `Sync ${connectedProvider.label}`}
            </button>
          )}
          {connectable && (
            <button
              type="button"
              className="btn btn--strava"
              onClick={() => {
                window.location.href = connectProviderUrl(connectable.id);
              }}
            >
              Connect {connectable.label}
            </button>
          )}
          {days.length > 0 && (
            <button type="button" className="btn btn--secondary" onClick={onGroup}>
              Group into trip
            </button>
          )}
          <button type="button" className="btn btn--tertiary" onClick={onUpload}>
            Import file
          </button>
        </div>
      </header>

      {syncing && <div className="space-loading">Syncing…</div>}

      {topSuggest && (
        <div className="suggest" role="status">
          <div className="suggest__copy">
            <p className="suggest__title">{topSuggest.label}</p>
            <p className="suggest__body">
              {topSuggest.message} ({topSuggest.count} days) — you decide whether to group them.
            </p>
          </div>
          <button type="button" className="btn btn--secondary" onClick={() => onSuggestGroup(topSuggest)}>
            Review & group
          </button>
        </div>
      )}

      {coachTips.length > 0 ? <RideCoachCard tips={coachTips} /> : null}

      {days.length === 0 ? (
        <div className="empty">
          <RydnMark size={28} className="empty__mark" />
          <h2 className="empty__title">Library is empty</h2>
          <p className="empty__body">
            Nothing to group yet. Sync Strava or upload a FIT / TCX / GPX file — source days appear here first,
            then you create multi-day trips from them.
          </p>
          <div className="empty__actions">
            {connectable && (
              <button
                type="button"
                className="btn btn--strava"
                onClick={() => {
                  window.location.href = connectProviderUrl(connectable.id);
                }}
              >
                Connect {connectable.label}
              </button>
            )}
            {connectedProvider && (
              <button type="button" className="btn btn--strava" onClick={onSync} disabled={syncing}>
                {syncing ? "Syncing…" : "Sync Strava"}
              </button>
            )}
            <button type="button" className="btn btn--tertiary" onClick={onUpload}>
              Import file
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="library-toolbar">
            <LibrarySortControl value={sortId} onChange={onSortChange} />
            <span className="library-toolbar__count">
              {sortedDays.length} day{sortedDays.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="ride-grid">
            {sortedDays.map((r) => (
              <RideCard key={r.id} ride={r} onOpen={onOpenRide} onDelete={onDelete} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
