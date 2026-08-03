/**
 * Collserola companion climb render regression tests.
 * Run: npx tsx shared/race/companionClimbs.test.ts
 */

import assert from "node:assert/strict";
import type { CompanionBundle, CompanionClimb } from "../types/sync";
import { buildRouteTrack, interpolateTrackAtKm } from "./mapMatching";
import { significantClimbs } from "./significantClimbs";

function climbSegmentsForRender(
  climbs: CompanionClimb[],
  coordinates: [number, number][],
  totalKm: number,
): Array<{ climbId: string; pointCount: number }> {
  const track = buildRouteTrack(coordinates, totalKm);
  return climbs.map((climb) => {
    const segmentCoords = track.points
      .filter((point) => point.km >= climb.startKm && point.km <= climb.endKm)
      .map((point) => [point.lon, point.lat] as [number, number]);
    if (segmentCoords.length < 2) {
      const start = interpolateTrackAtKm(track, climb.startKm);
      const end = interpolateTrackAtKm(track, climb.endKm);
      segmentCoords.push([start.lon, start.lat], [end.lon, end.lat]);
    }
    return { climbId: climb.id, pointCount: segmentCoords.length };
  });
}

function makeCollserolaBundle(): CompanionBundle {
  const coordinates: [number, number][] = Array.from({ length: 40 }, (_, index) => [
    2.1 + index * 0.01,
    41.4 + index * 0.002,
  ]);
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
      elevationGainM: 727,
      analyzedAt: "2026-07-15T10:00:00+00:00",
    },
    route: {
      coordinates,
      bounds: { south: 41.3, west: 2.0, north: 41.6, east: 2.5 },
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
    stops: [],
    unsupportedSections: [],
  };
}

function testCollserolaHasTwoSignificantClimbs() {
  const raw = [
    { id: "C001", length_km: 9.5, elevation_gain_m: 390, avg_gradient_pct: 4.1, max_1000_m_pct: 7.1 },
    { id: "C002", length_km: 9.47, elevation_gain_m: 280, avg_gradient_pct: 3.0, max_1000_m_pct: 7.0 },
    { id: "C003", length_km: 1.95, elevation_gain_m: 54, avg_gradient_pct: 2.8, max_1000_m_pct: 4.4 },
  ];
  const significant = significantClimbs(raw);
  assert.deepEqual(significant.map((climb) => climb.id), ["C001", "C002"]);
}

function testBundleExportsTwoClimbsForMap() {
  const bundle = makeCollserolaBundle();
  assert.equal(bundle.climbs?.length, 2);
  assert.deepEqual(bundle.climbs?.map((climb) => climb.id), ["C001", "C002"]);
}

function testBothClimbsRenderSegmentsOnRoute() {
  const bundle = makeCollserolaBundle();
  const climbs = bundle.climbs ?? [];
  const segments = climbSegmentsForRender(
    climbs,
    bundle.route.coordinates,
    bundle.race.distanceKm,
  );
  assert.equal(segments.length, 2);
  for (const segment of segments) {
    assert.ok(segment.pointCount >= 2, `${segment.climbId} must render a line`);
  }
  assert.ok(segments.some((segment) => segment.climbId === "C002"));
}

testCollserolaHasTwoSignificantClimbs();
testBundleExportsTwoClimbsForMap();
testBothClimbsRenderSegmentsOnRoute();

console.log("companionClimbs.test.ts: all tests passed");
