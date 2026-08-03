import { fetchCompanionBundle, fetchOriginalGpx } from "@shared/api/sync";
import { applyVerificationToBundle } from "@shared/race/applyVerificationToBundle";
import type { CompanionBundle } from "@shared/types/sync";
import { logSyncDebug } from "@shared/sync/syncDebugLog";
import { saveCompanionBundle, saveOriginalGpx } from "../db";
import { loadPendingVerifications } from "./verificationQueue";

const downloadingRaceIds = new Set<string>();

export function isRaceDownloading(raceId: string): boolean {
  return downloadingRaceIds.has(raceId);
}

export async function downloadRaceAssets(
  accessToken: string,
  raceId: string,
  userId: string | null | undefined,
): Promise<CompanionBundle> {
  if (downloadingRaceIds.has(raceId)) {
    throw new Error("Download already in progress for this race.");
  }
  downloadingRaceIds.add(raceId);
  try {
    const pending = await loadPendingVerifications(raceId);
    logSyncDebug("download", `Fetching race ${raceId} with self-healing sync`);

    const [downloaded, gpx] = await Promise.all([
      fetchCompanionBundle(accessToken, raceId, userId),
      fetchOriginalGpx(accessToken, raceId, userId),
    ]);
    const cloudRevision = downloaded.revision ?? downloaded.bundle_version ?? 0;
    const cloudChecksum = downloaded.bundleChecksum ?? null;
    const cloudClimbCount = downloaded.climbs?.length ?? null;
    let bundle: CompanionBundle = downloaded;
    for (const { synced: _synced, ...submission } of pending) {
      bundle = applyVerificationToBundle(bundle, submission);
    }
    if (pending.length > 0) {
      logSyncDebug("download", `Re-applied ${pending.length} pending verification(s) after download`);
    }
    await saveCompanionBundle(bundle, {
      syncFromCloud: {
        revision: cloudRevision,
        checksum: cloudChecksum,
        climbCount: cloudClimbCount,
      },
    });
    await saveOriginalGpx(raceId, gpx);
    return bundle;
  } finally {
    downloadingRaceIds.delete(raceId);
  }
}
