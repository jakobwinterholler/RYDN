import { useCallback, useEffect, useRef, useState } from "react";
import { fetchSyncRaces } from "@shared/api/sync";
import { useAuth } from "@shared/auth/AuthProvider";
import { formatUpdateSummary, needsCompanionDownload } from "@shared/sync/raceVersion";
import { logSyncDebug } from "@shared/sync/syncDebugLog";
import { setLastCheckAt, setLastSyncAt } from "@shared/sync/syncMeta";
import { downloadRaceAssets } from "../lib/downloadRaceAssets";
import { liveBundleRef } from "../lib/liveBundleRef";
import { loadCompanionBundle, loadRaceList } from "../db";
import { useCloudRaceList } from "./useCloudRaceList";
import type { SyncToastVariant } from "../components/CompanionSyncToast";

export interface AutoCloudSyncState {
  autoSyncing: boolean;
  syncToast: { message: string; variant: SyncToastVariant } | null;
  dismissSyncToast: () => void;
  retrySync: () => void;
}

/**
 * Silently sync cloud race bundles in the background on startup and when back online.
 * Shows a brief success toast or a retryable error — no persistent banners.
 */
export function useAutoCloudSync(): AutoCloudSyncState {
  const { user, accessToken } = useAuth();
  const userId = user?.id ?? "";
  const { refresh, loading } = useCloudRaceList();
  const [autoSyncing, setAutoSyncing] = useState(false);
  const [syncToast, setSyncToast] = useState<{ message: string; variant: SyncToastVariant } | null>(
    null,
  );
  const ranRef = useRef(false);
  const syncingRef = useRef(false);
  const online = typeof navigator !== "undefined" ? navigator.onLine : true;

  const runAutoSync = useCallback(async () => {
    if (!accessToken || !userId || !online || syncingRef.current) {
      return;
    }
    syncingRef.current = true;
    setAutoSyncing(true);
    setSyncToast(null);
    try {
      logSyncDebug("auto-sync", "Background cloud sync");
      await refresh();
      const [cloudRaces, localRaces] = await Promise.all([
        fetchSyncRaces(accessToken),
        loadRaceList(),
      ]);
      const localById = new Map(localRaces.map((race) => [race.id, race]));
      const toDownload: Array<{ id: string; name: string; kind: "new" | "updated" }> = [];

      const activeRaceId = liveBundleRef.current?.race.id ?? null;

      for (const cloudRace of cloudRaces) {
        if (!cloudRace.has_bundle) {
          continue;
        }
        if (cloudRace.id === activeRaceId) {
          // Never swap the bundle out from under a rider who has this race open.
          // The in-race update banner lets them apply it deliberately.
          logSyncDebug("auto-sync", `Skipping active race ${cloudRace.name} (open in workspace)`);
          continue;
        }
        const local = localById.get(cloudRace.id);
        const localBundle = local ? await loadCompanionBundle(cloudRace.id) : null;
        const needsDownload = needsCompanionDownload(
          cloudRace,
          local?.downloadedRevision ?? null,
          local?.offlineReady ?? false,
          local?.downloadedChecksum,
          local?.downloadedClimbCount ?? localBundle?.climbs?.length ?? null,
          localBundle?.schemaVersion ?? null,
        );
        if (needsDownload) {
          const kind = !local?.offlineReady ? "new" : "updated";
          toDownload.push({ id: cloudRace.id, name: cloudRace.name, kind });
        }
      }

      const now = new Date().toISOString();
      setLastCheckAt(userId, now);

      if (toDownload.length === 0) {
        return;
      }

      logSyncDebug("auto-sync", `Downloading ${toDownload.length} race(s)`, toDownload);
      let newCount = 0;
      let updatedCount = 0;
      let failedCount = 0;
      const failedNames: string[] = [];

      for (const target of toDownload) {
        try {
          await downloadRaceAssets(accessToken, target.id, user?.id);
          if (target.kind === "new") {
            newCount += 1;
          } else {
            updatedCount += 1;
          }
        } catch (err) {
          failedCount += 1;
          failedNames.push(target.name);
          logSyncDebug(
            "auto-sync",
            `${target.name} download failed: ${err instanceof Error ? err.message : "unknown"}`,
          );
        }
      }

      await refresh();
      if (newCount + updatedCount > 0) {
        setLastSyncAt(userId, now);
        setSyncToast({
          message: formatUpdateSummary({ newCount, updatedCount, failedCount }),
          variant: "success",
        });
      } else if (failedCount > 0) {
        setSyncToast({
          message: `Could not sync ${failedNames.slice(0, 2).join(", ")}${
            failedNames.length > 2 ? ` +${failedNames.length - 2} more` : ""
          }`,
          variant: "error",
        });
      }
    } catch (err) {
      logSyncDebug(
        "auto-sync",
        `Background sync failed: ${err instanceof Error ? err.message : "unknown"}`,
      );
      setSyncToast({
        message: err instanceof Error ? err.message : "Sync failed. Check your connection.",
        variant: "error",
      });
    } finally {
      syncingRef.current = false;
      setAutoSyncing(false);
    }
  }, [accessToken, online, refresh, user?.id, userId]);

  useEffect(() => {
    if (loading || ranRef.current || !accessToken || !userId) {
      return;
    }
    ranRef.current = true;
    void runAutoSync();
  }, [accessToken, loading, runAutoSync, userId]);

  useEffect(() => {
    const onOnline = () => {
      void runAutoSync();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [runAutoSync]);

  const dismissSyncToast = useCallback(() => {
    setSyncToast(null);
  }, []);

  const retrySync = useCallback(() => {
    void runAutoSync();
  }, [runAutoSync]);

  return { autoSyncing, syncToast, dismissSyncToast, retrySync };
}
