import type { CompanionBundle, CompanionStop, CompanionStopAlternative } from "@shared/types/sync";
import { findStopByIdentity, sameStop, stopIdentity } from "./stopMatching";

export interface BundlePoiEntry {
  poiId: string;
  role: "primary" | "alternative";
  parentZoneId: number;
  stop: CompanionStop;
}

function alternativeToStop(
  anchor: CompanionStop,
  alternative: CompanionStopAlternative,
): CompanionStop {
  const km =
    alternative.distanceAlongKm != null && Number.isFinite(alternative.distanceAlongKm)
      ? alternative.distanceAlongKm
      : anchor.km;

  return {
    poiId: alternative.poiId ?? (alternative.osmId != null ? `poi_${alternative.osmId}` : anchor.poiId),
    zoneId: anchor.zoneId,
    osmId: alternative.osmId,
    osmType: alternative.osmType,
    km,
    lat: alternative.lat,
    lon: alternative.lon,
    name: alternative.name,
    category: alternative.category,
    categoryLabel: alternative.categoryLabel,
    icon: alternative.icon,
    distanceOffRouteM: alternative.distanceOffRouteM,
    verificationStatus: alternative.verificationStatus,
    openingHours: alternative.openingHours,
    notes: null,
    phone: alternative.phone,
    website: alternative.website,
    placeId: alternative.placeId,
    hasFood: alternative.hasFood ?? false,
    hasWater: alternative.hasWater ?? false,
    hasFuel: alternative.hasFuel ?? false,
    hasCoffee: anchor.hasCoffee ?? false,
    confidenceScore: alternative.confidenceScore ?? alternative.score ?? null,
    verificationDate: null,
    resupplyReason: null,
    alternatives: [],
    nearbyAlternatives: [],
  };
}

/** Every POI exported in the bundle — primary stops plus embedded alternatives. */
export function collectAllBundlePois(bundle: CompanionBundle): BundlePoiEntry[] {
  const seen = new Set<string>();
  const entries: BundlePoiEntry[] = [];

  for (const stop of bundle.stops) {
    const primaryKey = stopIdentity(stop);
    if (!seen.has(primaryKey)) {
      seen.add(primaryKey);
      entries.push({
        poiId: primaryKey,
        role: "primary",
        parentZoneId: stop.zoneId,
        stop,
      });
    }

    const alternatives = stop.alternatives ?? stop.nearbyAlternatives ?? [];
    for (const alternative of alternatives) {
      const altKey =
        alternative.poiId ??
        (alternative.osmId != null
          ? `${alternative.osmType ?? "node"}-${alternative.osmId}`
          : `${primaryKey}-alt-${alternative.name}`);
      if (seen.has(altKey)) {
        continue;
      }
      seen.add(altKey);
      entries.push({
        poiId: altKey,
        role: "alternative",
        parentZoneId: stop.zoneId,
        stop: alternativeToStop(stop, alternative),
      });
    }
  }

  return entries;
}

export function findBundlePoi(bundle: CompanionBundle, needle: string): BundlePoiEntry[] {
  const normalized = needle.trim().toLowerCase();
  return collectAllBundlePois(bundle).filter((entry) =>
    entry.stop.name.toLowerCase().includes(normalized),
  );
}

export function findBundlePoiByOsmId(bundle: CompanionBundle, osmId: number): BundlePoiEntry | null {
  return (
    collectAllBundlePois(bundle).find((entry) => entry.stop.osmId === osmId) ?? null
  );
}

export function resolveRenderedStop(
  bundle: CompanionBundle,
  candidate: CompanionStop,
): CompanionStop {
  const flattened = collectAllBundlePois(bundle).map((entry) => entry.stop);
  return findStopByIdentity(flattened, candidate) ?? candidate;
}

export { sameStop, stopIdentity };
