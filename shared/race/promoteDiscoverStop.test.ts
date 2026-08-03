/**
 * Run: npx tsx shared/race/promoteDiscoverStop.test.ts
 */

import assert from "node:assert/strict";
import {
  buildPromotedSuggestedStop,
  insertPromotedDiscoverStop,
  upsertPromotedSuggestedStop,
} from "./promoteDiscoverStop";
import type { CompanionBundle } from "../types/sync";

function testUpsertSuggestedStopReplacesZone() {
  const existing = [
    buildPromotedSuggestedStop({
      osmId: 1,
      osmType: "node",
      name: "Old",
      category: "Gas station",
      lat: 1,
      lon: 2,
      distanceAlongKm: 10,
      distanceOffRouteM: 20,
      score: 50,
      zoneId: 4,
    }),
  ];
  const promoted = buildPromotedSuggestedStop({
    osmId: 2,
    osmType: "node",
    name: "New",
    category: "Gas station",
    lat: 1.1,
    lon: 2.1,
    distanceAlongKm: 10.2,
    distanceOffRouteM: 15,
    score: 70,
    zoneId: 4,
  });
  const next = upsertPromotedSuggestedStop(existing, promoted);
  assert.equal(next.length, 1);
  assert.equal(next[0]?.osm_id, 2);
}

function testInsertPromotedDiscoverStopAddsPrimary() {
  const bundle: CompanionBundle = {
    schemaVersion: 5,
    revision: 1,
    generatedAt: "2026-07-16T12:00:00+00:00",
    exportedAt: "2026-07-16T12:00:00+00:00",
    bundleChecksum: "test",
    race: { id: "race-1", name: "Test", distanceKm: 40, elevationGainM: 900, analyzedAt: null },
    route: { coordinates: [[2.1, 41.4]], bounds: { south: 41.3, west: 2.0, north: 41.6, east: 2.3 } },
    stops: [
      {
        poiId: "poi_1",
        zoneId: 3,
        osmId: 1,
        osmType: "node",
        km: 5,
        lat: 41.4,
        lon: 2.1,
        name: "Existing",
        category: "Gas station",
        categoryLabel: "Fuel",
        icon: "⛽",
        verificationStatus: "unverified",
        openingHours: null,
        notes: null,
        hasFuel: true,
        hasWater: false,
        hasFood: false,
        hasCoffee: false,
      },
    ],
    unsupportedSections: [],
  };

  const stops = insertPromotedDiscoverStop(bundle, {
    osmId: 99,
    osmType: "node",
    name: "Found",
    category: "Gas station",
    priority: 2,
    lat: 41.41,
    lon: 2.11,
    distanceAlongKm: 7,
    distanceOffRouteM: 30,
    score: 80,
    zoneId: 8,
    openingHours: null,
    brand: null,
    tags: null,
  });

  assert.equal(stops.length, 2);
  assert.equal(stops[1]?.osmId, 99);
  assert.equal(stops[1]?.name, "Found");
}

testUpsertSuggestedStopReplacesZone();
testInsertPromotedDiscoverStopAddsPrimary();

console.log("promoteDiscoverStop.test.ts: all tests passed");
