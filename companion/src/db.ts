import type { CompanionBundle, SyncRaceSummary } from "@shared/types/sync";
import { migrateCachedBundle } from "@shared/sync/bundleMigration";
import { validateCompanionBundle, verifyStoredChecksum } from "@shared/sync/bundleValidation";
import { computeBundleChecksumSync } from "@shared/sync/bundleChecksum";
import { deleteVerificationsForRace } from "./lib/verificationQueue";

const DB_NAME = "race-companion";
const DB_VERSION = 5;
const BUNDLE_STORE = "bundles";
const LIST_STORE = "raceList";
const META_STORE = "meta";
const GPX_STORE = "gpx";
const ACTIVE_KEY = "active-race-id";
const RESUPPLY_FILTER_KEY = "companion-resupply-filter";

export interface StoredRaceListItem extends SyncRaceSummary {
  downloadedRevision: number | null;
  downloadedChecksum: string | null;
  downloadedClimbCount?: number | null;
  offlineReady: boolean;
  /** Where this race entry came from — cloud sync or on-device import. */
  source?: "cloud" | "local-import";
  lastOpenedAt?: string | null;
  verified_percent?: number | null;
  verified_stops_count?: number | null;
}

function computeVerifiedPercent(bundle: CompanionBundle): number | null {
  const verified = bundle.dashboardStats?.verifiedStops ?? 0;
  const unverified = bundle.dashboardStats?.unverifiedStops ?? 0;
  const total = verified + unverified;
  if (total <= 0) {
    return 0;
  }
  return Math.round((verified / total) * 100);
}

export function openCompanionDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(BUNDLE_STORE)) {
        db.createObjectStore(BUNDLE_STORE, { keyPath: "race.id" });
      }
      if (!db.objectStoreNames.contains(LIST_STORE)) {
        db.createObjectStore(LIST_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE);
      }
      if (!db.objectStoreNames.contains(GPX_STORE)) {
        db.createObjectStore(GPX_STORE, { keyPath: "raceId" });
      }
      if (!db.objectStoreNames.contains("verifications")) {
        const store = db.createObjectStore("verifications", { keyPath: "id" });
        store.createIndex("raceId", "raceId", { unique: false });
        store.createIndex("synced", "synced", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB failed."));
  });
}

export async function saveRaceList(races: StoredRaceListItem[]): Promise<void> {
  const db = await openCompanionDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(LIST_STORE, "readwrite");
    const store = tx.objectStore(LIST_STORE);
    store.clear();
    for (const race of races) {
      store.put(race);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to save race list."));
  });
  db.close();
}

export async function loadRaceList(): Promise<StoredRaceListItem[]> {
  const db = await openCompanionDb();
  const races = await new Promise<StoredRaceListItem[]>((resolve, reject) => {
    const tx = db.transaction(LIST_STORE, "readonly");
    const request = tx.objectStore(LIST_STORE).getAll();
    request.onsuccess = () =>
      resolve(
        ((request.result as StoredRaceListItem[]) ?? []).map((race) => ({
          ...race,
          downloadedChecksum: race.downloadedChecksum ?? null,
        })),
      );
    request.onerror = () => reject(request.error ?? new Error("Failed to load race list."));
  });
  db.close();
  return races.sort((left, right) =>
    (right.updated_at ?? "").localeCompare(left.updated_at ?? ""),
  );
}

export async function saveCompanionBundle(
  bundle: CompanionBundle,
  options?: {
    /** Set when replacing cache from a cloud download (before local verification patches). */
    syncFromCloud?: {
      revision: number;
      checksum: string | null;
      climbCount: number | null;
    };
  },
): Promise<void> {
  const prepared = migrateCachedBundle(bundle) ?? bundle;
  const validation = validateCompanionBundle(prepared);
  if (!validation.valid) {
    throw new Error(`Invalid bundle: ${validation.errors.join(", ")}`);
  }
  if (!prepared.bundleChecksum) {
    prepared.bundleChecksum = computeBundleChecksumSync(prepared);
  }
  if (!verifyStoredChecksum(prepared)) {
    prepared.bundleChecksum = computeBundleChecksumSync(prepared);
  }
  if (!verifyStoredChecksum(prepared)) {
    throw new Error("Bundle checksum mismatch — refusing to cache stale data.");
  }

  const db = await openCompanionDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([BUNDLE_STORE, LIST_STORE], "readwrite");
    tx.objectStore(BUNDLE_STORE).put(prepared);

    const listStore = tx.objectStore(LIST_STORE);
    const getRequest = listStore.get(prepared.race.id);
    getRequest.onsuccess = () => {
      const existing = getRequest.result as StoredRaceListItem | undefined;
      const revision = prepared.revision ?? prepared.bundle_version ?? existing?.companion_revision ?? 0;
      const checksum = prepared.bundleChecksum ?? null;
      const climbCount = prepared.climbs?.length ?? null;
      const downloadedRevision =
        options?.syncFromCloud?.revision ??
        existing?.downloadedRevision ??
        revision;
      const downloadedChecksum =
        options?.syncFromCloud?.checksum ??
        existing?.downloadedChecksum ??
        checksum;
      const downloadedClimbCount =
        options?.syncFromCloud?.climbCount ??
        existing?.downloadedClimbCount ??
        climbCount;
      if (existing) {
        listStore.put({
          ...existing,
          downloadedRevision,
          downloadedChecksum,
          downloadedClimbCount,
          offlineReady: true,
          readiness_score: prepared.dashboardStats?.readinessScore ?? existing.readiness_score ?? null,
          verified_percent: computeVerifiedPercent(prepared),
          verified_stops_count: prepared.dashboardStats?.verifiedStops ?? null,
        });
        return;
      }
      listStore.put({
        id: prepared.race.id,
        name: prepared.race.name,
        distance_km: prepared.race.distanceKm,
        elevation_gain_m: prepared.race.elevationGainM,
        companion_revision: revision,
        version: revision,
        bundle_version: revision,
        bundle_checksum: checksum,
        updated_at: prepared.syncedAt ?? prepared.exportedAt,
        analyzed_at: prepared.race.analyzedAt ?? null,
        has_bundle: true,
        downloadedRevision,
        downloadedChecksum,
        downloadedClimbCount,
        offlineReady: true,
        readiness_score: prepared.dashboardStats?.readinessScore ?? null,
        verified_percent: computeVerifiedPercent(prepared),
        verified_stops_count: prepared.dashboardStats?.verifiedStops ?? null,
        source: "local-import",
        lastOpenedAt: new Date().toISOString(),
      });
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to save race."));
  });
  localStorage.setItem(ACTIVE_KEY, prepared.race.id);
  db.close();
}

export async function loadActiveCompanionBundle(): Promise<CompanionBundle | null> {
  const activeId = localStorage.getItem(ACTIVE_KEY);
  if (!activeId) {
    return null;
  }
  return loadCompanionBundle(activeId);
}

export async function loadCompanionBundle(raceId: string): Promise<CompanionBundle | null> {
  const db = await openCompanionDb();
  const bundle = await new Promise<CompanionBundle | null>((resolve, reject) => {
    const tx = db.transaction(BUNDLE_STORE, "readonly");
    const request = tx.objectStore(BUNDLE_STORE).get(raceId);
    request.onsuccess = () => resolve((request.result as CompanionBundle | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error("Failed to load race."));
  });
  db.close();
  if (!bundle) {
    return null;
  }
  const migrated = migrateCachedBundle(bundle);
  if (!migrated) {
    return null;
  }
  if (migrated !== bundle) {
    await saveCompanionBundle(migrated);
    return migrated;
  }
  const validation = validateCompanionBundle(migrated);
  if (!validation.valid || !verifyStoredChecksum(migrated)) {
    return null;
  }
  return migrated;
}

export async function hasValidCompanionBundle(raceId: string): Promise<boolean> {
  const bundle = await loadCompanionBundle(raceId);
  return bundle !== null;
}

/** Remove a stale cached bundle and mark the race as not offline-ready. */
export async function invalidateStaleBundle(raceId: string): Promise<void> {
  const db = await openCompanionDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([BUNDLE_STORE, LIST_STORE, GPX_STORE], "readwrite");
    tx.objectStore(BUNDLE_STORE).delete(raceId);
    tx.objectStore(GPX_STORE).delete(raceId);

    const listStore = tx.objectStore(LIST_STORE);
    const getRequest = listStore.get(raceId);
    getRequest.onsuccess = () => {
      const existing = getRequest.result as StoredRaceListItem | undefined;
      if (existing) {
        listStore.put({
          ...existing,
          offlineReady: false,
          downloadedRevision: null,
          downloadedChecksum: null,
          downloadedClimbCount: null,
        });
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to invalidate stale bundle."));
  });
  const activeId = localStorage.getItem(ACTIVE_KEY);
  if (activeId === raceId) {
    localStorage.removeItem(ACTIVE_KEY);
  }
  db.close();
}

/** Remove all local data for a race (bundle, GPX, list entry, verifications). */
export async function deleteCompanionRace(raceId: string): Promise<void> {
  await deleteVerificationsForRace(raceId);

  const db = await openCompanionDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([BUNDLE_STORE, LIST_STORE, GPX_STORE], "readwrite");
    tx.objectStore(BUNDLE_STORE).delete(raceId);
    tx.objectStore(GPX_STORE).delete(raceId);
    tx.objectStore(LIST_STORE).delete(raceId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to delete race."));
  });
  db.close();

  const activeId = localStorage.getItem(ACTIVE_KEY);
  if (activeId === raceId) {
    localStorage.removeItem(ACTIVE_KEY);
  }
}

export async function saveOriginalGpx(raceId: string, bytes: ArrayBuffer): Promise<void> {
  const db = await openCompanionDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(GPX_STORE, "readwrite");
    tx.objectStore(GPX_STORE).put({
      raceId,
      bytes,
      cachedAt: new Date().toISOString(),
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to cache route GPX."));
  });
  db.close();
}

export async function loadOriginalGpx(raceId: string): Promise<ArrayBuffer | null> {
  const db = await openCompanionDb();
  const record = await new Promise<{ bytes: ArrayBuffer } | undefined>((resolve, reject) => {
    const tx = db.transaction(GPX_STORE, "readonly");
    const request = tx.objectStore(GPX_STORE).get(raceId);
    request.onsuccess = () => resolve(request.result as { bytes: ArrayBuffer } | undefined);
    request.onerror = () => reject(request.error ?? new Error("Failed to load route GPX."));
  });
  db.close();
  return record?.bytes ?? null;
}

export async function clearCompanionData(): Promise<void> {
  localStorage.removeItem(ACTIVE_KEY);
  localStorage.removeItem(RESUPPLY_FILTER_KEY);
  const db = await openCompanionDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(
      [BUNDLE_STORE, LIST_STORE, META_STORE, GPX_STORE, "verifications"],
      "readwrite",
    );
    tx.objectStore(BUNDLE_STORE).clear();
    tx.objectStore(LIST_STORE).clear();
    tx.objectStore(META_STORE).clear();
    tx.objectStore(GPX_STORE).clear();
    if (tx.objectStoreNames.contains("verifications")) {
      tx.objectStore("verifications").clear();
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to clear data."));
  });
  db.close();
}

/** Developer tool: wipe all local race caches and service worker caches. */
export async function resetLocalRaceCache(): Promise<void> {
  await clearCompanionData();

  if (typeof caches !== "undefined") {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }

  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  }
}

export async function setActiveRaceId(raceId: string): Promise<void> {
  localStorage.setItem(ACTIVE_KEY, raceId);
  const list = await loadRaceList();
  const updated = list.map((race) =>
    race.id === raceId
      ? { ...race, lastOpenedAt: new Date().toISOString() }
      : race,
  );
  if (updated.some((race, index) => race.lastOpenedAt !== list[index]?.lastOpenedAt)) {
    await saveRaceList(updated);
  }
}

export async function estimateCompanionStorageBytes(): Promise<number | null> {
  if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      if (typeof estimate.usage === "number") {
        return estimate.usage;
      }
    } catch {
      return null;
    }
  }
  return null;
}
