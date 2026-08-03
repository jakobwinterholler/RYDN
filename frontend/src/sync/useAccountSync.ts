import { useCallback, useEffect, useState } from "react";
import { fetchSyncRaces, pushRaceNow } from "@shared/api/sync";
import { getFreshAccessToken } from "@shared/auth/accessToken";
import { useAuth } from "@shared/auth/AuthProvider";
import type { SyncPushRaceResult } from "@shared/types/sync";
import {
  addPendingSyncRace,
  clearPendingSyncRaces,
  getPendingSyncRaces,
  hasPendingSyncRaces,
  removePendingSyncRace,
} from "@shared/sync/pendingSync";
import {
  isDesktopCloudCurrent,
  needsDesktopUpload,
  resolveCloudRaceForLocal,
} from "@shared/sync/raceVersion";
import {
  formatRelativeTime,
  getLastSyncAt,
  setLastSyncAt,
  setSyncInProgress,
} from "@shared/sync/syncMeta";
import { fetchRaces } from "../races/api";

export interface RaceSyncResult {
  raceId: string;
  name: string;
  status: "success" | "failed" | "skipped";
  error?: string;
  companionRevision?: number;
}

export function useAccountSync() {
  const { accessToken, user, configured } = useAuth();
  const userId = user?.id ?? "";
  const [syncing, setSyncing] = useState(false);
  const [cloudRaceCount, setCloudRaceCount] = useState<number | null>(null);
  const [maxCloudRevision, setMaxCloudRevision] = useState<number | null>(null);
  const [lastSyncAt, setLastSyncAtState] = useState<string | null>(() =>
    userId ? getLastSyncAt(userId) : null,
  );
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [hasPending, setHasPending] = useState(() =>
    userId ? hasPendingSyncRaces(userId) : false,
  );
  const [syncProgress, setSyncProgress] = useState<{
    current: number;
    total: number;
    raceName: string;
  } | null>(null);
  const [raceResults, setRaceResults] = useState<RaceSyncResult[]>([]);
  const [syncingRaceId, setSyncingRaceId] = useState<string | null>(null);

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
      setHasPending(hasPendingSyncRaces(userId));
    }
  }, [userId]);

  useEffect(() => {
    if (accessToken) {
      void refreshCloudStats();
    }
  }, [accessToken, refreshCloudStats]);

  const syncToCompanion = useCallback(async () => {
    const token = await getFreshAccessToken(accessToken);
    if (!userId) {
      throw new Error("Sign in required to sync races.");
    }
    setSyncError(null);
    setSyncMessage(null);
    setRaceResults([]);
    setSyncing(true);
    setSyncInProgress(userId, true);

    try {
      const [localRaces, cloudRaces] = await Promise.all([
        fetchRaces(),
        fetchSyncRaces(token ?? accessToken ?? ""),
      ]);
      const pending = getPendingSyncRaces(userId);
      for (const race of localRaces) {
        const cloud = resolveCloudRaceForLocal(race, cloudRaces);
        if (pending.has(race.id) && isDesktopCloudCurrent(race, cloud)) {
          removePendingSyncRace(userId, race.id);
        }
      }
      const pendingAfterReconcile = getPendingSyncRaces(userId);

      const toUpload = localRaces.filter((race) =>
        needsDesktopUpload(
          race,
          resolveCloudRaceForLocal(race, cloudRaces),
          pendingAfterReconcile,
        ),
      );

      if (toUpload.length === 0) {
        clearPendingSyncRaces(userId);
        setHasPending(false);
        setSyncMessage("All races are up to date in the cloud.");
        const now = new Date().toISOString();
        setLastSyncAt(userId, now);
        setLastSyncAtState(now);
        await refreshCloudStats();
        return;
      }

      const results: RaceSyncResult[] = [];
      for (let index = 0; index < toUpload.length; index += 1) {
        const race = toUpload[index];
        setSyncingRaceId(race.id);
        setSyncProgress({
          current: index + 1,
          total: toUpload.length,
          raceName: race.name,
        });
        try {
          const uploadToken = await getFreshAccessToken(token ?? accessToken);
          const pushed: SyncPushRaceResult = await pushRaceNow(uploadToken, race.id, userId);
          removePendingSyncRace(userId, race.id);
          results.push({
            raceId: race.id,
            name: race.name,
            status: "success",
            companionRevision: pushed.companion_revision,
          });
        } catch (err) {
          const cloud = resolveCloudRaceForLocal(race, cloudRaces);
          if (isDesktopCloudCurrent(race, cloud)) {
            removePendingSyncRace(userId, race.id);
            results.push({
              raceId: race.id,
              name: race.name,
              status: "skipped",
              companionRevision: cloud?.companion_revision,
            });
            continue;
          }
          addPendingSyncRace(userId, race.id);
          const message = err instanceof Error ? err.message : "Upload failed.";
          results.push({
            raceId: race.id,
            name: race.name,
            status: "failed",
            error: message,
          });
        }
      }

      setRaceResults(results);
      const failed = results.filter((entry) => entry.status === "failed");
      const succeeded = results.filter((entry) => entry.status === "success");
      const skipped = results.filter((entry) => entry.status === "skipped");
      setHasPending(hasPendingSyncRaces(userId));
      const now = new Date().toISOString();

      if (failed.length > 0 && succeeded.length === 0 && skipped.length === 0) {
        setSyncError(
          `Failed to upload ${failed.length} race${failed.length === 1 ? "" : "s"}. ${failed[0]?.error ?? ""}`.trim(),
        );
      } else if (failed.length > 0) {
        setSyncMessage(
          `Uploaded ${succeeded.length}, ${failed.length} failed. Check details below.`,
        );
        setSyncError(
          failed.map((entry) => `${entry.name}: ${entry.error}`).join(" · "),
        );
      } else if (succeeded.length === 0 && skipped.length > 0) {
        clearPendingSyncRaces(userId);
        setHasPending(false);
        setSyncMessage("All races are up to date in the cloud.");
      } else {
        clearPendingSyncRaces(userId);
        setHasPending(false);
        const uploaded = [...succeeded, ...skipped];
        setSyncMessage(
          `Uploaded successfully at ${new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ${uploaded.length} race${uploaded.length === 1 ? "" : "s"} · bundle v${Math.max(...uploaded.map((entry) => entry.companionRevision ?? 0))}`,
        );
      }

      setLastSyncAt(userId, now);
      setLastSyncAtState(now);
      await refreshCloudStats();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sync failed.";
      setSyncError(message);
      throw err;
    } finally {
      setSyncing(false);
      setSyncingRaceId(null);
      setSyncProgress(null);
      setSyncInProgress(userId, false);
    }
  }, [accessToken, refreshCloudStats, userId]);

  return {
    configured,
    syncing,
    cloudRaceCount,
    maxCloudRevision,
    lastSyncAt,
    lastSyncLabel: formatRelativeTime(lastSyncAt),
    syncError,
    syncMessage,
    hasPending,
    pendingSyncRaces: userId ? getPendingSyncRaces(userId) : new Set<string>(),
    syncProgress,
    raceResults,
    syncingRaceId,
    syncToCompanion,
    syncNow: syncToCompanion,
    refreshCloudStats,
  };
}

export function recordSyncSuccess(userId: string): void {
  const now = new Date().toISOString();
  setLastSyncAt(userId, now);
  clearPendingSyncRaces(userId);
}

export function recordSyncFailure(userId: string, raceIds: string[]): void {
  for (const raceId of raceIds) {
    addPendingSyncRace(userId, raceId);
  }
}
