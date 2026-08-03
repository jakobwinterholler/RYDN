/**
 * Coros GPX export v3.0 unit tests — parity with tests/test_race_gpx_export.py
 * Run: npx tsx shared/race/gpsGpxExport.test.ts
 */

import assert from "node:assert/strict";
import {
  formatCorosWaypointName,
  isExcludedExportCategory,
  isInvalidExportName,
  resolveCorosWptIcon,
  ROUTE_INTEGRITY_FAILED_MESSAGE,
} from "./gpsGpxExportConstants";
import {
  buildCorosWaypointLabel,
  removeCityNames,
  removeDuplicateWords,
  removeRoadNames,
  sanitizePoiName,
} from "./corosWaypointNaming";
import { assignWaypointPriority, shouldExportPriority } from "./corosWaypointPriority";
import {
  GpxTrackModifiedError,
  buildGpxExportPreview,
  exportGpxForGps,
} from "./gpsGpxExport";
import type { CompanionBundle } from "../types/sync";

function testNamingEngine() {
  assert.equal(removeCityNames("Repsol, Barcelona"), "Repsol");
  assert.equal(removeRoadNames("Carretera de la Marina"), "");
  assert.equal(removeDuplicateWords("Water Water Station"), "Water Station");
  assert.equal(sanitizePoiName("Carretera de Prades, Tarragona"), "");

  assert.equal(
    buildCorosWaypointLabel({
      name: "Repsol",
      brand: "Repsol",
      category: "Gas station",
      hasFuel: true,
    }),
    "Repsol",
  );
  assert.equal(
    buildCorosWaypointLabel({
      name: "Unnamed",
      category: "Gas station",
      hasFuel: true,
      resupplyReason: "Last practical fuel before climb at km 42",
    }),
    "Last Fuel",
  );
  assert.equal(
    buildCorosWaypointLabel({
      name: "Font de Can Borni",
      category: "Drinking water",
      hasWater: true,
      resupplyReason: "Refill at km 18 — last useful fountain before summit on climb-3",
    }),
    "Summit Water",
  );
  assert.equal(
    buildCorosWaypointLabel({
      name: "Mini Market",
      category: "Convenience store",
      hasFood: true,
    }),
    "Small Shop",
  );
  assert.equal(
    buildCorosWaypointLabel({
      name: "Shop",
      category: "Supermarket",
      hasFood: true,
      hasWater: true,
    }),
    "Food + Water",
  );

  assert.equal(isInvalidExportName("Checkpoint 8"), true);
  assert.equal(isInvalidExportName("Carretera de la Marina"), true);
  assert.equal(
    formatCorosWaypointName({ name: "Oilprix", brand: "Oilprix", category: "Gas station", hasFuel: true }),
    "⛽ Oilprix",
  );
  assert.equal(
    formatCorosWaypointName({
      name: "Station",
      category: "Gas station",
      hasFuel: true,
      resupplyReason: "Last practical fuel before climb",
    }),
    "⛽ Last Fuel",
  );
}

function testCorosIcons() {
  assert.equal(resolveCorosWptIcon({ category: "Drinking water", hasWater: true }), "Water");
  assert.equal(resolveCorosWptIcon({ category: "Gas station", hasFuel: true }), "Supplies/Fuel");
  assert.equal(resolveCorosWptIcon({ category: "Water fountain", hasWater: true }), "Water");
  assert.equal(resolveCorosWptIcon({ category: "Supermarket", hasFood: true }), "Supplies");
  assert.equal(resolveCorosWptIcon({ category: "Convenience store", hasFood: true }), "Supplies");
  assert.equal(resolveCorosWptIcon({ category: "Café" }), "Supplies");
  assert.equal(resolveCorosWptIcon({ category: "Crossroad" }), "Trailfork");
  assert.equal(resolveCorosWptIcon({ category: "Generic POI" }), "Pin");
}

function testWaypointPriority() {
  assert.equal(
    assignWaypointPriority({
      verificationStatus: "verified",
      resupplyReason: "Last practical fuel before climb at km 42",
      hasFuel: true,
    }),
    "critical",
  );
  assert.equal(
    assignWaypointPriority({
      verificationStatus: "verified",
      resupplyReason: "No water for the next 35 km after this point",
      hasWater: true,
    }),
    "critical",
  );
  assert.equal(
    assignWaypointPriority({
      verificationStatus: "verified",
      confidenceScore: 62,
      hasFood: true,
    }),
    "recommended",
  );
  assert.equal(
    assignWaypointPriority({
      verificationStatus: "unverified",
      confidenceScore: 80,
    }),
    "optional",
  );
  assert.equal(shouldExportPriority("critical", false), true);
  assert.equal(shouldExportPriority("recommended", false), true);
  assert.equal(shouldExportPriority("optional", false), false);
  assert.equal(shouldExportPriority("optional", true), true);
}

function testIntegrityMessage() {
  const error = new GpxTrackModifiedError();
  assert.equal(error.message, ROUTE_INTEGRITY_FAILED_MESSAGE);
}

const MINIMAL_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1">
  <trk><name>Test</name><trkseg>
    <trkpt lat="41.0" lon="2.0"><ele>100</ele></trkpt>
    <trkpt lat="41.01" lon="2.01"><ele>150</ele></trkpt>
  </trkseg></trk>
</gpx>`;

function testFilteringAndPreview() {
  assert.equal(isExcludedExportCategory("Significant climb"), true);
  assert.equal(isExcludedExportCategory("Debug marker"), true);
  assert.equal(isExcludedExportCategory("Gas station"), false);

  const bundle: CompanionBundle = {
    schemaVersion: 1,
    exportedAt: "2026-01-01T00:00:00Z",
    race: { id: "race-1", name: "Test", distanceKm: 10, elevationGainM: 50 },
    route: {
      coordinates: [[2, 41], [2.01, 41.01]],
      bounds: { south: 41, west: 2, north: 41.01, east: 2.01 },
    },
    stops: [
      {
        zoneId: 1,
        km: 5,
        lat: 41.005,
        lon: 2.005,
        name: "Repsol",
        category: "Gas station",
        categoryLabel: "Fuel",
        icon: "fuel",
        verificationStatus: "verified",
        openingHours: null,
        notes: null,
        hasFuel: true,
        confidenceScore: 70,
        resupplyReason: "Last practical fuel before climb at km 8",
      },
      {
        zoneId: 2,
        km: 8,
        lat: 41.008,
        lon: 2.008,
        name: "Carretera Shop",
        category: "Convenience store",
        categoryLabel: "Food",
        icon: "shop",
        verificationStatus: "verified",
        openingHours: null,
        notes: null,
        confidenceScore: 30,
      },
      {
        zoneId: 3,
        km: 9,
        lat: 41.009,
        lon: 2.009,
        name: "Climb summit",
        category: "Significant climb",
        categoryLabel: "Climb",
        icon: "climb",
        verificationStatus: "verified",
        openingHours: null,
        notes: null,
      },
    ],
    unsupportedSections: [],
  };

  const gpxBytes = new TextEncoder().encode(MINIMAL_GPX);
  const preview = buildGpxExportPreview(gpxBytes, bundle, { deviceProfile: "coros" });
  assert.equal(preview.routeIntegrityPassed, true);
  assert.equal(preview.exportedCount, 1);
  assert.equal(preview.criticalCount, 1);
  assert.equal(preview.recommendedCount, 0);
  assert.equal(preview.optionalCount, 1);
  assert.match(preview.waypoints[0]?.name ?? "", /Last Fuel/);

  const withOptional = buildGpxExportPreview(gpxBytes, bundle, {
    deviceProfile: "coros",
    includeOptional: true,
  });
  assert.equal(withOptional.exportedCount, 2);

  const { bytes, report } = exportGpxForGps(gpxBytes, bundle, { deviceProfile: "coros" });
  assert.ok(bytes.length > gpxBytes.length);
  assert.equal(report.routeIntegrityPassed, true);
  assert.equal(report.exportedPoiCount, 1);
}

testNamingEngine();
testCorosIcons();
testWaypointPriority();
testIntegrityMessage();
testFilteringAndPreview();
console.log("gpsGpxExport.test.ts: all tests passed");
