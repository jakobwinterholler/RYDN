import { collectAllBundlePois } from "@shared/race/bundlePois";
import { haversineM } from "@shared/race/mapMatching";
import type { CompanionBundle, CompanionDiscoverPoi, CompanionStop } from "@shared/types/sync";
import {
  DiscoverStopsCache,
  poiOsmKey,
  type DiscoverPoiInput,
  type DiscoverTrackPoint,
  type MapBounds,
} from "@shared/race/discoverStops";
import { buildRouteTrack } from "@shared/race/mapMatching";
import type maplibregl from "maplibre-gl";

export function mapBoundsFromMaplibre(bounds: maplibregl.LngLatBounds): MapBounds {
  return {
    south: bounds.getSouth(),
    west: bounds.getWest(),
    north: bounds.getNorth(),
    east: bounds.getEast(),
  };
}

function discoverPoiToInput(poi: CompanionDiscoverPoi): DiscoverPoiInput {
  return {
    osmId: poi.osmId,
    osmType: poi.osmType,
    name: poi.name,
    category: poi.category,
    priority: poi.priority,
    lat: poi.lat,
    lon: poi.lon,
    distanceAlongKm: poi.distanceAlongKm,
    distanceOffRouteM: poi.distanceOffRouteM,
    score: poi.score,
    zoneId: poi.zoneId,
    openingHours: poi.openingHours,
    brand: poi.brand ?? null,
    tags: poi.tags ?? null,
  };
}

function stopToDiscoverInput(stop: CompanionStop): DiscoverPoiInput | null {
  if (stop.osmId == null || !stop.osmType) {
    return null;
  }
  return {
    osmId: stop.osmId,
    osmType: stop.osmType,
    name: stop.name,
    category: stop.category,
    priority: 2,
    lat: stop.lat,
    lon: stop.lon,
    distanceAlongKm: stop.km,
    distanceOffRouteM: stop.distanceOffRouteM ?? 0,
    score: stop.confidenceScore ?? 0,
    zoneId: stop.zoneId,
    openingHours: stop.openingHours,
    brand: null,
    tags: null,
  };
}

/** POIs available for bounds-based discovery — full export or embedded stop alternatives. */
export function discoverPoisFromBundle(bundle: CompanionBundle): DiscoverPoiInput[] {
  const seen = new Set<string>();
  const inputs: DiscoverPoiInput[] = [];

  for (const poi of bundle.discoverPois ?? []) {
    const key = poiOsmKey(poi.osmType, poi.osmId);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    inputs.push(discoverPoiToInput(poi));
  }

  for (const entry of collectAllBundlePois(bundle)) {
    const input = stopToDiscoverInput(entry.stop);
    if (!input) {
      continue;
    }
    const key = poiOsmKey(input.osmType, input.osmId);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    inputs.push(input);
  }

  return inputs;
}

export function trackPointsFromBundle(bundle: CompanionBundle): DiscoverTrackPoint[] {
  const track = buildRouteTrack(bundle.route.coordinates, bundle.race.distanceKm);
  const elevations = bundle.route.elevationsM;
  return track.points.map((point, index) => ({
    lat: point.lat,
    lon: point.lon,
    km: point.km,
    eleM: elevations?.[index] ?? null,
  }));
}

export function primaryPoiKeysFromBundle(bundle: CompanionBundle): Set<string> {
  const keys = new Set<string>();
  for (const entry of collectAllBundlePois(bundle)) {
    if (entry.role === "primary" && entry.stop.osmType && entry.stop.osmId != null) {
      keys.add(poiOsmKey(entry.stop.osmType, entry.stop.osmId));
    }
  }
  return keys;
}

export function discoverDetourCoordinates(
  trackPoints: DiscoverTrackPoint[],
  candidate: { lat: number; lon: number },
): [number, number][] | null {
  if (trackPoints.length === 0) {
    return null;
  }
  let bestIndex = 0;
  let bestDistance = haversineM(
    trackPoints[0].lat,
    trackPoints[0].lon,
    candidate.lat,
    candidate.lon,
  );
  for (let index = 1; index < trackPoints.length; index += 1) {
    const distance = haversineM(
      trackPoints[index].lat,
      trackPoints[index].lon,
      candidate.lat,
      candidate.lon,
    );
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  const trackPoint = trackPoints[bestIndex];
  if (trackPoint.lat === candidate.lat && trackPoint.lon === candidate.lon) {
    return null;
  }
  return [
    [trackPoint.lon, trackPoint.lat],
    [candidate.lon, candidate.lat],
  ];
}

export const discoverStopsCache = new DiscoverStopsCache();
