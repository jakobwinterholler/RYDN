import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { normalizeSyncListError } from "@shared/api/supabaseErrors";
import { cloudSyncUnavailableUserMessage } from "@shared/companion/userFacingErrors";
import { fetchSyncRaces } from "@shared/api/sync";
import type { SyncRaceSummary } from "@shared/types/sync";
import { needsCompanionDownload, localBundleIsCurrent } from "@shared/sync/raceVersion";
import { useAuth } from "@shared/auth/AuthProvider";
import { logSyncDebug } from "@shared/sync/syncDebugLog";
import {
  hasValidCompanionBundle,
  invalidateStaleBundle,
  loadCompanionBundle,
  loadRaceList,
  saveRaceList,
  deleteCompanionRace,
  type StoredRaceListItem,
} from "../db";
import { isRaceDownloading } from "../lib/downloadRaceAssets";

async function resolveOfflineReady(
  race: SyncRaceSummary,
  existing: StoredRaceListItem | undefined,
): Promise<{
  downloadedRevision: number | null;
  downloadedChecksum: string | null;
  offlineReady: boolean;
}> {
  const downloadedRevision = existing?.downloadedRevision ?? null;
  const downloadedChecksum = existing?.downloadedChecksum ?? null;

  if (!existing?.offlineReady || downloadedRevision === null) {
    return { downloadedRevision, downloadedChecksum, offlineReady: false };
  }

  if (isRaceDownloading(race.id)) {
    return { downloadedRevision, downloadedChecksum, offlineReady: true };
  }

  const bundleExists = await hasValidCompanionBundle(race.id);
  if (!bundleExists) {
    logSyncDebug("stale-cache", `${race.name} — bundle missing or invalid in IndexedDB`, {
      raceId: race.id,
      downloadedRevision,
      downloadedChecksum,
    });
    await invalidateStaleBundle(race.id);
    return { downloadedRevision: null, downloadedChecksum: null, offlineReady: false };
  }

  const localBundle = await loadCompanionBundle(race.id);
  const downloadedClimbCount = localBundle?.climbs?.length ?? existing?.downloadedClimbCount ?? null;
  const localSchemaVersion = localBundle?.schemaVersion ?? null;

  if (
    localBundle &&
    localBundleIsCurrent(
      race,
      downloadedRevision,
      true,
      downloadedClimbCount,
      localSchemaVersion,
    )
  ) {
    return {
      downloadedRevision: downloadedRevision ?? race.companion_revision,
      downloadedChecksum: downloadedChecksum ?? localBundle.bundleChecksum ?? null,
      offlineReady: true,
    };
  }

  const needsUpdate = needsCompanionDownload(
    race,
    downloadedRevision,
    true,
    downloadedChecksum,
    downloadedClimbCount,
    localSchemaVersion,
  );
  if (needsUpdate) {
    // A newer cloud revision exists, but we must NEVER delete a working offline
    // bundle just because an update is available — that could leave a rider with
    // no route mid-race. Keep the downloaded copy openable offline; the UI still
    // surfaces the update via the revision mismatch, and the rider (or background
    // sync, when this isn't the active race) refreshes it when it's safe.
    logSyncDebug("stale-cache", `${race.name} — cloud update available; keeping offline copy`, {
      raceId: race.id,
      cloudRevision: race.companion_revision,
      localRevision: downloadedRevision,
      cloudChecksum: race.bundle_checksum,
      localChecksum: downloadedChecksum,
      cloudClimbCount: race.significant_climb_count ?? null,
      localClimbCount: downloadedClimbCount,
    });
    return { downloadedRevision, downloadedChecksum, offlineReady: true };
  }

  return { downloadedRevision, downloadedChecksum, offlineReady: true };
}

async function mergeRaceLists(
  cloud: SyncRaceSummary[],
  local: StoredRaceListItem[],
): Promise<StoredRaceListItem[]> {
  const localById = new Map(local.map((race) => [race.id, race]));
  const cloudIds = new Set(cloud.map((race) => race.id));
  const merged: StoredRaceListItem[] = [];

  for (const race of cloud) {
    const existing = localById.get(race.id);
    const status = await resolveOfflineReady(race, existing);
    merged.push({
      ...race,
      ...status,
      source: existing?.source === "local-import" ? "local-import" : "cloud",
      lastOpenedAt: existing?.lastOpenedAt ?? null,
      verified_percent: existing?.verified_percent ?? null,
      verified_stops_count: existing?.verified_stops_count ?? null,
    });
  }

  for (const race of local) {
    if (cloudIds.has(race.id)) {
      continue;
    }
    if (race.source === "local-import") {
      merged.push({
        ...race,
        source: "local-import",
      });
      continue;
    }
    if (race.offlineReady || race.has_bundle) {
      logSyncDebug("race-list", `Purging deleted cloud race ${race.name}`, { raceId: race.id });
      await deleteCompanionRace(race.id);
    }
  }

  return merged.sort((left, right) =>
    (right.updated_at ?? "").localeCompare(left.updated_at ?? ""),
  );
}

interface CloudRaceListContextValue {
  races: StoredRaceListItem[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  removeRace: (raceId: string) => void;
  onlineConfigured: boolean;
}

const CloudRaceListContext = createContext<CloudRaceListContextValue | null>(null);

export function CloudRaceListProvider({ children }: { children: ReactNode }) {
  const { accessToken, configured } = useAuth();
  const [races, setRaces] = useState<StoredRaceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const local = await loadRaceList();
      if (!accessToken) {
        setRaces(local);
        return;
      }
      const cloud = await fetchSyncRaces(accessToken);
      logSyncDebug("race-list", `Cloud race list refreshed (${cloud.length} races)`, cloud);
      const merged = await mergeRaceLists(cloud, local);
      await saveRaceList(merged);
      setRaces(merged);
      logSyncDebug("race-list", `IndexedDB race list saved (${merged.length} races)`);
    } catch (err) {
      const local = await loadRaceList();
      setRaces(local);
      const message = err instanceof Error ? err.message : "Failed to load races.";
      setError(normalizeSyncListError(message));
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    if (!configured) {
      setLoading(false);
      setError(cloudSyncUnavailableUserMessage());
      return;
    }
    void refresh();
  }, [configured, refresh]);

  const removeRace = useCallback((raceId: string) => {
    setRaces((current) => current.filter((race) => race.id !== raceId));
  }, []);

  const value = useMemo(
    () => ({
      races,
      loading,
      error,
      refresh,
      removeRace,
      onlineConfigured: configured,
    }),
    [configured, error, loading, races, refresh, removeRace],
  );

  return (
    <CloudRaceListContext.Provider value={value}>{children}</CloudRaceListContext.Provider>
  );
}

export function useCloudRaceList(): CloudRaceListContextValue {
  const context = useContext(CloudRaceListContext);
  if (!context) {
    throw new Error("useCloudRaceList must be used within CloudRaceListProvider.");
  }
  return context;
}
