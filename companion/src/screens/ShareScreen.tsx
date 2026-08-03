import { useMemo, useState } from "react";
import { useAuth } from "@shared/auth/AuthProvider";
import { useCompanion } from "../context/CompanionContext";
import GpsGpxExportPanel from "../components/GpsGpxExportPanel";
import { downloadRaceAssets } from "../lib/downloadRaceAssets";
import { formatKm } from "../lib/utils";
import { useCloudRaceList } from "../sync/useCloudRaceList";

function bundleRevision(bundle: { revision?: number; bundle_version?: number }): number {
  return bundle.revision ?? bundle.bundle_version ?? 0;
}

export default function ShareScreen({
  autoExportDevice = null,
  onAutoExportHandled,
}: {
  autoExportDevice?: "coros" | "garmin" | "wahoo" | null;
  onAutoExportHandled?: () => void;
}) {
  const { bundle, updateBundle, showUnverified } = useCompanion();
  const { accessToken, user } = useAuth();
  const { refresh } = useCloudRaceList();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);

  const climbs = bundle.climbs ?? [];
  const verifiedCount = useMemo(
    () => bundle.stops.filter((stop) => stop.verificationStatus === "verified").length,
    [bundle.stops],
  );
  const unverifiedCount = useMemo(
    () => bundle.stops.filter((stop) => stop.verificationStatus === "unverified").length,
    [bundle.stops],
  );
  const sortedStops = useMemo(
    () => [...bundle.stops].sort((left, right) => left.km - right.km),
    [bundle.stops],
  );

  async function handleRefresh() {
    if (!accessToken) {
      setRefreshError("Sign in required to refresh race data.");
      return;
    }
    setRefreshing(true);
    setRefreshError(null);
    setRefreshMessage(null);
    try {
      const next = await downloadRaceAssets(accessToken, bundle.race.id, user?.id);
      updateBundle(next);
      await refresh();
      setRefreshMessage("Race data refreshed from cloud.");
    } catch (err) {
      setRefreshError(err instanceof Error ? err.message : "Refresh failed.");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto pb-safe-bottom">
      <section className="border-b border-white/10 px-4 pb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-sky-300/80">Share</p>
        <h1 className="mt-1 text-xl font-semibold text-white">{bundle.race.name}</h1>
        <p className="mt-1 text-sm tabular-nums text-white/50">
          {Math.round(bundle.race.distanceKm)} km
          {bundle.race.elevationGainM
            ? ` · +${Math.round(bundle.race.elevationGainM).toLocaleString()} m`
            : ""}
          {" · "}rev {bundleRevision(bundle)}
        </p>
      </section>

      <section className="border-b border-white/10 px-4 py-4">
        <dl className="grid grid-cols-3 gap-3">
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-white/40">Climbs</dt>
            <dd className="text-lg font-semibold tabular-nums text-white">{climbs.length}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-white/40">Stops</dt>
            <dd className="text-lg font-semibold tabular-nums text-white">{bundle.stops.length}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-white/40">Verified</dt>
            <dd className="text-lg font-semibold tabular-nums text-white">{verifiedCount}</dd>
          </div>
        </dl>
        <button
          type="button"
          disabled={refreshing}
          onClick={() => void handleRefresh()}
          className="mt-4 min-h-[44px] w-full rounded-xl border border-white/12 bg-white/[0.03] text-sm font-medium text-white/85 disabled:opacity-60"
        >
          {refreshing ? "Refreshing…" : "Refresh from cloud"}
        </button>
        {refreshMessage ? <p className="mt-2 text-sm text-emerald-300">{refreshMessage}</p> : null}
        {refreshError ? <p className="mt-2 text-sm text-red-300">{refreshError}</p> : null}
      </section>

      {!showUnverified && unverifiedCount > 0 ? (
        <section className="border-b border-white/10 px-4 py-3">
          <p className="text-sm text-amber-200/90">
            {unverifiedCount} unverified stop{unverifiedCount === 1 ? "" : "s"} in this bundle may be
            hidden on the map. Enable &ldquo;Unverified&rdquo; on Resupply or verify stops to see them.
          </p>
        </section>
      ) : null}

      {climbs.length > 0 ? (
        <section className="border-b border-white/10 px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/40">Climbs</p>
          <ul className="mt-2 space-y-1">
            {climbs.map((climb) => (
              <li
                key={climb.id}
                className="flex items-center gap-3 rounded-lg px-1 py-1.5 text-sm text-white/80"
              >
                <span className="w-14 shrink-0 text-xs tabular-nums text-white/45">
                  {formatKm(climb.startKm)}
                </span>
                <span className="truncate">{climb.name}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {sortedStops.length > 0 ? (
        <section className="border-b border-white/10 px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/40">
            Resupply stops
          </p>
          <ul className="mt-2 space-y-1">
            {sortedStops.map((stop) => (
              <li
                key={stop.zoneId}
                className="flex items-center gap-3 rounded-lg px-1 py-1.5 text-sm text-white/80"
              >
                <span className="w-14 shrink-0 text-xs tabular-nums text-white/45">
                  {formatKm(stop.km)}
                </span>
                <span className="truncate">
                  {stop.icon} {stop.name}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="px-4 py-5">
        <GpsGpxExportPanel
          bundle={bundle}
          initialDevice={autoExportDevice ?? undefined}
          autoStartExport={autoExportDevice != null}
          onAutoStartHandled={onAutoExportHandled}
        />
      </section>
    </div>
  );
}
