import { useCallback, useEffect, useRef } from "react";
import { useAuth } from "@shared/auth/AuthProvider";
import { submitCompanionVerifications } from "@shared/api/verifications";
import {
  applySyncedVerificationsToBundle,
} from "@shared/race/applyVerificationToBundle";
import type { CompanionBundle } from "@shared/types/sync";
import {
  loadPendingVerifications,
  markVerificationsSynced,
  removeSyncedVerifications,
} from "../lib/verificationQueue";
import { logSyncDebug } from "@shared/sync/syncDebugLog";

export async function syncPendingVerifications(
  accessToken: string,
  userId: string | null,
  online: boolean,
  options?: {
    getBundle?: () => CompanionBundle | null;
    onBundleUpdate?: (bundle: CompanionBundle) => void;
  },
): Promise<void> {
  if (!online) {
    return;
  }
  const pending = await loadPendingVerifications();
  if (pending.length === 0) {
    return;
  }
  const result = await submitCompanionVerifications(
    accessToken,
    pending.map(({ synced: _synced, ...submission }) => submission),
    userId,
  );
  const accepted = new Set(result.accepted ?? []);
  const syncedItems = pending.filter((item) => accepted.has(item.id));
  const syncedIds = syncedItems.map((item) => item.id);
  if (syncedIds.length > 0) {
    await markVerificationsSynced(syncedIds);
    await removeSyncedVerifications();
    const currentBundle = options?.getBundle?.() ?? null;
    if (currentBundle && options?.onBundleUpdate) {
      const next = applySyncedVerificationsToBundle(
        currentBundle,
        syncedItems.map(({ synced: _synced, ...submission }) => submission),
      );
      options.onBundleUpdate(next);
    }
  }
}

export function useVerificationSync(
  online: boolean,
  userId: string | null,
  options?: {
    getBundle?: () => CompanionBundle | null;
    onBundleUpdate?: (bundle: CompanionBundle) => void;
  },
) {
  const { session } = useAuth();
  const syncingRef = useRef(false);
  const getBundleRef = useRef(options?.getBundle);
  getBundleRef.current = options?.getBundle;

  const syncNow = useCallback(async () => {
    if (!session?.access_token || syncingRef.current) {
      return;
    }
    syncingRef.current = true;
    try {
      await syncPendingVerifications(session.access_token, userId, online, {
        getBundle: () => getBundleRef.current?.() ?? null,
        onBundleUpdate: options?.onBundleUpdate,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logSyncDebug("verification-sync", `Pending verification sync failed: ${message}`);
    } finally {
      syncingRef.current = false;
    }
  }, [online, options?.onBundleUpdate, session?.access_token, userId]);

  useEffect(() => {
    if (online && session?.access_token) {
      void syncNow();
    }
  }, [online, session?.access_token, syncNow]);

  useEffect(() => {
    const onOnline = () => void syncNow();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [syncNow]);

  return { syncVerificationsNow: syncNow };
}
