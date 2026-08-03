/**
 * Discover Better Stops ranking/filter tests.
 * Run: npx tsx shared/race/discoverStops.test.ts
 */

import assert from "node:assert/strict";
import {
  boundsCacheKey,
  computeDiscoveryRadius,
  DISCOVERY_MAX_RESULTS,
  discoverStopsInBounds,
  discoverStopIcon,
  isDiscoverableCategory,
  type DiscoverPoiInput,
  type DiscoverTrackPoint,
  type MapBounds,
} from "./discoverStops";

const BOUNDS: MapBounds = { south: 41.38, west: 2.05, north: 41.42, east: 2.12 };

const TRACK: DiscoverTrackPoint[] = [
  { lat: 41.39, lon: 2.08, km: 0, eleM: 100 },
  { lat: 41.395, lon: 2.09, km: 5, eleM: 150 },
  { lat: 41.4, lon: 2.1, km: 10, eleM: 200 },
  { lat: 41.405, lon: 2.11, km: 15, eleM: 180 },
  { lat: 41.41, lon: 2.115, km: 20, eleM: 160 },
];

function poi(overrides: Partial<DiscoverPoiInput> & Pick<DiscoverPoiInput, "category">): DiscoverPoiInput {
  return {
    osmId: Math.floor(Math.random() * 1_000_000),
    osmType: "node",
    name: overrides.category,
    priority: 1,
    lat: 41.395,
    lon: 2.09,
    distanceAlongKm: 8,
    distanceOffRouteM: 40,
    score: 60,
    zoneId: null,
    ...overrides,
  };
}

function testCategoryRankingPrefersGasOverDining() {
  const gas = poi({ category: "Gas station", osmId: 1, score: 55, distanceOffRouteM: 80 });
  const cafe = poi({ category: "Café", osmId: 2, score: 70, distanceOffRouteM: 20 });
  const result = discoverStopsInBounds({
    pois: [cafe, gas],
    bounds: BOUNDS,
    trackPoints: TRACK,
    existingStopKms: [25],
  });
  assert.equal(result.candidates[0]?.category, "Gas station");
}

function testIgnoresIrrelevantCategories() {
  const bikeShop = poi({ category: "Bike shop", osmId: 3 });
  const water = poi({ category: "Drinking water", osmId: 4 });
  const result = discoverStopsInBounds({
    pois: [bikeShop, water],
    bounds: BOUNDS,
    trackPoints: TRACK,
    existingStopKms: [25],
  });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.category, "Drinking water");
}

function testIgnoresMountainHutUnlessRestaurant() {
  const hut = poi({
    category: "Restaurant",
    osmId: 5,
    tags: { tourism: "alpine_hut" },
  });
  const publicCafe = poi({
    category: "Café",
    osmId: 6,
    tags: { amenity: "cafe" },
  });
  const result = discoverStopsInBounds({
    pois: [hut, publicCafe],
    bounds: BOUNDS,
    trackPoints: TRACK,
    existingStopKms: [25],
  });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.category, "Café");
}

function testExpandsRadiusOnLongGap() {
  const sparse = computeDiscoveryRadius({
    visibleStartKm: 0,
    visibleEndKm: 30,
    existingStopKms: [0, 30],
  });
  const dense = computeDiscoveryRadius({
    visibleStartKm: 0,
    visibleEndKm: 10,
    existingStopKms: [2, 4, 6, 8],
  });
  assert.ok(sparse > dense);
}

function testFiltersOutsideBounds() {
  const inside = poi({ category: "Gas station", osmId: 7, lat: 41.395, lon: 2.09 });
  const outside = poi({ category: "Gas station", osmId: 8, lat: 41.5, lon: 2.5 });
  const result = discoverStopsInBounds({
    pois: [inside, outside],
    bounds: BOUNDS,
    trackPoints: TRACK,
    existingStopKms: [25],
  });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.osmId, 7);
}

function testDismissedAndPrimaryAreExcluded() {
  const primary = poi({ category: "Gas station", osmId: 9, osmType: "node" });
  const alt = poi({ category: "Small supermarket", osmId: 10, osmType: "node" });
  const dismissed = poi({ category: "Drinking water", osmId: 11, osmType: "node" });
  const result = discoverStopsInBounds({
    pois: [primary, alt, dismissed],
    bounds: BOUNDS,
    trackPoints: TRACK,
    existingStopKms: [25],
    primaryPoiKeys: new Set(["node-9"]),
    dismissedPoiKeys: new Set(["node-11"]),
  });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.osmId, 10);
}

function testIconsAndNextStopMetrics() {
  assert.equal(discoverStopIcon("Gas station"), "⛽");
  assert.equal(discoverStopIcon("Drinking water"), "💧");
  assert.equal(discoverStopIcon("Café"), "☕");
  assert.equal(isDiscoverableCategory("Gas station"), true);

  const stop = poi({ category: "Gas station", osmId: 12, distanceAlongKm: 8 });
  const result = discoverStopsInBounds({
    pois: [stop],
    bounds: BOUNDS,
    trackPoints: TRACK,
    existingStopKms: [15, 25],
  });
  assert.equal(result.candidates[0]?.distanceToNextStopKm, 7);
  assert.equal(result.candidates[0]?.elevationToNextStopM, -20);
}

function testBoundsCacheKeyStable() {
  assert.equal(
    boundsCacheKey({ south: 41.1, west: 2.2, north: 41.2, east: 2.3 }),
    "41.100,2.200,41.200,2.300",
  );
}

function testRespectsMaxResults() {
  const many = DISCOVERY_CATEGORY_ORDER_CATEGORIES.map((category, index) =>
    poi({ category, osmId: 100 + index, score: 50 + index }),
  );
  const result = discoverStopsInBounds({
    pois: many,
    bounds: BOUNDS,
    trackPoints: TRACK,
    existingStopKms: [25],
  });
  assert.equal(result.candidates.length, DISCOVERY_MAX_RESULTS);
}

function testVerifiedKeysExcluded() {
  const verified = poi({ category: "Gas station", osmId: 20, osmType: "node" });
  const fresh = poi({ category: "Small supermarket", osmId: 21, osmType: "node" });
  const result = discoverStopsInBounds({
    pois: [verified, fresh],
    bounds: BOUNDS,
    trackPoints: TRACK,
    existingStopKms: [25],
    verifiedPoiKeys: new Set(["node-20"]),
  });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.osmId, 21);
}

const DISCOVERY_CATEGORY_ORDER_CATEGORIES = [
  "Gas station",
  "Small supermarket",
  "Mini supermarket",
  "Drinking water",
  "Convenience store",
  "Supermarket",
  "Café",
  "Restaurant",
  "Gas station",
  "Gas station",
  "Gas station",
  "Gas station",
] as const;

function testClimbProximityBoost() {
  const gasNearClimb = poi({
    category: "Gas station",
    osmId: 30,
    distanceAlongKm: 9,
    score: 50,
  });
  const cafeFar = poi({
    category: "Café",
    osmId: 31,
    distanceAlongKm: 9,
    score: 80,
  });
  const result = discoverStopsInBounds({
    pois: [cafeFar, gasNearClimb],
    bounds: BOUNDS,
    trackPoints: TRACK,
    existingStopKms: [25],
    climbRanges: [{ startKm: 8, endKm: 10 }],
  });
  assert.equal(result.candidates[0]?.category, "Gas station");
}

testCategoryRankingPrefersGasOverDining();
testIgnoresIrrelevantCategories();
testIgnoresMountainHutUnlessRestaurant();
testExpandsRadiusOnLongGap();
testFiltersOutsideBounds();
testDismissedAndPrimaryAreExcluded();
testIconsAndNextStopMetrics();
testBoundsCacheKeyStable();
testRespectsMaxResults();
testVerifiedKeysExcluded();
testClimbProximityBoost();

console.log("discoverStops.test.ts: all tests passed");
