/**
 * Integration smoke test for Discover Better Stops on real race analysis.
 * Run: npx tsx shared/race/discoverStops.integration.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  discoverStopsInBounds,
  type DiscoverPoiInput,
  type DiscoverTrackPoint,
  type MapBounds,
} from "./discoverStops";

const REPO_ROOT = join(import.meta.dirname, "../..");

interface AnalysisFixture {
  label: string;
  raceId: string;
  bounds: MapBounds;
}

const FIXTURES: AnalysisFixture[] = [
  {
    label: "Collserola urban",
    raceId: "b7a1c487-80c6-477c-87ae-ec9dd32b900c",
    bounds: { south: 41.39, west: 2.11, north: 41.44, east: 2.15 },
  },
  {
    label: "Mountain section (long route)",
    raceId: "286eb477-b2f1-4a95-b6e4-2f6f890a0360",
    bounds: { south: 41.387, west: 2.091, north: 41.42, east: 2.142 },
  },
];

function loadAnalysis(raceId: string): {
  pois: DiscoverPoiInput[];
  trackPoints: DiscoverTrackPoint[];
  stopKms: number[];
} | null {
  const path = join(REPO_ROOT, "data/races", raceId, "analysis/latest.json");
  if (!existsSync(path)) {
    return null;
  }
  const raw = JSON.parse(readFileSync(path, "utf8")) as {
    pois: Array<{
      osm_id: number;
      osm_type: string;
      name: string | null;
      category: string;
      priority: number;
      lat: number;
      lon: number;
      distance_along_km: number;
      distance_off_route_m: number;
      score: number;
      zone_id: number | null;
      opening_hours: string | null;
      brand: string | null;
      tags: Record<string, string>;
    }>;
    route: {
      track_points: Array<{ lat: number; lon: number; km: number; ele_m: number | null }>;
    };
    resupply_zones: Array<{ distance_along_km: number; categories: Array<{ primary: { osm_id: number; osm_type: string } | null }> }>;
  };

  const primaryKeys = new Set<string>();
  for (const zone of raw.resupply_zones) {
    for (const group of zone.categories) {
      if (group.primary) {
        primaryKeys.add(`${group.primary.osm_type}-${group.primary.osm_id}`);
      }
    }
  }

  return {
    pois: raw.pois.map((poi) => ({
      osmId: poi.osm_id,
      osmType: poi.osm_type,
      name: poi.name,
      category: poi.category,
      priority: poi.priority,
      lat: poi.lat,
      lon: poi.lon,
      distanceAlongKm: poi.distance_along_km,
      distanceOffRouteM: poi.distance_off_route_m,
      score: poi.score,
      zoneId: poi.zone_id,
      openingHours: poi.opening_hours,
      brand: poi.brand,
      tags: poi.tags,
    })),
    trackPoints: raw.route.track_points.map((point) => ({
      lat: point.lat,
      lon: point.lon,
      km: point.km,
      eleM: point.ele_m,
    })),
    stopKms: raw.resupply_zones.map((zone) => zone.distance_along_km),
    primaryKeys,
  } as ReturnType<typeof loadAnalysis> & { primaryKeys: Set<string> };
}

for (const fixture of FIXTURES) {
  const data = loadAnalysis(fixture.raceId);
  if (!data) {
    console.log(`[skip] ${fixture.label}: analysis not found`);
    continue;
  }

  const primaryKeys = (data as { primaryKeys?: Set<string> }).primaryKeys ?? new Set();
  const result = discoverStopsInBounds({
    pois: data.pois,
    bounds: fixture.bounds,
    trackPoints: data.trackPoints,
    existingStopKms: data.stopKms,
    primaryPoiKeys: primaryKeys,
    limit: 10,
  });

  assert.ok(result.candidates.length >= 1, `${fixture.label} should find candidates`);
  assert.ok(result.candidates.length <= 10, `${fixture.label} should respect limit`);
  assert.ok(
    result.candidates.every((candidate) => candidate.icon.length > 0),
    `${fixture.label} candidates need icons`,
  );

  console.log(
    `[ok] ${fixture.label}: ${result.candidates.length} candidates (radius ${result.maxOffRouteM} m) —`,
    result.candidates.map((item) => `${item.icon} ${item.category}`).join(", "),
  );
}

console.log("discoverStops.integration.test.ts: all available fixtures passed");
