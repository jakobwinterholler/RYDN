import { fetchWithAuth, getApiBaseUrl, parseApiError } from "./client";
import { deleteCloudRaceDirect, fetchOriginalGpxDirect, fetchSyncRacesDirect } from "./cloudDirect";
import type { AuthProfile, CompanionBundle, SyncPushAllResult, SyncPushRaceResult, SyncRaceSummary } from "../types/sync";
import { fetchCompanionBundleSelfHealing } from "../sync/selfHealingBundle";
import { logSyncDebug } from "../sync/syncDebugLog";

export async function fetchAuthProfile(accessToken: string): Promise<AuthProfile> {
  const response = await fetchWithAuth("/api/auth/me", accessToken);
  if (!response.ok) {
    throw new Error(await parseApiError(response, "Failed to load profile."));
  }
  return response.json();
}

export async function fetchSyncRaces(accessToken: string): Promise<SyncRaceSummary[]> {
  if (!getApiBaseUrl()) {
    return fetchSyncRacesDirect();
  }
  const response = await fetchWithAuth("/api/sync/races", accessToken);
  if (!response.ok) {
    throw new Error(await parseApiError(response, "Failed to load cloud races."));
  }
  const payload = await response.json();
  const races: SyncRaceSummary[] = payload.races ?? [];
  return races.map((race) => ({
    ...race,
    version: race.version ?? race.companion_revision,
    bundle_version: race.bundle_version ?? race.companion_revision,
    bundle_checksum: race.bundle_checksum ?? null,
    bundle_schema_version: race.bundle_schema_version ?? null,
    significant_climb_count: race.significant_climb_count ?? null,
    gpx_fingerprint: race.gpx_fingerprint ?? null,
  }));
}

export async function fetchCompanionBundle(
  accessToken: string,
  raceId: string,
  userId?: string | null,
): Promise<CompanionBundle> {
  const result = await fetchCompanionBundleSelfHealing(accessToken, raceId, userId);
  if (result.healed) {
    logSyncDebug("self-healing", `Bundle healed for ${raceId}`, result.notes);
  }
  return result.bundle;
}

export async function fetchOriginalGpx(
  accessToken: string,
  raceId: string,
  userId?: string | null,
): Promise<ArrayBuffer> {
  if (!getApiBaseUrl()) {
    if (!userId) {
      throw new Error("User id required to download route GPX.");
    }
    return fetchOriginalGpxDirect(userId, raceId);
  }
  const response = await fetchWithAuth(`/api/sync/races/${raceId}/gpx`, accessToken);
  if (!response.ok) {
    throw new Error(await parseApiError(response, "Failed to download route GPX."));
  }
  return response.arrayBuffer();
}

export async function pushRaceNow(
  accessToken: string | null,
  raceId: string,
  userId?: string | null,
): Promise<SyncPushRaceResult> {
  const response = await fetchWithAuth("/api/sync/push-now", accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ race_id: raceId, user_id: userId ?? undefined }),
  });
  if (!response.ok) {
    throw new Error(await parseApiError(response, "Failed to sync race."));
  }
  const result = (await response.json()) as SyncPushRaceResult;
  return {
    ...result,
    companion_revision: result.companion_revision,
  };
}

export async function pushAllLocalRaces(
  accessToken: string | null,
  userId?: string | null,
): Promise<SyncPushAllResult> {
  const response = await fetchWithAuth("/api/sync/push-all", accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId ?? undefined }),
  });
  if (!response.ok) {
    throw new Error(await parseApiError(response, "Failed to sync local races."));
  }
  return response.json();
}

export { regenerateCompanionBundle } from "../sync/selfHealingBundle";

export async function queueRacePush(accessToken: string, raceId: string): Promise<void> {
  const response = await fetchWithAuth("/api/sync/push", accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ race_id: raceId }),
  });
  if (!response.ok) {
    throw new Error(await parseApiError(response, "Failed to queue race sync."));
  }
}

export async function deleteCloudRace(
  accessToken: string,
  raceId: string,
  userId?: string | null,
): Promise<void> {
  if (!getApiBaseUrl()) {
    if (!userId) {
      throw new Error("User id required to delete cloud race.");
    }
    await deleteCloudRaceDirect(userId, raceId);
    return;
  }
  const response = await fetchWithAuth(`/api/races/${raceId}`, accessToken, { method: "DELETE" });
  if (response.status === 404 && userId) {
    await deleteCloudRaceDirect(userId, raceId);
    return;
  }
  if (!response.ok) {
    throw new Error(await parseApiError(response, "Failed to delete race."));
  }
}
