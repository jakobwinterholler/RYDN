import { useCallback, useEffect, useState } from "react";
import { fetchSyncRaces } from "@shared/api/sync";
import { useAuth } from "@shared/auth/AuthProvider";
import {
  formatRelativeTime,
  getLastCheckAt,
  getLastSyncAt,
  setLastCheckAt,
  setLastSyncAt,
} from "@shared/sync/syncMeta";
import {
  clearSyncDebugLog,
  getSyncDebugLog,
  logSyncDebug,
  type SyncDebugEntry,
} from "@shared/sync/syncDebugLog";
import {
  formatUpdateSummary,
  needsCompanionDownload,
  raceVersionFields,
} from "@shared/sync/raceVersion";
import { useCloudRaceList } from "../sync/useCloudRaceList";
import { loadRaceList } from "../db";
import { downloadRaceAssets } from "../lib/downloadRaceAssets";

export interface CompanionUpdateResult {
  raceId: string;
  name: string;
  status: "downloaded" | "failed" | "skipped";
  error?: string;
  kind?: "new" | "updated";
  reason?: string;
}

export function useCompanionSync() {
  const { user, accessToken } = useAuth();
  const userId = user?.id ?? "";
  const { refresh, loading } = useCloudRaceList();
  const [checking, setChecking] = useState(false);
  const [lastSyncAt, setLastSyncAtState] = useState<string | null>(() =>
    userId ? getLastSyncAt(userId) : null,
  );
  const [lastCheckAt, setLastCheckAtState] = useState<string | null>(() =>
    userId ? getLastCheckAt(userId) : null,
  );
  const [downloadedCount, setDownloadedCount] = useState(0);
  const [cloudRaceCount, setCloudRaceCount] = useState<number | null>(null);
  const [maxCloudRevision, setMaxCloudRevision] = useState<number | null>(null);
  const [maxDownloadedRevision, setMaxDownloadedRevision] = useState<number | null>(null);
  const [updatesAvailable, setUpdatesAvailable] = useState(0);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [checkMessage, setCheckMessage] = useState<string | null>(null);
  const [updateResults, setUpdateResults] = useState<CompanionUpdateResult[]>([]);
  const [syncDebugLog, setSyncDebugLog] = useState<SyncDebugEntry[]>([]);
  const [checkProgress, setCheckProgress] = useState<{
    current: number;
    total: number;
    raceName: string;
  } | null>(null);

  const refreshLocalStats = useCallback(async () => {
    const races = await loadRaceList();
    const downloaded = races.filter((race) => race.offlineReady);
    setDownloadedCount(downloaded.length);
    const downloadedRevisions = downloaded
      .map((race) => race.downloadedRevision)
      .filter((value): value is number => value != null);
    setMaxDownloadedRevision(
      downloadedRevisions.length > 0 ? Math.max(...downloadedRevisions) : null,
    );
    const pending = races.filter((race) =>
      needsCompanionDownload(
        race,
        race.downloadedRevision,
        race.offlineReady,
        race.downloadedChecksum,
        race.downloadedClimbCount ?? null,
      ),
    );
    setUpdatesAvailable(pending.length);
  }, []);

  const refreshCloudStats = useCallback(async () => {
    if (!accessToken) {
      setCloudRaceCount(null);
      setMaxCloudRevision(null);
      return;
    }
    try {
      const races = await fetchSyncRaces(accessToken);
      setCloudRaceCount(races.length);
      const revisions = races.map((race) => race.companion_revision);
      setMaxCloudRevision(revisions.length > 0 ? Math.max(...revisions) : 0);
    } catch (err) {
      setCloudRaceCount(null);
      setMaxCloudRevision(null);
      setSyncError(err instanceof Error ? err.message : "Could not load cloud races.");
    }
  }, [accessToken]);

  useEffect(() => {
    if (userId) {
      setLastSyncAtState(getLastSyncAt(userId));
      setLastCheckAtState(getLastCheckAt(userId));
    }
  }, [userId]);

  useEffect(() => {
    void refreshLocalStats();
    void refreshCloudStats();
  }, [refreshLocalStats, refreshCloudStats, loading]);

  const checkForUpdates = useCallback(async () => {
    if (!accessToken || !userId) {
      throw new Error("Sign in required to check for updates.");
    }
    setSyncError(null);
    setCheckMessage(null);
    setUpdateResults([]);
    clearSyncDebugLog();
    setSyncDebugLog([]);
    setChecking(true);

    try {
      logSyncDebug("check", "Starting update check");
      await refresh();
      const [cloudRaces, localRaces] = await Promise.all([
        fetchSyncRaces(accessToken),
        loadRaceList(),
      ]);
      logSyncDebug("cloud", `Fetched ${cloudRaces.length} race(s) from Supabase`, cloudRaces.map((race) => ({
        id: race.id,
        name: race.name,
        revision: race.companion_revision,
        has_bundle: race.has_bundle,
      })));
      logSyncDebug("local", `Loaded ${localRaces.length} race(s) from IndexedDB`, localRaces.map((race) => ({
        id: race.id,
        name: race.name,
        downloadedRevision: race.downloadedRevision,
        offlineReady: race.offlineReady,
      })));

      const localById = new Map(localRaces.map((race) => [race.id, race]));
      const skipped: CompanionUpdateResult[] = [];

      const toDownload: Array<{
        id: string;
        name: string;
        kind: "new" | "updated";
      }> = [];

      for (const cloudRace of cloudRaces) {
        if (!cloudRace.has_bundle) {
          const reason = "skipped: no companion bundle (not analyzed on Desktop)";
          logSyncDebug("filter", `${cloudRace.name} — ${reason}`, { raceId: cloudRace.id });
          skipped.push({
            raceId: cloudRace.id,
            name: cloudRace.name,
            status: "skipped",
            reason,
          });
          continue;
        }
        const local = localById.get(cloudRace.id);
        if (!local || !local.offlineReady) {
          const reason = !local
            ? "download: new race (not in local IndexedDB)"
            : "download: new race (bundle not offline-ready)";
          logSyncDebug("filter", `${cloudRace.name} — ${reason}`, {
            raceId: cloudRace.id,
            cloudRevision: cloudRace.companion_revision,
            localRevision: local?.downloadedRevision ?? null,
          });
          toDownload.push({ id: cloudRace.id, name: cloudRace.name, kind: "new" });
          continue;
        }
        const cloudVersion = raceVersionFields(cloudRace).version;
        const needsUpdate = needsCompanionDownload(
          cloudRace,
          local.downloadedRevision,
          local.offlineReady,
          local.downloadedChecksum,
          local.downloadedClimbCount ?? null,
        );
        if (needsUpdate) {
          const reason = `download: cloud v${cloudVersion} > local v${local.downloadedRevision ?? 0}`;
          logSyncDebug("filter", `${cloudRace.name} — ${reason}`, { raceId: cloudRace.id });
          toDownload.push({ id: cloudRace.id, name: cloudRace.name, kind: "updated" });
        } else {
          const reason = `up to date (v${local.downloadedRevision ?? 0})`;
          logSyncDebug("filter", `${cloudRace.name} — ${reason}`, { raceId: cloudRace.id });
          skipped.push({
            raceId: cloudRace.id,
            name: cloudRace.name,
            status: "skipped",
            reason,
          });
        }
      }

      const cloudIds = new Set(cloudRaces.map((race) => race.id));
      for (const localRace of localRaces) {
        if (!cloudIds.has(localRace.id)) {
          logSyncDebug("local-only", `${localRace.name} exists locally but not in cloud`, {
            raceId: localRace.id,
          });
        }
      }

      if (toDownload.length === 0) {
        const onlyInCloud = cloudRaces.filter((race) => !localById.has(race.id) && race.has_bundle);
        if (onlyInCloud.length > 0) {
          const message = `${onlyInCloud.length} cloud race(s) missing locally but were not queued — tap Check again or contact support.`;
          setSyncError(message);
          logSyncDebug("error", message, onlyInCloud);
        }
        setCheckMessage("No updates");
        setUpdateResults(skipped);
        setSyncDebugLog(getSyncDebugLog());
        const now = new Date().toISOString();
        setLastCheckAt(userId, now);
        setLastCheckAtState(now);
        await refreshLocalStats();
        return;
      }

      logSyncDebug("download", `Queueing ${toDownload.length} race(s)`, toDownload);
      const results: CompanionUpdateResult[] = [...skipped];
      for (let index = 0; index < toDownload.length; index += 1) {
        const target = toDownload[index];
        setCheckProgress({
          current: index + 1,
          total: toDownload.length,
          raceName: target.name,
        });
        try {
          await downloadRaceAssets(accessToken, target.id, user?.id);
          results.push({
            raceId: target.id,
            name: target.name,
            status: "downloaded",
            kind: target.kind,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Download failed.";
          logSyncDebug("download-failed", `${target.name}: ${message}`, {
            raceId: target.id,
          });
          results.push({
            raceId: target.id,
            name: target.name,
            status: "failed",
            error: message,
            kind: target.kind,
          });
        }
      }

      setUpdateResults(results);
      setSyncDebugLog(getSyncDebugLog());
      await refresh();
      await refreshLocalStats();
      await refreshCloudStats();

      const newCount = results.filter((entry) => entry.kind === "new" && entry.status === "downloaded").length;
      const updatedCount = results.filter(
        (entry) => entry.kind === "updated" && entry.status === "downloaded",
      ).length;
      const failedCount = results.filter((entry) => entry.status === "failed").length;

      setCheckMessage(formatUpdateSummary({ newCount, updatedCount, failedCount }));
      if (failedCount > 0) {
        setSyncError(
          results
            .filter((entry) => entry.status === "failed")
            .map((entry) => `${entry.name}: ${entry.error}`)
            .join(" · "),
        );
      }

      const now = new Date().toISOString();
      setLastCheckAt(userId, now);
      setLastCheckAtState(now);
      setLastSyncAt(userId, now);
      setLastSyncAtState(now);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Update check failed.";
      logSyncDebug("error", message);
      setSyncDebugLog(getSyncDebugLog());
      setSyncError(message);
      throw err;
    } finally {
      setChecking(false);
      setCheckProgress(null);
    }
  }, [accessToken, refresh, refreshCloudStats, refreshLocalStats, user?.id, userId]);

  const syncNow = useCallback(async () => {
    await checkForUpdates();
  }, [checkForUpdates]);

  return {
    syncing: checking || loading,
    checking: checking || loading,
    lastSyncAt,
    lastSyncLabel: formatRelativeTime(lastSyncAt),
    lastCheckAt,
    lastCheckLabel: formatRelativeTime(lastCheckAt),
    downloadedCount,
    cloudRaceCount,
    maxCloudRevision,
    maxDownloadedRevision,
    updatesAvailable,
    syncError,
    checkMessage,
    updateResults,
    syncDebugLog,
    checkProgress,
    checkForUpdates,
    syncNow,
    refreshLocalStats,
  };
}

export function companionRaceVersionLabel(race: {
  companion_revision: number;
  downloadedRevision: number | null;
  offlineReady: boolean;
}): string {
  const cloud = raceVersionFields(race).version;
  const local = race.downloadedRevision ?? 0;
  if (!race.offlineReady) {
    return `Cloud v${cloud}`;
  }
  if (cloud > local) {
    return `v${local} → v${cloud}`;
  }
  return `v${local}`;
}
