import type { CompanionBundle, CompanionDiscoverPoi, CompanionStop } from "../types/sync";
import { collectAllBundlePois } from "./bundlePois";
import { sameStop } from "./stopMatching";

/** Normal zone markers: 12px default, 16px selected — discovery sits between. */
export const DISCOVER_MARKER_SIZE_PX = 14;
export const DISCOVER_MARKER_SELECTED_SIZE_PX = 15;

export function isMapVisibleStopStatus(
  status: CompanionStop["verificationStatus"],
  showUnverified: boolean,
): boolean {
  if (showUnverified) {
    return true;
  }
  return status === "verified" || status === "pending";
}

export function findKnownBundlePoi(
  bundle: CompanionBundle,
  stop: Pick<CompanionStop, "poiId" | "zoneId" | "osmId" | "osmType">,
) {
  return (
    collectAllBundlePois(bundle).find(
      (entry) =>
        sameStop(entry.stop, stop) ||
        (stop.osmId != null &&
          stop.osmType &&
          entry.stop.osmId === stop.osmId &&
          entry.stop.osmType === stop.osmType),
    ) ?? null
  );
}

export function resolveDiscoverPoiForStop(
  bundle: CompanionBundle,
  stop: CompanionStop,
  zoneId: number,
): CompanionDiscoverPoi | null {
  if (stop.osmId == null || !stop.osmType) {
    return null;
  }

  const fromBundle =
    bundle.discoverPois?.find(
      (poi) => poi.osmId === stop.osmId && poi.osmType === stop.osmType,
    ) ?? null;
  if (fromBundle) {
    return fromBundle;
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
    zoneId,
    openingHours: stop.openingHours,
    brand: null,
    tags: null,
  };
}
