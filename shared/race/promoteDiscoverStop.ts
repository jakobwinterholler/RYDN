import type { CompanionBundle, CompanionDiscoverPoi, CompanionStop } from "../types/sync";
import type { DiscoverCandidate, DiscoverPoiInput } from "./discoverStops";
import { discoverStopIcon } from "./discoverStops";
import { collectAllBundlePois } from "./bundlePois";

export interface PromotedSuggestedStop {
  zone_id: number;
  osm_id: number;
  osm_type: string;
  name: string | null;
  poi_category: string;
  category_key: string;
  category_label: string;
  distance_along_km: number;
  distance_off_route_m: number;
  lat: number;
  lon: number;
  score: number;
  reason: string | null;
}

function categoryKeyFromCategory(category: string): string {
  const lowered = category.toLowerCase();
  if (lowered.includes("gas") || lowered.includes("fuel")) {
    return "fuel";
  }
  if (lowered.includes("drinking water") || lowered === "water") {
    return "water";
  }
  if (
    lowered.includes("supermarket") ||
    lowered.includes("convenience") ||
    lowered.includes("bakery") ||
    lowered.includes("restaurant") ||
    lowered.includes("café") ||
    lowered.includes("cafe") ||
    lowered.includes("fast food")
  ) {
    return "food";
  }
  return "food";
}

function categoryLabelFromCategory(category: string): string {
  const key = categoryKeyFromCategory(category);
  if (key === "fuel") {
    return "Fuel";
  }
  if (key === "water") {
    return "Water";
  }
  return category;
}

function poiKey(osmType: string, osmId: number): string {
  return `${osmType}-${osmId}`;
}

export function buildPromotedSuggestedStop(
  poi: Pick<
    DiscoverPoiInput,
    | "osmId"
    | "osmType"
    | "name"
    | "category"
    | "lat"
    | "lon"
    | "distanceAlongKm"
    | "distanceOffRouteM"
    | "score"
    | "zoneId"
    | "brand"
  >,
): PromotedSuggestedStop {
  const category = poi.category?.trim() || "Resupply";
  const zoneId = poi.zoneId;
  if (zoneId == null) {
    throw new Error("Discovered stop is missing a resupply zone.");
  }
  return {
    zone_id: zoneId,
    osm_id: poi.osmId,
    osm_type: poi.osmType,
    name: poi.name?.trim() || poi.brand?.trim() || null,
    poi_category: category,
    category_key: categoryKeyFromCategory(category),
    category_label: categoryLabelFromCategory(category),
    distance_along_km: poi.distanceAlongKm,
    distance_off_route_m: poi.distanceOffRouteM,
    lat: poi.lat,
    lon: poi.lon,
    score: poi.score,
    reason: "Discovered on route",
  };
}

export function upsertPromotedSuggestedStop(
  existing: PromotedSuggestedStop[] | undefined,
  promoted: PromotedSuggestedStop,
): PromotedSuggestedStop[] {
  const stops = [...(existing ?? [])];
  const osmKey = poiKey(promoted.osm_type, promoted.osm_id);
  const withoutDuplicate = stops.filter(
    (stop) => poiKey(stop.osm_type, stop.osm_id) !== osmKey,
  );
  const zoneIndex = withoutDuplicate.findIndex((stop) => stop.zone_id === promoted.zone_id);
  if (zoneIndex >= 0) {
    withoutDuplicate[zoneIndex] = promoted;
  } else {
    withoutDuplicate.push(promoted);
  }
  return withoutDuplicate.sort((left, right) => left.distance_along_km - right.distance_along_km);
}

export function buildCompanionStopFromDiscoverPoi(
  discoverPoi: CompanionDiscoverPoi,
  template?: CompanionStop,
): CompanionStop {
  const category = discoverPoi.category?.trim() || "Resupply";
  const zoneId = discoverPoi.zoneId ?? template?.zoneId ?? 0;
  return {
    poiId: `poi_${discoverPoi.osmId}`,
    zoneId,
    osmId: discoverPoi.osmId,
    osmType: discoverPoi.osmType,
    km: discoverPoi.distanceAlongKm,
    lat: discoverPoi.lat,
    lon: discoverPoi.lon,
    name: discoverPoi.name?.trim() || discoverPoi.brand?.trim() || "Resupply",
    category,
    categoryLabel: categoryLabelFromCategory(category),
    icon: discoverStopIcon(category),
    distanceOffRouteM: discoverPoi.distanceOffRouteM,
    verificationStatus: template?.verificationStatus ?? "unverified",
    openingHours: discoverPoi.openingHours ?? template?.openingHours ?? null,
    notes: template?.notes ?? null,
    phone: template?.phone ?? null,
    website: template?.website ?? null,
    placeId: template?.placeId ?? null,
    hasFood: categoryKeyFromCategory(category) === "food" || category.toLowerCase().includes("gas"),
    hasWater: categoryKeyFromCategory(category) === "water" || category.toLowerCase().includes("gas"),
    hasFuel: categoryKeyFromCategory(category) === "fuel",
    hasCoffee: category === "Café" || category === "Restaurant",
    confidenceScore: discoverPoi.score,
    verificationDate: template?.verificationDate ?? null,
    resupplyReason: template?.resupplyReason ?? "Discovered on route",
    alternatives: template?.alternatives ?? [],
    nearbyAlternatives: template?.nearbyAlternatives ?? [],
  };
}

export function findDiscoverPoiInBundle(
  bundle: CompanionBundle,
  osmId: number,
  osmType: string,
): boolean {
  return collectAllBundlePois(bundle).some(
    (entry) => entry.stop.osmId === osmId && entry.stop.osmType === osmType,
  );
}

export function insertPromotedDiscoverStop(
  bundle: CompanionBundle,
  discoverPoi: CompanionDiscoverPoi,
): CompanionStop[] {
  const zoneId = discoverPoi.zoneId;
  const existingZoneStop =
    zoneId != null ? bundle.stops.find((stop) => stop.zoneId === zoneId) : undefined;

  if (existingZoneStop) {
    const promoted = buildCompanionStopFromDiscoverPoi(discoverPoi, {
      ...existingZoneStop,
      alternatives: existingZoneStop.alternatives,
      nearbyAlternatives: existingZoneStop.nearbyAlternatives,
    });
    return bundle.stops.map((stop) => (stop.zoneId === zoneId ? promoted : stop));
  }

  const promoted = buildCompanionStopFromDiscoverPoi(discoverPoi);
  return [...bundle.stops, promoted].sort((left, right) => left.km - right.km);
}

export function candidateToDiscoverPoi(candidate: DiscoverCandidate): CompanionDiscoverPoi {
  return {
    osmId: candidate.osmId,
    osmType: candidate.osmType,
    name: candidate.name,
    category: candidate.category,
    priority: candidate.priority,
    lat: candidate.lat,
    lon: candidate.lon,
    distanceAlongKm: candidate.distanceAlongKm,
    distanceOffRouteM: candidate.distanceOffRouteM,
    score: candidate.score,
    zoneId: candidate.zoneId,
    openingHours: candidate.openingHours ?? null,
    brand: candidate.brand ?? null,
    tags: candidate.tags ?? null,
  };
}
