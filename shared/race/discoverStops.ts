/** Bounds-based resupply discovery for ultra route planning. */

import { planningScore, poiTier } from "./poiScoring";

export interface MapBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface DiscoverPoiInput {
  osmId: number;
  osmType: string;
  name: string | null;
  category: string;
  priority: number;
  lat: number;
  lon: number;
  distanceAlongKm: number;
  distanceOffRouteM: number;
  score: number;
  zoneId: number | null;
  openingHours?: string | null;
  brand?: string | null;
  tags?: Record<string, string> | null;
}

export interface DiscoverTrackPoint {
  lat: number;
  lon: number;
  km: number;
  eleM: number | null;
}

export interface DiscoverCandidate extends DiscoverPoiInput {
  rankScore: number;
  icon: string;
  services: string[];
  confidenceLabel: string;
  distanceToNextStopKm: number | null;
  elevationToNextStopM: number | null;
}

export interface DiscoverClimbRange {
  startKm: number;
  endKm: number;
}

export interface DiscoverStopsInput {
  pois: DiscoverPoiInput[];
  bounds: MapBounds;
  trackPoints: DiscoverTrackPoint[];
  /** km along route for existing suggested/verified stops */
  existingStopKms: number[];
  /** osm keys `${type}-${id}` already shown as primary hub markers */
  primaryPoiKeys?: Set<string>;
  dismissedPoiKeys?: Set<string>;
  /** Verified discovery keys — excluded from future searches */
  verifiedPoiKeys?: Set<string>;
  /** Significant climbs — boost gas/water/café near climbs */
  climbRanges?: DiscoverClimbRange[];
  limit?: number;
}

export interface DiscoverStopsResult {
  candidates: DiscoverCandidate[];
  visibleStartKm: number;
  visibleEndKm: number;
  maxOffRouteM: number;
  cacheKey: string;
}

export const DISCOVERY_MAX_RESULTS = 10;

const DISCOVERY_CATEGORY_ORDER: readonly string[] = [
  "Gas station",
  "Small supermarket",
  "Mini supermarket",
  "Drinking water",
  "Convenience store",
  "Supermarket",
  "Café",
  "Restaurant",
];

const DISCOVERY_ICONS: Record<string, string> = {
  "Gas station": "⛽",
  "Small supermarket": "🛒",
  "Mini supermarket": "🛒",
  Supermarket: "🛒",
  "Drinking water": "💧",
  "Convenience store": "🛒",
  Café: "☕",
  Restaurant: "☕",
};

const BASE_MAX_OFF_ROUTE_M = 500;
const BASE_FUEL_MAX_OFF_ROUTE_M = 1200;
const EXPANDED_MAX_OFF_ROUTE_M = 800;
const EXPANDED_FUEL_MAX_OFF_ROUTE_M = 1500;
const REDUCED_MAX_OFF_ROUTE_M = 320;
const REDUCED_FUEL_MAX_OFF_ROUTE_M = 900;
const LONG_GAP_KM = 22;
const MANY_STOPS_THRESHOLD = 3;

export function boundsCacheKey(bounds: MapBounds, precision = 3): string {
  return [bounds.south, bounds.west, bounds.north, bounds.east]
    .map((value) => value.toFixed(precision))
    .join(",");
}

export function poiOsmKey(osmType: string, osmId: number): string {
  return `${osmType}-${osmId}`;
}

export function discoverStopIcon(category: string): string {
  return DISCOVERY_ICONS[category] ?? "📍";
}

export function isDiscoverableCategory(category: string, tags?: Record<string, string> | null): boolean {
  if (!DISCOVERY_CATEGORY_ORDER.includes(category)) {
    return false;
  }
  if (isExcludedMountainHut(tags)) {
    return false;
  }
  if (category === "Restaurant" || category === "Café") {
    return isPublicDining(tags);
  }
  return true;
}

function isExcludedMountainHut(tags?: Record<string, string> | null): boolean {
  if (!tags) {
    return false;
  }
  const tourism = tags.tourism?.toLowerCase();
  if (tourism !== "alpine_hut" && tourism !== "wilderness_hut" && tourism !== "hostel") {
    return false;
  }
  const amenity = tags.amenity?.toLowerCase();
  return amenity !== "restaurant" && amenity !== "cafe" && amenity !== "fast_food";
}

function isPublicDining(tags?: Record<string, string> | null): boolean {
  if (!tags) {
    return true;
  }
  const access = tags.access?.toLowerCase();
  if (access === "private" || access === "no") {
    return false;
  }
  return !isExcludedMountainHut(tags);
}

function isInBounds(lat: number, lon: number, bounds: MapBounds): boolean {
  return lat >= bounds.south && lat <= bounds.north && lon >= bounds.west && lon <= bounds.east;
}

function categoryRank(category: string): number {
  const index = DISCOVERY_CATEGORY_ORDER.indexOf(category);
  return index >= 0 ? DISCOVERY_CATEGORY_ORDER.length - index : 0;
}

function servicesForCategory(category: string): string[] {
  switch (category) {
    case "Gas station":
      return ["Fuel"];
    case "Drinking water":
      return ["Water"];
    case "Café":
    case "Restaurant":
      return ["Food", "Rest"];
    case "Small supermarket":
    case "Mini supermarket":
    case "Supermarket":
    case "Convenience store":
      return ["Food"];
    default:
      return ["Resupply"];
  }
}

function maxOffRouteForPoi(
  category: string,
  contextMaxM: number,
  fuelContextMaxM: number,
): number {
  if (category === "Gas station") {
    return fuelContextMaxM;
  }
  return contextMaxM;
}

function fuelRadiusForContext(contextMaxM: number): number {
  if (contextMaxM >= EXPANDED_MAX_OFF_ROUTE_M) {
    return EXPANDED_FUEL_MAX_OFF_ROUTE_M;
  }
  if (contextMaxM <= REDUCED_MAX_OFF_ROUTE_M) {
    return REDUCED_FUEL_MAX_OFF_ROUTE_M;
  }
  return BASE_FUEL_MAX_OFF_ROUTE_M;
}

export function visibleKmRange(
  trackPoints: DiscoverTrackPoint[],
  bounds: MapBounds,
): { startKm: number; endKm: number } {
  const inView = trackPoints.filter((point) => isInBounds(point.lat, point.lon, bounds));
  if (inView.length === 0) {
    return { startKm: 0, endKm: 0 };
  }
  return {
    startKm: inView[0].km,
    endKm: inView[inView.length - 1].km,
  };
}

export function computeDiscoveryRadius(input: {
  visibleStartKm: number;
  visibleEndKm: number;
  existingStopKms: number[];
}): number {
  const stopsInView = input.existingStopKms.filter(
    (km) => km >= input.visibleStartKm && km <= input.visibleEndKm,
  );

  const edgePoints = [input.visibleStartKm, input.visibleEndKm, ...stopsInView].sort(
    (left, right) => left - right,
  );
  let maxGapKm = 0;
  for (let index = 1; index < edgePoints.length; index += 1) {
    maxGapKm = Math.max(maxGapKm, edgePoints[index] - edgePoints[index - 1]);
  }

  if (maxGapKm >= LONG_GAP_KM) {
    return stopsInView.length >= MANY_STOPS_THRESHOLD
      ? EXPANDED_MAX_OFF_ROUTE_M * 0.85
      : EXPANDED_MAX_OFF_ROUTE_M;
  }
  if (stopsInView.length >= MANY_STOPS_THRESHOLD) {
    return REDUCED_MAX_OFF_ROUTE_M;
  }
  return BASE_MAX_OFF_ROUTE_M;
}

function elevationAtKm(trackPoints: DiscoverTrackPoint[], km: number): number | null {
  if (trackPoints.length === 0) {
    return null;
  }
  let bestIndex = 0;
  let bestDistance = Math.abs(trackPoints[0].km - km);
  for (let index = 1; index < trackPoints.length; index += 1) {
    const distance = Math.abs(trackPoints[index].km - km);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return trackPoints[bestIndex].eleM;
}

function nextStopKm(candidateKm: number, stopKms: number[]): number | null {
  const ahead = stopKms.filter((km) => km > candidateKm + 0.05).sort((left, right) => left - right);
  return ahead[0] ?? null;
}

const CLIMB_BOOST_CATEGORIES = new Set(["Gas station", "Drinking water", "Café", "Restaurant"]);
const CLIMB_PROXIMITY_KM = 3;

function climbProximityBoost(
  poiKm: number,
  category: string,
  climbRanges?: DiscoverClimbRange[],
): number {
  if (!climbRanges?.length || !CLIMB_BOOST_CATEGORIES.has(category)) {
    return 0;
  }
  for (const climb of climbRanges) {
    const midpoint = (climb.startKm + climb.endKm) / 2;
    if (Math.abs(poiKm - midpoint) <= CLIMB_PROXIMITY_KM) {
      return 12;
    }
  }
  return 0;
}

function rankCandidate(poi: DiscoverPoiInput, climbRanges?: DiscoverClimbRange[]): number {
  const score = planningScore({
    priority: poi.priority,
    category: poi.category,
    distanceOffRouteM: poi.distanceOffRouteM,
    score: poi.score,
    name: poi.name,
    brand: poi.brand,
    openingHours: poi.openingHours,
    tags: poi.tags,
  });
  return (
    score +
    categoryRank(poi.category) * 8 +
    climbProximityBoost(poi.distanceAlongKm, poi.category, climbRanges)
  );
}

export function discoverStopsInBounds(input: DiscoverStopsInput): DiscoverStopsResult {
  const limit = input.limit ?? DISCOVERY_MAX_RESULTS;
  const { startKm, endKm } = visibleKmRange(input.trackPoints, input.bounds);
  const maxOffRouteM = computeDiscoveryRadius({
    visibleStartKm: startKm,
    visibleEndKm: endKm,
    existingStopKms: input.existingStopKms,
  });
  const cacheKey = boundsCacheKey(input.bounds);

  const candidates: DiscoverCandidate[] = [];

  for (const poi of input.pois) {
    if (!isDiscoverableCategory(poi.category, poi.tags)) {
      continue;
    }
    if (!isInBounds(poi.lat, poi.lon, input.bounds)) {
      continue;
    }
    const key = poiOsmKey(poi.osmType, poi.osmId);
    if (input.dismissedPoiKeys?.has(key)) {
      continue;
    }
    if (input.verifiedPoiKeys?.has(key)) {
      continue;
    }
    if (input.primaryPoiKeys?.has(key)) {
      continue;
    }
    const allowedOffRoute = maxOffRouteForPoi(
      poi.category,
      maxOffRouteM,
      fuelRadiusForContext(maxOffRouteM),
    );
    if (poi.distanceOffRouteM > allowedOffRoute) {
      continue;
    }

    const rankScore = rankCandidate(poi, input.climbRanges);
    const nextKm = nextStopKm(poi.distanceAlongKm, input.existingStopKms);
    const candidateEle = elevationAtKm(input.trackPoints, poi.distanceAlongKm);
    const nextEle = nextKm != null ? elevationAtKm(input.trackPoints, nextKm) : null;
    const elevationDelta =
      candidateEle != null && nextEle != null ? Math.round(nextEle - candidateEle) : null;

    candidates.push({
      ...poi,
      rankScore,
      icon: discoverStopIcon(poi.category),
      services: servicesForCategory(poi.category),
      confidenceLabel: poiTier(poi.score) === "excellent"
        ? "High"
        : poiTier(poi.score) === "good"
          ? "Medium"
          : "Low",
      distanceToNextStopKm:
        nextKm != null ? Math.round((nextKm - poi.distanceAlongKm) * 10) / 10 : null,
      elevationToNextStopM: elevationDelta,
    });
  }

  candidates.sort((left, right) => right.rankScore - left.rankScore);

  return {
    candidates: candidates.slice(0, limit),
    visibleStartKm: startKm,
    visibleEndKm: endKm,
    maxOffRouteM,
    cacheKey,
  };
}

export class DiscoverStopsCache {
  private readonly entries = new Map<string, DiscoverStopsResult>();

  get(key: string): DiscoverStopsResult | undefined {
    return this.entries.get(key);
  }

  set(key: string, result: DiscoverStopsResult): DiscoverStopsResult {
    this.entries.set(key, result);
    return result;
  }

  resolve(input: DiscoverStopsInput): DiscoverStopsResult {
    const key = boundsCacheKey(input.bounds);
    const cached = this.entries.get(key);
    if (cached) {
      return cached;
    }
    return this.set(key, discoverStopsInBounds(input));
  }

  clear(): void {
    this.entries.clear();
  }
}
