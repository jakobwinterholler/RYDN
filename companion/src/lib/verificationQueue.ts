import type { CompanionVerificationSubmission } from "@shared/types/verification";
import { openCompanionDb } from "../db";

const VERIFICATIONS_STORE = "verifications";

export interface StoredVerification extends CompanionVerificationSubmission {
  synced: boolean;
}

export async function queueVerification(
  submission: CompanionVerificationSubmission,
): Promise<void> {
  const db = await openCompanionDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(VERIFICATIONS_STORE, "readwrite");
    tx.objectStore(VERIFICATIONS_STORE).put({ ...submission, synced: false });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to queue verification."));
  });
  db.close();
}

export async function loadPendingVerifications(raceId?: string): Promise<StoredVerification[]> {
  const db = await openCompanionDb();
  const items = await new Promise<StoredVerification[]>((resolve, reject) => {
    const tx = db.transaction(VERIFICATIONS_STORE, "readonly");
    const store = tx.objectStore(VERIFICATIONS_STORE);
    const request = raceId
      ? store.index("raceId").getAll(raceId)
      : store.getAll();
    request.onsuccess = () => resolve((request.result as StoredVerification[]) ?? []);
    request.onerror = () => reject(request.error ?? new Error("Failed to load verifications."));
  });
  db.close();
  return items.filter((item) => !item.synced);
}

export async function markVerificationsSynced(ids: string[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  const db = await openCompanionDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(VERIFICATIONS_STORE, "readwrite");
    const store = tx.objectStore(VERIFICATIONS_STORE);
    for (const id of ids) {
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const record = getReq.result as StoredVerification | undefined;
        if (record) {
          store.put({ ...record, synced: true });
        }
      };
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to mark verifications synced."));
  });
  db.close();
}

export async function removeSyncedVerifications(): Promise<void> {
  const db = await openCompanionDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(VERIFICATIONS_STORE, "readwrite");
    const store = tx.objectStore(VERIFICATIONS_STORE);
    const request = store.getAll();
    request.onsuccess = () => {
      const items = (request.result as StoredVerification[]) ?? [];
      for (const item of items) {
        if (item.synced) {
          store.delete(item.id);
        }
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to clean verifications."));
  });
  db.close();
}

export async function deleteVerificationsForRace(raceId: string): Promise<void> {
  const db = await openCompanionDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(VERIFICATIONS_STORE, "readwrite");
    const store = tx.objectStore(VERIFICATIONS_STORE);
    const request = store.index("raceId").getAll(raceId);
    request.onsuccess = () => {
      const items = (request.result as StoredVerification[]) ?? [];
      for (const item of items) {
        store.delete(item.id);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to delete verifications."));
  });
  db.close();
}

export async function deleteVerification(id: string): Promise<void> {
  const db = await openCompanionDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(VERIFICATIONS_STORE, "readwrite");
    tx.objectStore(VERIFICATIONS_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to delete verification."));
  });
  db.close();
}
