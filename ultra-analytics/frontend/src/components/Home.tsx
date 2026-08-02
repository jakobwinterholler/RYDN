import { useEffect, useMemo, useRef, useState } from "react";
import type { ImportProgressStats, ImportProgressUpdate, RedeemResult, RideKind } from "../api";
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
import { canImportPlannedRoute, tierFromUser, tierLabel } from "../subscription/features";
import { hasSeenOnboarding } from "../onboarding/persistence";
import type { OnboardingDest } from "../onboarding/steps";
import ProGate from "./account/ProGate";
import Onboarding from "./onboarding/Onboarding";
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
import {
  countUltrasByKind,
  filterUltrasByKind,
  TRIPS_FILTER_OPTIONS,
  type TripsFilterId,
  type UltraKind,
} from "../trips/kind";
import {
  DEFAULT_TRIPS_SORT,
  groupTripsByYear,
  loadTripsSort,
  saveTripsSort,
  sortTrips,
  TRIPS_SORT_OPTIONS,
  type TripsSortId,
} from "../trips/sort";
import TripKindControl from "./ui/TripKindControl";

interface Props {
  user: User;
  providers: Provider[];
  space?: ShellSpace;
  onSpace?: (s: ShellSpace) => void;
  onOpenRide: (id: string) => void;
  onOpenUltra: (id: string, from?: "planning" | "trips") => void;
  onOpenRoute: (id: string) => void;
  onSignOut: () => void;
  onRefreshProviders: () => Promise<void>;
  onUpdateProfile: (patch: { weightKg?: number | null }) => Promise<User>;
  onRedeemCode: (code: string) => Promise<RedeemResult>;
  onRefreshUser?: () => Promise<void>;
  bootError?: string | null;
  onDismissBootError?: () => void;
}

/** P0 shell: Planning · Trips · Library (Account via avatar). */
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
  onRedeemCode,
  onRefreshUser,
  bootError,
  onDismissBootError,
}: Props) {
  const [cabinet, setCabinet] = useState<Cabinet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [showProGate, setShowProGate] = useState(false);
  /** Once per login session; cleared on logout. Redeem RYDN-ONBOARD can reopen. */
  const [showOnboarding, setShowOnboarding] = useState(() => !hasSeenOnboarding());
  /** Desktop: centered modal; phone: fullscreen sheet (already polished). */
  const [proGateWide, setProGateWide] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 721px)").matches,
  );
  const [showGroup, setShowGroup] = useState(false);
  const canImportPlanned = canImportPlannedRoute(user);
  const [groupSeed, setGroupSeed] = useState<{
    activityIds?: string[];
    name?: string;
  } | null>(null);
  const [spaceLocal, setSpaceLocal] = useState<ShellSpace>("planning");
  const space = spaceProp ?? spaceLocal;
  const setSpace = onSpaceProp ?? setSpaceLocal;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 721px)");
    const onChange = () => setProGateWide(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

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

  // Stripe return — Race Pass credit may land via webhook slightly after redirect.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const billing = params.get("billing");
    if (!billing) return;
    if (billing === "cancel") {
      setNotice("Checkout canceled — no charge.");
    } else if (billing === "race_pass_success") {
      setNotice("Race Pass ready — pick a GPX to unlock that route.");
      setSpace("planning");
      setShowUpload(true);
      void (async () => {
        for (let i = 0; i < 5; i++) {
          await onRefreshUser?.();
          await new Promise((r) => setTimeout(r, 800));
        }
      })();
    } else if (billing === "success") {
      setNotice("Pro is active — Planning unlocked.");
      setSpace("you");
      void onRefreshUser?.();
    }
    params.delete("billing");
    const next = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${next ? `?${next}` : ""}`);
  }, [onRefreshUser, setSpace]);

  const onDeleteRide = async (id: string) => {
    const ok = window.confirm(
      "Remove this day from your Library? It will also leave any trip that includes it.",
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

      {!loading && space === "planning" && (
        <PlanningSpace
          upcoming={planningUltras}
          routes={plannedRoutes}
          canImportPlanned={canImportPlanned}
          onOpenUltra={(id) => onOpenUltra(id, "planning")}
          onOpenRoute={onOpenRoute}
          onImportRoute={() => {
            if (!canImportPlanned) {
              setShowProGate(true);
              return;
            }
            setShowUpload(true);
          }}
        />
      )}

      {!loading && space === "trips" && (
        <TripsSpace
          completed={completedUltras}
          libraryCount={ungrouped.length}
          onOpenUltra={(id) => onOpenUltra(id, "trips")}
          onGoLibrary={() => setSpace("library")}
          onGroup={() => openGroup()}
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
          onRedeemCode={onRedeemCode}
          onRefreshUser={onRefreshUser}
          onShowOnboarding={() => setShowOnboarding(true)}
        />
      )}

      {showProGate && (
        <FocusLock
          open
          onClose={() => setShowProGate(false)}
          labelledBy="pro-gate-title"
          /* Phone sheet stays; desktop uses centered modal card. */
          variant={proGateWide ? "modal" : "sheet"}
          className={proGateWide ? "pro-gate-modal" : "pro-gate-sheet"}
        >
          <h2 id="pro-gate-title" className="visually-hidden">
            Unlock Planning
          </h2>
          <ProGate
            feature="planning"
            intent="import"
            onBack={() => setShowProGate(false)}
            onOpenAccount={() => {
              setShowProGate(false);
              setSpace("you");
            }}
          />
        </FocusLock>
      )}

      <Onboarding
        open={showOnboarding}
        onClose={() => setShowOnboarding(false)}
        onFinish={(dest: OnboardingDest) => {
          setShowOnboarding(false);
          setSpace(dest);
        }}
      />

      {showUpload && (
        <UploadModal
          allowPlanning={canImportPlanned}
          onClose={() => setShowUpload(false)}
          onProRequired={() => {
            setShowUpload(false);
            setShowProGate(true);
          }}
          onImportedRide={(id) => {
            setShowUpload(false);
            setNotice("Imported as completed ride — in Library.");
            setSpace("library");
            void refresh().then(() => onOpenRide(id));
          }}
          onImportedRoute={(id) => {
            setShowUpload(false);
            setNotice("Imported as planned route — in Planning.");
            setSpace("planning");
            void Promise.all([refresh(), onRefreshUser?.()]).then(() => onOpenRoute(id));
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
            setSpace("trips");
            setNotice("Trip saved to your cabinet.");
            await refresh();
          }}
        />
      )}
    </AppShell>
  );
}

function PlanningSpace({
  upcoming,
  routes,
  onOpenUltra,
  onOpenRoute,
  onImportRoute,
  canImportPlanned = true,
}: {
  upcoming: Ultra[];
  routes: PlannedRouteSummary[];
  onOpenUltra: (id: string) => void;
  onOpenRoute: (id: string) => void;
  onImportRoute: () => void;
  canImportPlanned?: boolean;
}) {
  const empty = upcoming.length === 0 && routes.length === 0;
  const lock = !canImportPlanned ? (
    <span className="btn__lock" aria-hidden>
      Pro
    </span>
  ) : null;

  return (
    <div className="space">
      <header className="space__head">
        <h1 className="space__title">Planning</h1>
        <div className="space__actions">
          <button type="button" className="btn btn--secondary" onClick={onImportRoute}>
            Import GPX{lock}
          </button>
        </div>
      </header>

      {empty ? (
        <p className="space__hint">Import a planned route GPX to start building your resupply plan.</p>
      ) : (
        <section className="space__section">
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
    </div>
  );
}

function TripsSpace({
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

function YouSpace({
  user,
  providers,
  syncing,
  onSync,
  onUpload,
  onSignOut,
  onUpdateProfile,
  onRedeemCode,
  onRefreshUser,
  onShowOnboarding,
}: {
  user: User;
  providers: Provider[];
  syncing: boolean;
  onSync: () => void;
  onUpload: () => void;
  onSignOut: () => void;
  onUpdateProfile: (patch: { weightKg?: number | null }) => Promise<User>;
  onRedeemCode: (code: string) => Promise<RedeemResult>;
  onRefreshUser?: () => Promise<void>;
  onShowOnboarding: () => void;
}) {
  const connected = providers.find((p) => p.connected);
  const connectable = providers.find((p) => p.enabled && !p.connected);
  const savedWeight =
    user.weightKg != null && Number.isFinite(user.weightKg) ? String(user.weightKg) : "";
  const [weightDraft, setWeightDraft] = useState(savedWeight);
  const [weightBusy, setWeightBusy] = useState(false);
  const [weightError, setWeightError] = useState<string | null>(null);
  const [weightNotice, setWeightNotice] = useState<string | null>(null);
  const [redeemDraft, setRedeemDraft] = useState("");
  const [redeemBusy, setRedeemBusy] = useState(false);
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [redeemNotice, setRedeemNotice] = useState<string | null>(null);
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [billingConfigured, setBillingConfigured] = useState<boolean | null>(null);
  const [pricing, setPricing] = useState<{
    monthlyLabel: string;
    yearlyLabel: string;
    racePassLabel?: string;
  } | null>(null);
  const tierKey = tierFromUser(user);
  const tier = tierLabel(tierKey);
  const isPro = tierKey === "pro";
  const hasStripeCustomer = Boolean(user.billing?.hasStripeCustomer);
  const racePassCredits = user.racePassCredits ?? user.billing?.racePassCredits ?? 0;

  useEffect(() => {
    setWeightDraft(savedWeight);
  }, [savedWeight]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { getBillingStatus } = await import("../api");
        const s = await getBillingStatus();
        if (!cancelled) {
          setBillingConfigured(s.configured);
          if (s.pricing) {
            setPricing({
              monthlyLabel: s.pricing.monthlyLabel,
              yearlyLabel: s.pricing.yearlyLabel,
              racePassLabel: s.pricing.racePassLabel,
            });
          }
        }
      } catch {
        if (!cancelled) setBillingConfigured(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const billing = params.get("billing");
    if (billing !== "success" && billing !== "race_pass_success") return;
    if (billing === "success") {
      setRedeemNotice("You’re on Pro. Planning, Verify, Ride mode, and GPX export are unlocked.");
    } else {
      setRedeemNotice("Race Pass ready — import one planned GPX to unlock that route.");
    }
    params.delete("billing");
    const next = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${next ? `?${next}` : ""}`);
    // Webhook may land slightly after redirect — refresh a few times.
    void (async () => {
      for (let i = 0; i < 5; i++) {
        await onRefreshUser?.();
        await new Promise((r) => setTimeout(r, 800));
      }
    })();
  }, [onRefreshUser]);

  const redeem = async () => {
    const code = redeemDraft.trim();
    if (!code) {
      setRedeemError("Enter a redeem code.");
      return;
    }
    setRedeemBusy(true);
    setRedeemError(null);
    setRedeemNotice(null);
    try {
      const result = await onRedeemCode(code);
      setRedeemDraft("");
      if (result.redeemAction === "onboarding") {
        setRedeemNotice("Opening a quick tour of RYDN…");
        onShowOnboarding();
      } else if (tierFromUser(result) === "free") {
        setRedeemNotice("Account set to Free.");
      } else {
        setRedeemNotice("Pro unlocked. Planning, Verify, Ride mode, and GPX export are available.");
      }
    } catch (e) {
      setRedeemError((e as Error).message);
    } finally {
      setRedeemBusy(false);
    }
  };

  const startCheckout = async (interval: "month" | "year" = "month") => {
    setBillingBusy(true);
    setBillingError(null);
    try {
      const { createBillingCheckoutSession } = await import("../api");
      const { url } = await createBillingCheckoutSession(interval);
      window.location.href = url;
    } catch (e) {
      setBillingError((e as Error).message);
      setBillingBusy(false);
    }
  };

  const openPortal = async () => {
    setBillingBusy(true);
    setBillingError(null);
    try {
      const { createBillingPortalSession } = await import("../api");
      const { url } = await createBillingPortalSession();
      window.location.href = url;
    } catch (e) {
      setBillingError((e as Error).message);
      setBillingBusy(false);
    }
  };

  const retryBillingSetup = async () => {
    setBillingBusy(true);
    setBillingError(null);
    try {
      const { bootstrapBilling, getBillingStatus } = await import("../api");
      await bootstrapBilling();
      const s = await getBillingStatus();
      setBillingConfigured(s.configured);
      if (s.configured) {
        setRedeemNotice("Billing is ready. You can upgrade to Pro.");
      } else {
        setBillingError("Still not ready — add STRIPE_SECRET_KEY in Railway, then retry.");
      }
    } catch (e) {
      setBillingError((e as Error).message);
    } finally {
      setBillingBusy(false);
    }
  };

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
        <h1 className="space__title">Account</h1>
        <p className="space__sub">Profile, subscription, and connections.</p>
      </header>

      <div className="you-card">
        <div className="you-card__name">{user.name || "Rider"}</div>
        <div className="you-card__email">{user.email || "No email on file"}</div>
        <div className="you-card__tier">
          <span className="you-card__tier-label">Current plan</span>
          <span className={`you-tier you-tier--${tierKey}`}>{tier}</span>
        </div>
      </div>

      <section className="you-section you-section--subscription" aria-labelledby="you-subscription-heading">
        <h2 id="you-subscription-heading" className="space__label">
          Subscription
        </h2>
        <div className="you-plan">
          <div className="you-plan__title">
            {tier} plan
            <span className={`you-tier you-tier--${tierKey}`}>{tier}</span>
          </div>
          <p className="you-plan__meta">
            {isPro
              ? "Planning, Verify, Ride mode, and GPX export unlocked on every route."
              : "Library, Analytics, Certificates, and Trips included. Subscribe to Pro for unlimited Planning."}
          </p>
        </div>
        {billingError ? <p className="you-weight__error">{billingError}</p> : null}
        {redeemNotice ? <p className="space__hint">{redeemNotice}</p> : null}
        <div className="you-billing-actions">
          {!isPro && billingConfigured ? (
            <>
              <button
                type="button"
                className="btn btn--primary"
                disabled={billingBusy}
                onClick={() => void startCheckout("month")}
              >
                {billingBusy ? "Opening…" : `Pro · ${pricing?.monthlyLabel ?? "8,99 €"} / month`}
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                disabled={billingBusy}
                onClick={() => void startCheckout("year")}
              >
                {billingBusy
                  ? "Opening…"
                  : `Pro · ${pricing?.yearlyLabel ?? "59,99 €"} / year · best value`}
              </button>
            </>
          ) : null}
          {billingConfigured === false ? (
            <button
              type="button"
              className="btn btn--ghost"
              disabled={billingBusy}
              onClick={() => void retryBillingSetup()}
            >
              {billingBusy ? "Setting up…" : "Retry billing setup"}
            </button>
          ) : null}
          {hasStripeCustomer ? (
            <button
              type="button"
              className="btn btn--ghost"
              disabled={billingBusy}
              onClick={() => void openPortal()}
            >
              Manage billing
            </button>
          ) : null}
        </div>
        {!isPro && billingConfigured ? (
          <div className="you-race-pass">
            <h3 className="you-race-pass__title">Race Pass</h3>
            <p className="you-race-pass__meta">
              One-time purchase — unlock a single planned GPX (not a subscription).
              {racePassCredits > 0
                ? racePassCredits === 1
                  ? " You have 1 pass ready to use."
                  : ` You have ${racePassCredits} passes ready.`
                : ""}
            </p>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={billingBusy}
              onClick={() => {
                void (async () => {
                  setBillingBusy(true);
                  setBillingError(null);
                  try {
                    const { createRacePassCheckout } = await import("../api");
                    const { url } = await createRacePassCheckout();
                    window.location.href = url;
                  } catch (e) {
                    setBillingError((e as Error).message);
                    setBillingBusy(false);
                  }
                })();
              }}
            >
              {billingBusy
                ? "Opening…"
                : `Buy Race Pass · ${pricing?.racePassLabel ?? "4,99 €"}`}
            </button>
          </div>
        ) : null}
        <form
          className="you-redeem"
          onSubmit={(e) => {
            e.preventDefault();
            void redeem();
          }}
        >
          <label className="field" htmlFor="you-redeem-code">
            <span>Redeem code</span>
            <div className="you-redeem__row">
              <input
                id="you-redeem-code"
                type="text"
                name="redeemCode"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                placeholder="e.g. RYDN-ONBOARD"
                value={redeemDraft}
                onChange={(e) => {
                  setRedeemDraft(e.target.value);
                  setRedeemError(null);
                  setRedeemNotice(null);
                }}
                disabled={redeemBusy}
                aria-describedby="you-redeem-hint"
              />
              <button
                type="submit"
                className="btn btn--ghost"
                disabled={redeemBusy || !redeemDraft.trim()}
              >
                {redeemBusy ? "Redeeming…" : "Redeem"}
              </button>
            </div>
          </label>
          <p id="you-redeem-hint" className="field__hint">
            {billingConfigured
              ? "Have a code? Redeem it here. Or upgrade with Apple Pay, Google Pay, or card."
              : "Valid codes unlock Pro. Card checkout appears here once billing is configured."}
          </p>
          {redeemError ? <p className="you-weight__error">{redeemError}</p> : null}
        </form>
      </section>

      <section className="you-section">
        <h2 className="space__label">Profile</h2>
        <div className="you-row">
          <div>
            <div className="you-row__title">Email</div>
            <div className="you-row__meta">{user.email || "—"}</div>
          </div>
        </div>
      </section>

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
        <h2 className="space__label">Privacy</h2>
        <p className="space__hint">Privacy controls will live here. Coming soon.</p>
      </section>

      <section className="you-section">
        <h2 className="space__label">Danger zone</h2>
        <button type="button" className="btn btn--ghost" disabled title="Coming soon">
          Delete account
        </button>
        <p className="space__hint">Account deletion is not available yet.</p>
      </section>

      <section className="you-section">
        <button type="button" className="btn btn--ghost" onClick={onSignOut}>
          Log out
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
  allowPlanning,
  onClose,
  onProRequired,
  onImportedRide,
  onImportedRoute,
}: {
  allowPlanning: boolean;
  onClose: () => void;
  onProRequired: () => void;
  onImportedRide: (id: string) => void;
  onImportedRoute: (id: string) => void;
}) {
  const [purpose, setPurpose] = useState<ImportPurpose>(() => {
    const saved = loadImportPurpose();
    return saved === "planned" && !allowPlanning ? "completed" : saved;
  });
  const [kind, setKind] = useState<RideKind>("training");
  const [drag, setDrag] = useState(false);
  const [phase, setPhase] = useState<ImportPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [hintNeedsUnlock, setHintNeedsUnlock] = useState(false);
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
    if (next === "planned" && !allowPlanning) {
      onProRequired();
      return;
    }
    setPurpose(next);
    saveImportPurpose(next);
    setError(null);
    setHint(null);
    setHintNeedsUnlock(false);
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
    setHintNeedsUnlock(false);
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
        if (!allowPlanning) {
          onProRequired();
          return;
        }
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
          if (!allowPlanning) {
            setPhase("idle");
            setHint(
              "This GPX has no timestamps, so it cannot be a completed ride. Unlock Planned Route with Pro or a Race Pass.",
            );
            setHintNeedsUnlock(true);
            return;
          }
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
          className={`${purpose === "planned" ? "active" : ""}${!allowPlanning ? " kind-toggle__btn--locked" : ""}`}
          onClick={() => choosePurpose("planned")}
          disabled={busy}
          aria-label={!allowPlanning ? "Planned Route — needs Pro or Race Pass" : "Planned Route"}
        >
          Planned Route
          {!allowPlanning ? (
            <span className="kind-toggle__lock" aria-hidden>
              Pro
            </span>
          ) : null}
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
              Race
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

      {hint ? (
        <div className="modal__hint">
          <p>{hint}</p>
          {hintNeedsUnlock ? (
            <button
              type="button"
              className="btn btn--primary"
              style={{ marginTop: 10 }}
              onClick={onProRequired}
            >
              Unlock with Race Pass or Pro
            </button>
          ) : null}
        </div>
      ) : null}
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
