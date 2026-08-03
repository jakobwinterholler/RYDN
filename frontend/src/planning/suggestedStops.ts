import type { ResupplyZone, RoadbookResult, SuggestedStop } from "../api";
import { buildStopRecommendations } from "./stopRecommendations";
import { selectPlanningStops } from "./planningHubSelection";
import { applyTimeModeFilter } from "./zonePresentation";
import type { TimeMode } from "./types";

const DEDUP_DISTANCE_KM = 0.3;
const SUPERMARKET_SPACING_KM = 5;
const GAS_SPACING_KM = 8;

function poiKind(category: string, categoryKey: string): string {
  const lowered = category.toLowerCase();
  if (categoryKey === "fuel" || lowered.includes("gas") || lowered.includes("fuel")) {
    return "fuel";
  }
  if (lowered.includes("small supermarket") || lowered.includes("mini supermarket")) {
    return "small_supermarket";
  }
  if (lowered.includes("convenience")) {
    return "convenience";
  }
  if (lowered.includes("supermarket")) {
    return "large_supermarket";
  }
  if (lowered.includes("drinking water") || categoryKey === "water") {
    return "water";
  }
  return "other";
}

function isSupermarketKind(kind: string): boolean {
  return kind === "small_supermarket" || kind === "large_supermarket";
}

function bestPoiInZone(zone: ResupplyZone): SuggestedStop | null {
  const summary = buildStopRecommendations(zone);
  const best = summary.best;
  if (!best) {
    return null;
  }

  return {
    zone_id: zone.zone_id,
    osm_id: best.poi.osm_id,
    osm_type: best.poi.osm_type,
    name: best.poi.name,
    poi_category: best.poi.poi_category,
    category_key: best.categoryKey,
    category_label: best.categoryLabel,
    distance_along_km: best.poi.distance_along_km,
    distance_off_route_m: best.poi.distance_off_route_m,
    lat: best.poi.lat,
    lon: best.poi.lon,
    score: best.poi.score,
    reason: null,
  };
}

function violatesDedup(candidate: SuggestedStop, selected: SuggestedStop[]): boolean {
  for (const existing of selected) {
    const kmGap = Math.abs(candidate.distance_along_km - existing.distance_along_km);
    if (kmGap < DEDUP_DISTANCE_KM) {
      return true;
    }

    const candKind = poiKind(candidate.poi_category, candidate.category_key);
    const existKind = poiKind(existing.poi_category, existing.category_key);

    if (candKind === "fuel" && existKind === "fuel" && kmGap < GAS_SPACING_KM) {
      return true;
    }

    if (isSupermarketKind(candKind) && isSupermarketKind(existKind) && kmGap < SUPERMARKET_SPACING_KM) {
      return true;
    }
  }
  return false;
}

/** Client-side fallback when roadbook lacks backend suggested_stops (migration). */
export function computeSuggestedStops(
  zones: ResupplyZone[],
  route: RoadbookResult["route"],
  totalKm: number,
): SuggestedStop[] {
  const planningZones = selectPlanningStops(zones, route, totalKm);
  const candidates = planningZones
    .map(bestPoiInZone)
    .filter((stop): stop is SuggestedStop => stop !== null)
    .sort((left, right) => right.score - left.score);

  const selected: SuggestedStop[] = [];
  for (const candidate of candidates) {
    if (!violatesDedup(candidate, selected)) {
      selected.push(candidate);
    }
  }

  return selected.sort((left, right) => left.distance_along_km - right.distance_along_km);
}

export function resolveSuggestedStops(result: RoadbookResult): SuggestedStop[] {
  if (result.suggested_stops && result.suggested_stops.length > 0) {
    return result.suggested_stops;
  }
  return computeSuggestedStops(result.resupply_zones, result.route, result.summary.distance_km);
}

export function suggestedStopZoneIds(stops: SuggestedStop[]): Set<number> {
  return new Set(stops.map((stop) => stop.zone_id));
}

/** Filter zones to the intelligent suggested stop list. */
export function presentSuggestedStops(
  result: RoadbookResult,
  timeMode: TimeMode,
): ResupplyZone[] {
  const stops = resolveSuggestedStops(result);
  const zoneIds = suggestedStopZoneIds(stops);
  const filtered = result.resupply_zones.filter((zone) => zoneIds.has(zone.zone_id));
  return applyTimeModeFilter(filtered, timeMode);
}

export function suggestedStopCount(result: RoadbookResult): number {
  return resolveSuggestedStops(result).length;
}

export function stopDisplayName(stop: SuggestedStop): string {
  return stop.name?.trim() || stop.poi_category || `Stop at km ${Math.round(stop.distance_along_km)}`;
}
