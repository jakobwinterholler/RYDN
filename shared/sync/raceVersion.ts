import type { SyncRaceSummary } from "../types/sync";
import { CURRENT_SCHEMA_VERSION } from "./bundleContract";

/** Normalized race version fields (companion_revision is the source of truth). */
export interface RaceVersionFields {
  version: number;
  bundleVersion: number;
  updatedAt: string | null;
}

export function raceVersionFields(race: {
  companion_revision?: number;
  version?: number;
  bundle_version?: number;
  updated_at?: string | null;
}): RaceVersionFields {
  const revision = race.companion_revision ?? race.version ?? race.bundle_version ?? 0;
  return {
    version: revision,
    bundleVersion: race.bundle_version ?? revision,
    updatedAt: race.updated_at ?? null,
  };
}

/** Pick the canonical cloud row for a local race (fingerprint wins over id). */
export function resolveCloudRaceForLocal(
  local: { id: string; gpx_fingerprint?: string | null },
  cloudRaces: SyncRaceSummary[],
): SyncRaceSummary | undefined {
  const fingerprint = local.gpx_fingerprint?.trim();
  if (fingerprint) {
    const matches = cloudRaces.filter((race) => race.gpx_fingerprint === fingerprint);
    if (matches.length > 0) {
      return [...matches].sort(
        (left, right) =>
          (right.companion_revision ?? 0) - (left.companion_revision ?? 0),
      )[0];
    }
  }
  return cloudRaces.find((race) => race.id === local.id);
}

function cloudBundleMetadataIsStale(cloud: SyncRaceSummary): boolean {
  if (!cloud.has_bundle) {
    return false;
  }
  if (cloud.bundle_schema_version == null || cloud.significant_climb_count == null) {
    return true;
  }
  if (cloud.bundle_schema_version < CURRENT_SCHEMA_VERSION) {
    return true;
  }
  return false;
}

/** True when a cached local bundle matches or exceeds the cloud revision. */
export function localBundleIsCurrent(
  cloud: SyncRaceSummary,
  downloadedRevision: number | null,
  offlineReady: boolean,
  downloadedClimbCount?: number | null,
  localSchemaVersion?: number | null,
): boolean {
  if (!cloud.has_bundle || !offlineReady || downloadedRevision === null) {
    return false;
  }
  const { version } = raceVersionFields(cloud);
  if (downloadedRevision < version) {
    return false;
  }
  if (localSchemaVersion == null || localSchemaVersion < CURRENT_SCHEMA_VERSION) {
    return false;
  }
  if (
    cloud.significant_climb_count != null &&
    downloadedClimbCount != null &&
    cloud.significant_climb_count !== downloadedClimbCount
  ) {
    return false;
  }
  if (
    cloud.bundle_schema_version != null &&
    cloud.bundle_schema_version < CURRENT_SCHEMA_VERSION
  ) {
    return false;
  }
  return true;
}

export function needsCompanionDownload(
  cloud: SyncRaceSummary,
  downloadedRevision: number | null,
  offlineReady: boolean,
  _downloadedChecksum?: string | null,
  downloadedClimbCount?: number | null,
  localSchemaVersion?: number | null,
): boolean {
  if (!cloud.has_bundle) {
    return false;
  }
  if (!offlineReady || downloadedRevision === null) {
    return true;
  }
  const { version } = raceVersionFields(cloud);
  if (version > downloadedRevision) {
    return true;
  }
  if (
    localBundleIsCurrent(
      cloud,
      downloadedRevision,
      offlineReady,
      downloadedClimbCount,
      localSchemaVersion,
    )
  ) {
    return false;
  }
  if (cloudBundleMetadataIsStale(cloud)) {
    return true;
  }
  if (
    cloud.significant_climb_count != null &&
    downloadedClimbCount != null &&
    cloud.significant_climb_count !== downloadedClimbCount
  ) {
    return true;
  }
  const cloudSchema = cloud.bundle_schema_version;
  if (cloudSchema != null && cloudSchema < CURRENT_SCHEMA_VERSION) {
    return true;
  }
  return false;
}

/** True when the cloud already has an up-to-date bundle for this local race. */
export function isDesktopCloudCurrent(
  local: {
    updated_at: string;
    has_analysis: boolean;
  },
  cloud: SyncRaceSummary | undefined,
): boolean {
  if (!local.has_analysis || !cloud?.has_bundle) {
    return false;
  }
  if (cloudBundleMetadataIsStale(cloud)) {
    return false;
  }
  const localTime = new Date(local.updated_at).getTime();
  const cloudTime = cloud.updated_at ? new Date(cloud.updated_at).getTime() : 0;
  return cloudTime + 1000 >= localTime;
}

export function needsDesktopUpload(
  local: {
    id: string;
    updated_at: string;
    has_analysis: boolean;
  },
  cloud: SyncRaceSummary | undefined,
  pendingSync: Set<string>,
): boolean {
  if (!local.has_analysis) {
    return false;
  }
  if (isDesktopCloudCurrent(local, cloud)) {
    return false;
  }
  if (pendingSync.has(local.id)) {
    return true;
  }
  if (!cloud) {
    return true;
  }
  if (!cloud.has_bundle) {
    return true;
  }
  if (cloudBundleMetadataIsStale(cloud)) {
    return true;
  }
  const localTime = new Date(local.updated_at).getTime();
  const cloudTime = cloud.updated_at ? new Date(cloud.updated_at).getTime() : 0;
  return localTime > cloudTime + 1000;
}

export function formatUpdateSummary(input: {
  newCount: number;
  updatedCount: number;
  failedCount: number;
}): string {
  const parts: string[] = [];
  if (input.newCount > 0) {
    parts.push(`${input.newCount} new race${input.newCount === 1 ? "" : "s"}`);
  }
  if (input.updatedCount > 0) {
    parts.push(`${input.updatedCount} route${input.updatedCount === 1 ? "" : "s"} updated`);
  }
  if (parts.length === 0 && input.failedCount === 0) {
    return "No updates";
  }
  if (input.failedCount > 0) {
    parts.push(`${input.failedCount} failed`);
  }
  return parts.join(" · ");
}
