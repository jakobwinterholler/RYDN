import { useEffect, useMemo, useRef, useState } from "react";
import type { ImportProgressStats, ImportProgressUpdate, RideKind } from "../api";
import {
  connectProviderUrl,
  createUltra,
  deleteRide,
  getCabinet,
  importPlannedRouteStream,
  importRide,
  syncProvider,
} from "../api";
import type {
  Cabinet,
  PlannedRouteSummary,
  Provider,
  RideSummary,
  Ultra,
  UltraSuggestion,
  User,
} from "../types";
import AppShell, { type ShellSpace } from "./shell/AppShell";
import RideCard from "./RideCard";
import UltraCard from "./UltraCard";
import FocusLock from "./ui/FocusLock";
import LibrarySortControl from "./ui/LibrarySortControl";
import RydnLoader from "./ui/RydnLoader";
import RydnMark from "./ui/RydnMark";
import ScoreLine from "./ui/ScoreLine";
import { cleanUltraTitle } from "./ui/titles";
import {
  fileHasGpxTimestamps,
  loadImportPurpose,
  saveImportPurpose,
  type ImportPurpose,
} from "../library/importPurpose";
import {
  DEFAULT_LIBRARY_SORT,
  loadLibrarySort,
  saveLibrarySort,
  sortLibraryRides,
  type LibrarySortId,
} from "../library/sort";

interface Props {
  user: User;
  providers: Provider[];
  space?: ShellSpace;
  onSpace?: (s: ShellSpace) => void;
  onOpenRide: (id: string) => void;
  onOpenUltra: (id: string) => void;
  onOpenRoute: (id: string) => void;
  onSignOut: () => void;
  onRefreshProviders: () => Promise<void>;
  onUpdateProfile: (patch: { weightKg?: number | null }) => Promise<User>;
  bootError?: string | null;
  onDismissBootError?: () => void;
}

/** P0 shell: Ultras · Library · You. */
export default function Home({
  user,
  providers,
  space: spaceProp,
  onSpace: onSpaceProp,
  onOpenRide,
  onOpenUltra,
  onOpenRoute,
  onSignOut,
  onRefreshProviders,
  onUpdateProfile,
  bootError,
  onDismissBootError,
}: Props) {
  const [cabinet, setCabinet] = useState<Cabinet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [showGroup, setShowGroup] = useState(false);
  const [groupSeed, setGroupSeed] = useState<{
    activityIds?: string[];
    name?: string;
  } | null>(null);
  const [spaceLocal, setSpaceLocal] = useState<ShellSpace>("ultras");
  const space = spaceProp ?? spaceLocal;
  const setSpace = onSpaceProp ?? setSpaceLocal;

  const connectedProvider = providers.find((p) => p.connected);
  const connectable = providers.find((p) => p.enabled && !p.connected);

  const refresh = async () => {
    try {
      setCabinet(await getCabinet());
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const runSync = async () => {
    if (!connectedProvider) return;
    setSyncing(true);
    setError(null);
    try {
      const r = await syncProvider(connectedProvider.id);
      setNotice(
        r.added > 0
          ? `Imported ${r.added} source day${r.added === 1 ? "" : "s"} into Library.`
          : "Library is up to date.",
      );
      setSpace("library");
      await Promise.all([refresh(), onRefreshProviders()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onDeleteRide = async (id: string) => {
    const ok = window.confirm(
      "Remove this day from your Library? It will also leave any Ultra that includes it.",
    );
    if (!ok) return;
    setCabinet((c) =>
      c
        ? {
            ...c,
            ungroupedRides: c.ungroupedRides.filter((x) => x.id !== id),
            completedUltras: c.completedUltras.map((u) => ({
              ...u,
              activityIds: u.activityIds.filter((a) => a !== id),
            })),
          }
        : c,
    );
    try {
      await deleteRide(id);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      void refresh();
    }
  };

  const loading = cabinet == null;
  const completedUltras = cabinet?.completedUltras ?? [];
  const planningUltras = cabinet?.planningUltras ?? [];
  const plannedRoutes = cabinet?.plannedRoutes ?? [];
  const ungrouped = cabinet?.ungroupedRides ?? [];
  const suggestions = cabinet?.suggestions ?? [];

  const openGroup = (seed?: { activityIds?: string[]; name?: string }) => {
    setGroupSeed(seed ?? null);
    setShowGroup(true);
  };

  return (
    <AppShell user={user} space={space} onSpace={setSpace}>
      {bootError && (
        <div className="banner banner--err" role="alert">
          {bootError}
          <button
            type="button"
            className="banner__dismiss"
            onClick={() => onDismissBootError?.()}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}
      {notice && (
        <div className="banner banner--ok" role="status">
          {notice}
          <button type="button" className="banner__dismiss" onClick={() => setNotice(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
      {error && (
        <div className="banner banner--err" role="alert">
          {error}
          <button type="button" className="banner__dismiss" onClick={() => setError(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      {loading && (
        <div className="space-loading space-loading--visual">
          <RydnLoader label="Loading…" />
        </div>
      )}

      {!loading && space === "ultras" && (
        <UltrasSpace
          upcoming={planningUltras}
          completed={completedUltras}
          routes={plannedRoutes}
          libraryCount={ungrouped.length}
          onOpenUltra={onOpenUltra}
          onOpenRoute={onOpenRoute}
          onGoLibrary={() => setSpace("library")}
          onGroup={() => openGroup()}
          onImportRoute={() => setShowUpload(true)}
        />
      )}

      {!loading && space === "library" && (
        <LibrarySpace
          days={ungrouped}
          suggestions={suggestions}
          syncing={syncing}
          connectable={connectable}
          connectedProvider={connectedProvider}
          onSync={runSync}
          onUpload={() => setShowUpload(true)}
          onGroup={() => openGroup()}
          onSuggestGroup={(s) => openGroup({ activityIds: s.activityIds, name: s.label })}
          onOpenRide={onOpenRide}
          onDelete={onDeleteRide}
        />
      )}

      {!loading && space === "you" && (
        <YouSpace
          user={user}
          providers={providers}
          syncing={syncing}
          onSync={runSync}
          onUpload={() => setShowUpload(true)}
          onSignOut={onSignOut}
          onUpdateProfile={onUpdateProfile}
        />
      )}

      {showUpload && (
        <UploadModal
          onClose={() => setShowUpload(false)}
          onImportedRide={(id) => {
            setShowUpload(false);
            setNotice("Imported as completed ride — in Library.");
            setSpace("library");
            void refresh().then(() => onOpenRide(id));
          }}
          onImportedRoute={(id) => {
            setShowUpload(false);
            setNotice("Imported as planned route — in Planning.");
            setSpace("ultras");
            void refresh().then(() => onOpenRoute(id));
          }}
        />
      )}

      {showGroup && (
        <GroupUltraModal
          rides={ungrouped}
          seed={groupSeed}
          onClose={() => {
            setShowGroup(false);
            setGroupSeed(null);
          }}
          onCreated={async () => {
            setShowGroup(false);
            setGroupSeed(null);
            setSpace("ultras");
            setNotice("Ultra saved to your cabinet.");
            await refresh();
          }}
        />
      )}
    </AppShell>
  );
}

function UltrasSpace({
  upcoming,
  completed,
  routes,
  libraryCount,
  onOpenUltra,
  onOpenRoute,
  onGoLibrary,
  onGroup,
  onImportRoute,
}: {
  upcoming: Ultra[];
  completed: Ultra[];
  routes: PlannedRouteSummary[];
  libraryCount: number;
  onOpenUltra: (id: string) => void;
  onOpenRoute: (id: string) => void;
  onGoLibrary: () => void;
  onGroup: () => void;
  onImportRoute: () => void;
}) {
  const empty = upcoming.length === 0 && completed.length === 0 && routes.length === 0;

  return (
    <div className="space">
      <header className="space__head">
        <h1 className="space__title">Ultras</h1>
        <p className="space__sub">Plan upcoming expeditions, then keep finished ones in the cabinet.</p>
        <div className="space__actions">
          <button type="button" className="btn btn--secondary" onClick={onImportRoute}>
            Import GPX
          </button>
        </div>
      </header>

      {empty ? (
        <div className="empty">
          <RydnMark size={28} className="empty__mark" />
          <h2 className="empty__title">No Ultras yet</h2>
          <p className="empty__body">
            Import a planned route GPX to start planning, or sync completed rides in Library and group them
            into an Ultra.
          </p>
          <div className="empty__actions">
            <button type="button" className="btn btn--primary" onClick={onImportRoute}>
              Import planned route
            </button>
            <button type="button" className="btn btn--secondary" onClick={onGoLibrary}>
              Open Library
            </button>
            {libraryCount > 0 && (
              <button type="button" className="btn btn--tertiary" onClick={onGroup}>
                Group into Ultra
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          {(routes.length > 0 || upcoming.length > 0) && (
            <section className="space__section">
              <div className="space__section-head">
                <h2 className="space__label">Planning</h2>
              </div>
              {routes.length > 0 && (
                <div className="route-list">
                  {routes.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      className="route-card"
                      onClick={() => onOpenRoute(r.id)}
                    >
                      <div className="route-card__eyebrow">Planned route</div>
                      <div className="route-card__title">{r.name}</div>
                      <ScoreLine
                        className="route-card__score"
                        distanceKm={r.distanceKm}
                        elevationGainM={r.elevationGainM}
                        durationS={0}
                        hideDuration
                      />
                      <div className="route-card__meta">
                        {r.verificationProgress
                          ? `${r.verificationProgress.done}/${r.verificationProgress.total} verified`
                          : "Verify"}
                        {r.status === "ready" ? " · Ready" : ""}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {upcoming.length > 0 && (
                <div className="ultra-grid" style={{ marginTop: routes.length ? 16 : 0 }}>
                  {upcoming.map((u) => (
                    <UltraCard key={u.id} ultra={u} onOpen={onOpenUltra} />
                  ))}
                </div>
              )}
            </section>
          )}

          <section className="space__section">
            <div className="space__section-head">
              <h2 className="space__label">Completed</h2>
              {libraryCount > 0 && (
                <button type="button" className="btn btn--ghost" onClick={onGroup}>
                  Group into Ultra
                </button>
              )}
            </div>
            {completed.length === 0 ? (
              <p className="space__hint">Finished Ultras will live here in your cabinet.</p>
            ) : (
              <div className="ultra-grid">
                {completed.map((u) => (
                  <UltraCard key={u.id} ultra={u} onOpen={onOpenUltra} />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function LibrarySpace({
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

  const onSortChange = (id: LibrarySortId) => {
    setSortId(id);
    saveLibrarySort(id);
  };

  return (
    <div className="space">
      <header className="space__head">
        <h1 className="space__title">Library</h1>
        <p className="space__sub">Source days from Strava or uploads — group them into an Ultra.</p>
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
              Group into Ultra
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

      {days.length === 0 ? (
        <div className="empty">
          <RydnMark size={28} className="empty__mark" />
          <h2 className="empty__title">Library is empty</h2>
          <p className="empty__body">
            Nothing to group yet. Sync Strava or upload a FIT / TCX / GPX file — source days appear here first,
            then you create Ultras from them.
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

function YouSpace({
  user,
  providers,
  syncing,
  onSync,
  onUpload,
  onSignOut,
  onUpdateProfile,
}: {
  user: User;
  providers: Provider[];
  syncing: boolean;
  onSync: () => void;
  onUpload: () => void;
  onSignOut: () => void;
  onUpdateProfile: (patch: { weightKg?: number | null }) => Promise<User>;
}) {
  const connected = providers.find((p) => p.connected);
  const connectable = providers.find((p) => p.enabled && !p.connected);
  const savedWeight =
    user.weightKg != null && Number.isFinite(user.weightKg) ? String(user.weightKg) : "";
  const [weightDraft, setWeightDraft] = useState(savedWeight);
  const [weightBusy, setWeightBusy] = useState(false);
  const [weightError, setWeightError] = useState<string | null>(null);
  const [weightNotice, setWeightNotice] = useState<string | null>(null);

  useEffect(() => {
    setWeightDraft(savedWeight);
  }, [savedWeight]);

  const saveWeight = async () => {
    setWeightBusy(true);
    setWeightError(null);
    setWeightNotice(null);
    const trimmed = weightDraft.trim().replace(",", ".");
    try {
      if (!trimmed) {
        await onUpdateProfile({ weightKg: null });
        setWeightNotice("Weight cleared.");
      } else {
        const n = Number(trimmed);
        if (!Number.isFinite(n) || n < 30 || n > 200) {
          setWeightError("Enter a weight between 30 and 200 kg.");
          return;
        }
        await onUpdateProfile({ weightKg: Math.round(n * 10) / 10 });
        setWeightNotice("Weight saved — used for Avg W/kg.");
      }
    } catch (e) {
      setWeightError((e as Error).message);
    } finally {
      setWeightBusy(false);
    }
  };

  const clearWeight = async () => {
    setWeightDraft("");
    setWeightBusy(true);
    setWeightError(null);
    setWeightNotice(null);
    try {
      await onUpdateProfile({ weightKg: null });
      setWeightNotice("Weight cleared.");
    } catch (e) {
      setWeightError((e as Error).message);
    } finally {
      setWeightBusy(false);
    }
  };

  const weightDirty = weightDraft.trim() !== savedWeight;

  return (
    <div className="space space--narrow">
      <header className="space__head">
        <h1 className="space__title">You</h1>
        <p className="space__sub">Account and connections.</p>
      </header>

      <div className="you-card">
        <div className="you-card__name">{user.name}</div>
        <div className="you-card__email">{user.email}</div>
      </div>

      <section className="you-section">
        <h2 className="space__label">Body weight</h2>
        <p className="space__hint">
          Used for Avg W/kg on the shareable ride screen. Overrides Strava athlete weight when set.
        </p>
        <label className="field you-weight">
          <span>Weight (kg)</span>
          <div className="you-weight__row">
            <input
              type="number"
              inputMode="decimal"
              min={30}
              max={200}
              step={0.1}
              placeholder="e.g. 72"
              value={weightDraft}
              onChange={(e) => {
                setWeightDraft(e.target.value);
                setWeightError(null);
                setWeightNotice(null);
              }}
              disabled={weightBusy}
              aria-describedby="you-weight-hint"
            />
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => void saveWeight()}
              disabled={weightBusy || !weightDirty}
            >
              {weightBusy ? "Saving…" : "Save"}
            </button>
            {savedWeight ? (
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => void clearWeight()}
                disabled={weightBusy}
              >
                Clear
              </button>
            ) : null}
          </div>
        </label>
        <p id="you-weight-hint" className="field__hint">
          {savedWeight
            ? `Current: ${savedWeight} kg`
            : "Not set — W/kg uses Strava weight when available."}
        </p>
        {weightError ? <p className="you-weight__error">{weightError}</p> : null}
        {weightNotice ? <p className="space__hint">{weightNotice}</p> : null}
      </section>

      <section className="you-section">
        <h2 className="space__label">Connections</h2>
        {connected ? (
          <div className="you-row">
            <div>
              <div className="you-row__title">{connected.label}</div>
              <div className="you-row__meta">Connected</div>
            </div>
            <button type="button" className="btn btn--strava" onClick={onSync} disabled={syncing}>
              {syncing ? "Syncing…" : "Sync"}
            </button>
          </div>
        ) : connectable ? (
          <div className="you-row">
            <div>
              <div className="you-row__title">{connectable.label}</div>
              <div className="you-row__meta">Not connected</div>
            </div>
            <button
              type="button"
              className="btn btn--strava"
              onClick={() => {
                window.location.href = connectProviderUrl(connectable.id);
              }}
            >
              Connect
            </button>
          </div>
        ) : (
          <p className="space__hint">No ride providers configured.</p>
        )}
      </section>

      <section className="you-section">
        <h2 className="space__label">Files</h2>
        <button type="button" className="btn btn--tertiary" onClick={onUpload}>
          Import file
        </button>
      </section>

      <section className="you-section">
        <button type="button" className="btn btn--ghost" onClick={onSignOut}>
          Sign out
        </button>
      </section>
    </div>
  );
}

function GroupUltraModal({
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
  const [selected, setSelected] = useState<string[]>(seedIds);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        result: result.trim() || undefined,
        dateStart: days[0] || undefined,
        dateEnd: days[days.length - 1] || undefined,
        status: "reviewed",
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
            Create Ultra
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

        <div className="sheet__body">
          <p className="modal__lead">
            Choose source days and a name. Year{inferredYear ? ` (${inferredYear})` : ""}, countries, and dates come
            from the rides.
          </p>
          <label className="field">
            <span>Ultra name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="The Capitals"
              autoFocus
            />
          </label>
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
            {busy ? "Saving…" : `Create Ultra (${selected.length})`}
          </button>
        </footer>
    </FocusLock>
  );
}

type ImportPhase = "idle" | "working" | "success" | "error";

const COMPLETED_STAGES: { label: string; pct: number }[] = [
  { label: "Uploading files", pct: 12 },
  { label: "Parsing activity", pct: 38 },
  { label: "Computing metrics", pct: 68 },
  { label: "Saving ride", pct: 88 },
];

function formatImportElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}:${String(r).padStart(2, "0")}` : `${r}s`;
}

function ImportLiveStats({ stats }: { stats: ImportProgressStats }) {
  const items: { key: string; label: string; ready: boolean }[] = [
    {
      key: "distance",
      label:
        stats.distanceKm != null
          ? `${Number(stats.distanceKm).toFixed(Number(stats.distanceKm) >= 100 ? 0 : 1)} km`
          : "Distance",
      ready: stats.distanceKm != null,
    },
    {
      key: "elev",
      label:
        stats.elevationGainM != null
          ? `${Math.round(Number(stats.elevationGainM)).toLocaleString("en-US")} m elev`
          : "Elevation",
      ready: stats.elevationGainM != null,
    },
    {
      key: "climbs",
      label:
        stats.climbCount != null
          ? `${stats.climbCount} climb${stats.climbCount === 1 ? "" : "s"}`
          : "Climbs",
      ready: stats.climbCount != null,
    },
    {
      key: "stops",
      label:
        stats.recommendedStopCount != null
          ? `${stats.recommendedStopCount} stop${stats.recommendedStopCount === 1 ? "" : "s"}`
          : stats.waterCount != null
            ? `${stats.waterCount} water`
            : "Stops",
      ready: stats.recommendedStopCount != null || stats.waterCount != null,
    },
    {
      key: "remote",
      label:
        stats.remoteGapCount != null
          ? `${stats.remoteGapCount} remote`
          : "Remote",
      ready: stats.remoteGapCount != null,
    },
    {
      key: "stages",
      label:
        stats.stageCount != null
          ? `${stats.stageCount} stage${stats.stageCount === 1 ? "" : "s"}`
          : "Stages",
      ready: stats.stageCount != null,
    },
  ];

  const visible = items.filter((i) => i.ready);
  if (visible.length === 0) return null;

  return (
    <ul className="import-progress__stats" aria-live="polite">
      {visible.map((item) => (
        <li key={item.key} className="import-progress__stat">
          <span className="import-progress__check" aria-hidden>
            ✓
          </span>
          {item.label}
        </li>
      ))}
    </ul>
  );
}

function UploadModal({
  onClose,
  onImportedRide,
  onImportedRoute,
}: {
  onClose: () => void;
  onImportedRide: (id: string) => void;
  onImportedRoute: (id: string) => void;
}) {
  const [purpose, setPurpose] = useState<ImportPurpose>(() => loadImportPurpose());
  const [kind, setKind] = useState<RideKind>("training");
  const [drag, setDrag] = useState(false);
  const [phase, setPhase] = useState<ImportPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [label, setLabel] = useState("Preparing…");
  const [pct, setPct] = useState(0);
  const [stats, setStats] = useState<ImportProgressStats>({});
  const [elapsedMs, setElapsedMs] = useState(0);
  const [fileLabel, setFileLabel] = useState<string | null>(null);
  const [lastFiles, setLastFiles] = useState<File[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const startedAtRef = useRef<number>(0);
  const successTimerRef = useRef<number | null>(null);
  const rideStageTimerRef = useRef<number | null>(null);
  const busy = phase === "working" || phase === "success";

  useEffect(() => {
    return () => {
      if (successTimerRef.current != null) window.clearTimeout(successTimerRef.current);
      if (rideStageTimerRef.current != null) window.clearInterval(rideStageTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (phase !== "working") return;
    startedAtRef.current = Date.now();
    setElapsedMs(0);
    const id = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAtRef.current);
    }, 400);
    return () => window.clearInterval(id);
  }, [phase]);

  const choosePurpose = (next: ImportPurpose) => {
    if (busy) return;
    setPurpose(next);
    saveImportPurpose(next);
    setError(null);
    setHint(null);
    setPhase("idle");
  };

  const applyProgress = (update: ImportProgressUpdate) => {
    setLabel(update.label);
    setPct(update.pct);
    if (update.stats) setStats((prev) => ({ ...prev, ...update.stats }));
  };

  const finishSuccess = (navigate: () => void) => {
    setPhase("success");
    setPct(100);
    setLabel("Route imported successfully");
    successTimerRef.current = window.setTimeout(() => {
      navigate();
    }, 1000);
  };

  const submit = async (files: File[]) => {
    if (files.length === 0 || busy) return;
    setLastFiles(files);
    setPhase("working");
    setError(null);
    setHint(null);
    setStats({});
    setPct(purpose === "planned" ? 2 : 8);
    setLabel(purpose === "planned" ? "Uploading GPX" : "Uploading files");
    setFileLabel(
      files.length === 1
        ? files[0].name
        : `${files.length} files · ${files[0]?.name || "selection"}`,
    );

    try {
      if (purpose === "planned") {
        const gpx = files.find((f) => (f.name || "").toLowerCase().endsWith(".gpx"));
        if (!gpx) {
          throw new Error("Planned routes need a GPX file.");
        }
        setFileLabel(gpx.name);
        const s = await importPlannedRouteStream(gpx, undefined, applyProgress);
        finishSuccess(() => onImportedRoute(s.id));
        return;
      }

      // Completed ride — if a lone GPX has no timestamps, steer to Planned.
      if (files.length === 1 && (files[0].name || "").toLowerCase().endsWith(".gpx")) {
        const timed = await fileHasGpxTimestamps(files[0]);
        if (!timed) {
          setPhase("idle");
          setPurpose("planned");
          saveImportPurpose("planned");
          setHint(
            "This GPX has no timestamps, so it cannot be a completed ride. Switched to Planned Route — import again to continue.",
          );
          return;
        }
      }

      let stageIdx = 0;
      setLabel(COMPLETED_STAGES[0].label);
      setPct(COMPLETED_STAGES[0].pct);
      rideStageTimerRef.current = window.setInterval(() => {
        stageIdx = Math.min(stageIdx + 1, COMPLETED_STAGES.length - 1);
        const stage = COMPLETED_STAGES[stageIdx];
        setLabel(stage.label);
        setPct((p) => Math.max(p, stage.pct));
      }, 900);

      const s = await importRide(kind, files);
      if (rideStageTimerRef.current != null) {
        window.clearInterval(rideStageTimerRef.current);
        rideStageTimerRef.current = null;
      }
      setLabel("Ride imported successfully");
      setPct(100);
      setPhase("success");
      successTimerRef.current = window.setTimeout(() => {
        onImportedRide(s.id);
      }, 900);
    } catch (e) {
      if (rideStageTimerRef.current != null) {
        window.clearInterval(rideStageTimerRef.current);
        rideStageTimerRef.current = null;
      }
      setError((e as Error).message || "Import failed. Try again.");
      setPhase("error");
    }
  };

  const accept = purpose === "planned" ? ".gpx" : ".fit,.tcx,.gpx";
  const barClass =
    phase === "working" && pct < 98
      ? "import-progress__bar import-progress__bar--live"
      : "import-progress__bar";

  return (
    <FocusLock
      open
      onClose={busy ? () => undefined : onClose}
      labelledBy="upload-title"
      variant="modal"
    >
      <div className="modal__head">
        <h2 id="upload-title">Import</h2>
        <button
          type="button"
          className="modal__x"
          onClick={onClose}
          aria-label="Close"
          disabled={busy}
        >
          ×
        </button>
      </div>

      <div className="kind-toggle" role="group" aria-label="Import as">
        <button
          type="button"
          className={purpose === "planned" ? "active" : ""}
          onClick={() => choosePurpose("planned")}
          disabled={busy}
        >
          Planned Route
        </button>
        <button
          type="button"
          className={purpose === "completed" ? "active" : ""}
          onClick={() => choosePurpose("completed")}
          disabled={busy}
        >
          Completed Ride
        </button>
      </div>

      {purpose === "planned" ? (
        <p className="modal__lead">
          Course GPX for planning and verification. Never enters the Ride Library or analytics.
        </p>
      ) : (
        <>
          <p className="modal__lead">
            Finished activity from Strava export, Garmin, FIT, TCX, or timed GPX — goes to Library.
          </p>
          <div className="kind-toggle kind-toggle--secondary" role="group" aria-label="Ride type">
            <button
              type="button"
              className={kind === "training" ? "active" : ""}
              onClick={() => setKind("training")}
              disabled={busy}
            >
              Training
            </button>
            <button
              type="button"
              className={kind === "race" ? "active" : ""}
              onClick={() => setKind("race")}
              disabled={busy}
            >
              Ultra race
            </button>
          </div>
        </>
      )}

      {phase === "idle" || phase === "error" ? (
        <div
          className={`dropzone${drag ? " drag" : ""}${phase === "error" ? " dropzone--error" : ""}`}
          onClick={() => {
            if (!busy) inputRef.current?.click();
          }}
          onDragOver={(e) => {
            e.preventDefault();
            if (!busy) setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            if (!busy) void submit(Array.from(e.dataTransfer.files));
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (!busy) inputRef.current?.click();
            }
          }}
        >
          <div className="dropzone__icon">＋</div>
          <div className="dropzone__title">Drop files here, or click to choose</div>
          <div className="dropzone__sub">
            {purpose === "planned"
              ? "GPX course file · becomes a Planned Route"
              : "FIT · TCX · GPX · becomes a Ride in Library"}
          </div>
          <input
            ref={inputRef}
            type="file"
            multiple={purpose === "completed"}
            accept={accept}
            hidden
            disabled={busy}
            onChange={(e) => {
              const list = Array.from(e.target.files ?? []);
              e.target.value = "";
              void submit(list);
            }}
          />
        </div>
      ) : (
        <div
          className={`import-progress${phase === "success" ? " import-progress--success" : ""}`}
          aria-live="polite"
          aria-busy={phase === "working"}
        >
          {fileLabel && <div className="import-progress__file">{fileLabel}</div>}
          <div className="import-progress__track">
            <div
              className={barClass}
              style={{ width: `${Math.max(phase === "success" ? 100 : 4, Math.min(100, pct))}%` }}
            />
          </div>
          <div className="import-progress__row">
            {phase === "working" ? (
              <span className="import-progress__spinner" aria-hidden />
            ) : (
              <span className="import-progress__done" aria-hidden>
                ✓
              </span>
            )}
            <div className="import-progress__copy">
              <div className="import-progress__label">
                {phase === "success"
                  ? purpose === "planned"
                    ? "Route imported successfully"
                    : "Ride imported successfully"
                  : label}
              </div>
              {phase === "working" && (
                <div className="import-progress__meta">
                  <span>{Math.round(pct)}%</span>
                  <span aria-hidden>·</span>
                  <span>{formatImportElapsed(elapsedMs)}</span>
                </div>
              )}
            </div>
          </div>
          {purpose === "planned" && <ImportLiveStats stats={stats} />}
        </div>
      )}

      {hint && <div className="modal__hint">{hint}</div>}
      {error && phase === "error" && (
        <div className="import-error">
          <div className="modal__error">{error}</div>
          <button
            type="button"
            className="btn btn--ghost import-error__retry"
            onClick={() => void submit(lastFiles)}
            disabled={lastFiles.length === 0}
          >
            Retry
          </button>
        </div>
      )}
    </FocusLock>
  );
}
