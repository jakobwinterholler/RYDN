/**
 * Sync race version / download decision tests.
 * Run: npx tsx shared/sync/raceVersion.test.ts
 */

import assert from "node:assert/strict";
import type { SyncRaceSummary } from "../types/sync";
import {
  isDesktopCloudCurrent,
  localBundleIsCurrent,
  needsCompanionDownload,
  needsDesktopUpload,
  resolveCloudRaceForLocal,
} from "./raceVersion";

function baseRace(overrides: Partial<SyncRaceSummary> = {}): SyncRaceSummary {
  return {
    id: "626b3103-c50d-49eb-b5de-8a129a5f27f3",
    name: "Conserolla Runde",
    distance_km: 39.01,
    elevation_gain_m: 727,
    companion_revision: 5,
    updated_at: "2026-07-15T13:02:44+00:00",
    analyzed_at: "2026-07-15T13:02:44+00:00",
    has_bundle: true,
    bundle_checksum: "abc123",
    bundle_schema_version: 5,
    significant_climb_count: 2,
    gpx_fingerprint: "c19c3ee71994c636",
    ...overrides,
  };
}

function testClimbCountMismatchTriggersDownload() {
  const cloud = baseRace({ significant_climb_count: 2 });
  assert.equal(needsCompanionDownload(cloud, 5, true, "abc123", 1), true);
}

function testMatchingClimbCountDoesNotTriggerDownload() {
  const cloud = baseRace({ significant_climb_count: 2 });
  assert.equal(needsCompanionDownload(cloud, 5, true, "abc123", 2), false);
}

function testHigherRevisionStillTriggersDownload() {
  const cloud = baseRace({ companion_revision: 6, significant_climb_count: 2 });
  assert.equal(needsCompanionDownload(cloud, 5, true, "abc123", 2), true);
}

function testMissingCloudMetadataTriggersDownload() {
  const cloud = baseRace({
    bundle_schema_version: null,
    significant_climb_count: null,
  });
  assert.equal(needsCompanionDownload(cloud, 22, true, "abc123", 0), true);
}

function testMissingCloudMetadataDoesNotReDownloadWhenLocalBundleCurrent() {
  const cloud = baseRace({
    bundle_schema_version: null,
    significant_climb_count: null,
    companion_revision: 22,
  });
  assert.equal(
    needsCompanionDownload(cloud, 22, true, "abc123", 2, 5),
    false,
  );
  assert.equal(
    localBundleIsCurrent(cloud, 22, true, 2, 5),
    true,
  );
}

function testMissingCloudMetadataTriggersDesktopUpload() {
  const local = {
    id: "d836e1d9-1fa9-49ea-8476-694c6c00d090",
    updated_at: "2026-07-14T00:14:02.862406+00:00",
    has_analysis: true,
    gpx_fingerprint: "6e5333b6e8b2d663",
  };
  const cloud = baseRace({
    id: local.id,
    name: "THE CAPITALS 2026",
    companion_revision: 22,
    updated_at: "2026-07-15T04:54:06.545+00:00",
    bundle_schema_version: null,
    significant_climb_count: null,
    gpx_fingerprint: local.gpx_fingerprint,
  });
  assert.equal(needsDesktopUpload(local, cloud, new Set()), true);
}

function testResolveCloudRaceUsesFingerprint() {
  const local = {
    id: "b7a1c487-80c6-477c-87ae-ec9dd32b900c",
    gpx_fingerprint: "c19c3ee71994c636",
  };
  const cloudRaces = [
    baseRace({
      id: "b7a1c487-80c6-477c-87ae-ec9dd32b900c",
      companion_revision: 2,
    }),
    baseRace({
      id: "626b3103-c50d-49eb-b5de-8a129a5f27f3",
      companion_revision: 11,
    }),
  ];
  const resolved = resolveCloudRaceForLocal(local, cloudRaces);
  assert.equal(resolved?.id, "626b3103-c50d-49eb-b5de-8a129a5f27f3");
}

function testPendingDoesNotForceUploadWhenCloudIsCurrent() {
  const local = {
    id: "b7a1c487-80c6-477c-87ae-ec9dd32b900c",
    updated_at: "2026-07-15T13:02:44+00:00",
    has_analysis: true,
    gpx_fingerprint: "c19c3ee71994c636",
  };
  const cloud = baseRace({
    id: "626b3103-c50d-49eb-b5de-8a129a5f27f3",
    updated_at: "2026-07-15T13:02:44+00:00",
  });
  assert.equal(isDesktopCloudCurrent(local, cloud), true);
  assert.equal(needsDesktopUpload(local, cloud, new Set([local.id])), false);
}

testPendingDoesNotForceUploadWhenCloudIsCurrent();
testClimbCountMismatchTriggersDownload();
testMatchingClimbCountDoesNotTriggerDownload();
testHigherRevisionStillTriggersDownload();
testMissingCloudMetadataTriggersDownload();
testMissingCloudMetadataDoesNotReDownloadWhenLocalBundleCurrent();
testMissingCloudMetadataTriggersDesktopUpload();
testResolveCloudRaceUsesFingerprint();

console.log("raceVersion.test.ts: all tests passed");
