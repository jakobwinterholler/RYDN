/**
 * bundleNeedsUpdate decision tests.
 * Run: npx tsx shared/sync/bundleValidation.test.ts
 */

import assert from "node:assert/strict";
import { bundleNeedsUpdate } from "./bundleValidation";

function testSameRevisionVerificationDriftDoesNotNeedUpdate() {
  const needs = bundleNeedsUpdate({
    cloudRevision: 9,
    cloudChecksum: "cloud-abc",
    localRevision: 9,
    localChecksum: "local-verified-xyz",
    downloadedChecksum: "cloud-abc",
    offlineReady: true,
    cloudClimbCount: 2,
    localClimbCount: 2,
  });
  assert.equal(needs, false);
}

function testHigherCloudRevisionNeedsUpdate() {
  const needs = bundleNeedsUpdate({
    cloudRevision: 10,
    cloudChecksum: "cloud-abc",
    localRevision: 9,
    localChecksum: "local-abc",
    downloadedChecksum: "local-abc",
    offlineReady: true,
  });
  assert.equal(needs, true);
}

function testClimbCountMismatchNeedsUpdate() {
  const needs = bundleNeedsUpdate({
    cloudRevision: 9,
    cloudChecksum: "cloud-abc",
    localRevision: 9,
    localChecksum: "cloud-abc",
    downloadedChecksum: "cloud-abc",
    offlineReady: true,
    cloudClimbCount: 2,
    localClimbCount: 1,
  });
  assert.equal(needs, true);
}

testSameRevisionVerificationDriftDoesNotNeedUpdate();
testHigherCloudRevisionNeedsUpdate();
testClimbCountMismatchNeedsUpdate();

console.log("bundleValidation.test.ts: all tests passed");
