/**
 * Collserola companion POI render regression tests.
 * Run: npx tsx shared/race/bundlePois.test.ts
 */

import assert from "node:assert/strict";
import type { CompanionBundle } from "../types/sync";
import {
  collectAllBundlePois,
  findBundlePoiByOsmId,
  resolveRenderedStop,
} from "./bundlePois";

const OILPRIX_OSM_ID = 287007125;

function makeCollserolaFixture(): CompanionBundle {
  return {
    schemaVersion: 5,
    revision: 1,
    generatedAt: "2026-07-15T12:00:00+00:00",
    exportedAt: "2026-07-15T12:00:00+00:00",
    bundleChecksum: "test",
    race: {
      id: "b7a1c487-80c6-477c-87ae-ec9dd32b900c",
      name: "Conserolla",
      distanceKm: 39.01,
      elevationGainM: 900,
      analyzedAt: "2026-07-15T10:00:00+00:00",
    },
    route: {
      coordinates: [
        [2.1, 41.4],
        [2.2, 41.5],
      ],
      bounds: { south: 41.3, west: 2.0, north: 41.6, east: 2.3 },
      elevationsM: [100, 150],
    },
    climbs: [
      {
        id: "C001",
        name: "Carrer de Mallorca",
        startKm: 0.04,
        endKm: 9.54,
        lengthKm: 9.5,
        elevationGainM: 390,
        avgGradientPct: 4.1,
      },
      {
        id: "C002",
        name: "Carretera de Sant Cugat",
        startKm: 18.25,
        endKm: 27.73,
        lengthKm: 9.47,
        elevationGainM: 280,
        avgGradientPct: 3.0,
      },
    ],
    stops: [
      {
        poiId: "poi_287007125",
        zoneId: 4,
        osmId: OILPRIX_OSM_ID,
        osmType: "node",
        km: 6.96,
        lat: 41.430306,
        lon: 2.128889,
        name: "Oilprix",
        category: "Gas station",
        categoryLabel: "Water · Fuel",
        icon: "⛽",
        distanceOffRouteM: 20,
        verificationStatus: "verified",
        openingHours: "24/7",
        notes: null,
        phone: "+34 934180299",
        website: null,
        hasFood: false,
        hasWater: true,
        hasFuel: true,
        alternatives: [
          {
            poiId: "poi_5840105162",
            osmId: 5840105162,
            osmType: "node",
            name: "Font del Roure",
            category: "Drinking water",
            categoryLabel: "Water",
            icon: "💧",
            distanceOffRouteM: 92,
            distanceAlongKm: 6.65,
            score: 36.6,
            confidenceScore: 36.6,
            verificationStatus: "unverified",
            openingHours: null,
            lat: 41.428907,
            lon: 2.128991,
            hasFood: false,
            hasWater: true,
            hasFuel: false,
          },
        ],
      },
      {
        poiId: "poi_1337087623",
        zoneId: 15,
        osmId: 1337087623,
        osmType: "node",
        km: 34.71,
        lat: 41.420389,
        lon: 2.140782,
        name: "Super Fresco",
        category: "Mini supermarket",
        categoryLabel: "Food",
        icon: "🛒",
        distanceOffRouteM: 19,
        verificationStatus: "unverified",
        openingHours: null,
        notes: null,
        hasFood: true,
        hasWater: false,
        hasFuel: false,
      },
    ],
    unsupportedSections: [],
  };
}

function testOilprixMetadata() {
  const bundle = makeCollserolaFixture();
  const oilprix = findBundlePoiByOsmId(bundle, OILPRIX_OSM_ID);
  assert.ok(oilprix);
  assert.equal(oilprix!.role, "primary");
  assert.equal(oilprix!.stop.name, "Oilprix");
  assert.equal(oilprix!.stop.category, "Gas station");
  assert.ok(Math.abs(oilprix!.stop.km - 6.96) < 0.01);
  assert.equal(oilprix!.stop.hasFuel, true);
  assert.equal(oilprix!.poiId, "poi_287007125");
}

function testAlternativeIdentitySeparateFromPrimary() {
  const bundle = makeCollserolaFixture();
  const entries = collectAllBundlePois(bundle);
  const waterAlt = entries.find((entry) => entry.stop.osmId === 5840105162);
  assert.ok(waterAlt);
  assert.equal(waterAlt!.role, "alternative");
  assert.equal(waterAlt!.stop.name, "Font del Roure");
  assert.ok(Math.abs(waterAlt!.stop.km - 6.65) < 0.01);
  assert.equal(waterAlt!.stop.category, "Drinking water");
  assert.notEqual(waterAlt!.stop.name, "Oilprix");
}

function testSuperFrescoSeparateFromOilprix() {
  const bundle = makeCollserolaFixture();
  const fresco = findBundlePoiByOsmId(bundle, 1337087623);
  assert.equal(fresco!.stop.name, "Super Fresco");
  assert.ok(fresco!.stop.km > 30);
  const oilprix = findBundlePoiByOsmId(bundle, OILPRIX_OSM_ID);
  assert.notEqual(oilprix!.stop.name, "Super Fresco");
}

function testResolveRenderedStopByPoiId() {
  const bundle = makeCollserolaFixture();
  const resolved = resolveRenderedStop(bundle, {
    poiId: "poi_5840105162",
    zoneId: 4,
    osmId: 5840105162,
    osmType: "node",
    km: 6.65,
    lat: 41.428907,
    lon: 2.128991,
    name: "Font del Roure",
    category: "Drinking water",
    categoryLabel: "Water",
    icon: "💧",
    verificationStatus: "unverified",
  });
  assert.equal(resolved.name, "Font del Roure");
  assert.ok(Math.abs(resolved.km - 6.65) < 0.01);
  assert.equal(resolved.category, "Drinking water");
}

function testTwoClimbsPresent() {
  const bundle = makeCollserolaFixture();
  assert.deepEqual(bundle.climbs?.map((climb) => climb.id), ["C001", "C002"]);
}

testOilprixMetadata();
testAlternativeIdentitySeparateFromPrimary();
testSuperFrescoSeparateFromOilprix();
testResolveRenderedStopByPoiId();
testTwoClimbsPresent();

console.log("bundlePois.test.ts: all tests passed");
