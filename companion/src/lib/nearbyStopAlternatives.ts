import { PLANNING_AREA_KM } from "@shared/race/planningArea";
import { planningScore } from "@shared/race/poiScoring";
import type { CompanionStop, CompanionStopAlternative } from "@shared/types/sync";

export interface StopAlternativeView {
  key: string;
  name: string;
  category: string;
  categoryLabel: string;
  icon: string;
  distanceLabel: string;
  score: number | null;
  verificationStatus: CompanionStop["verificationStatus"];
  lat: number;
  lon: number;
  placeId?: string | null;
  isEmbedded: boolean;
  stop?: CompanionStop;
  alternative?: CompanionStopAlternative;
}

function formatDetour(distanceOffRouteM: number | undefined): string {
  if (distanceOffRouteM == null || !Number.isFinite(distanceOffRouteM)) {
    return "on route";
  }
  if (distanceOffRouteM < 50) {
    return "on route";
  }
  return `${Math.round(distanceOffRouteM)} m off route`;
}

function embeddedAlternativeView(
  alternative: CompanionStopAlternative,
  anchorKm: number,
): StopAlternativeView | null {
  const alongKm = alternative.distanceAlongKm;
  if (alongKm == null || !Number.isFinite(alongKm)) {
    return null;
  }
  const alongDeltaKm = Math.abs(alongKm - anchorKm);
  if (alongDeltaKm > PLANNING_AREA_KM) {
    return null;
  }
  return {
    key: alternative.poiId ?? `${alternative.osmType}-${alternative.osmId}`,
    name: alternative.name,
    category: alternative.category,
    categoryLabel: alternative.categoryLabel,
    icon: alternative.icon,
    distanceLabel: formatDetour(alternative.distanceOffRouteM),
    score: alternative.score ?? null,
    verificationStatus: alternative.verificationStatus,
    lat: alternative.lat,
    lon: alternative.lon,
    placeId: alternative.placeId,
    isEmbedded: true,
    alternative,
  };
}

function zoneAlternativeView(
  stop: CompanionStop,
  anchorKm: number,
): StopAlternativeView {
  const deltaM = Math.round(Math.abs(stop.km - anchorKm) * 1000);
  const position =
    deltaM < 75
      ? "nearby"
      : stop.km > anchorKm
        ? `${deltaM} m after`
        : `${Math.abs(deltaM)} m before`;
  return {
    key: `zone-${stop.zoneId}`,
    name: stop.name,
    category: stop.category,
    categoryLabel: stop.categoryLabel,
    icon: stop.icon,
    distanceLabel: position,
    score: stop.confidenceScore ?? null,
    verificationStatus: stop.verificationStatus,
    lat: stop.lat,
    lon: stop.lon,
    placeId: stop.placeId,
    isEmbedded: false,
    stop,
  };
}

const MAX_ALTERNATIVES = 5;

export function buildStopAlternatives(
  anchor: CompanionStop,
  allStops: CompanionStop[],
): StopAlternativeView[] {
  const embedded = (anchor.alternatives ?? anchor.nearbyAlternatives ?? [])
    .map((alternative) => embeddedAlternativeView(alternative, anchor.km))
    .filter((item): item is StopAlternativeView => item != null);
  const embeddedKeys = new Set(embedded.map((item) => item.key));

  const nearby = allStops
    .filter(
      (stop) =>
        stop.zoneId !== anchor.zoneId &&
        Math.abs(stop.km - anchor.km) <= PLANNING_AREA_KM,
    )
    .map((stop) => zoneAlternativeView(stop, anchor.km))
    .filter((item) => !embeddedKeys.has(item.key));

  const merged = [...embedded, ...nearby];
  merged.sort((left, right) => {
    const leftScore =
      left.score ??
      planningScore({
        priority: 2,
        category: left.category,
        distanceOffRouteM: left.alternative?.distanceOffRouteM ?? 0,
      });
    const rightScore =
      right.score ??
      planningScore({
        priority: 2,
        category: right.category,
        distanceOffRouteM: right.alternative?.distanceOffRouteM ?? 0,
      });
    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }
    const leftDist = left.stop
      ? Math.abs(left.stop.km - anchor.km)
      : (left.alternative?.distanceAlongKm ?? anchor.km) - anchor.km;
    const rightDist = right.stop
      ? Math.abs(right.stop.km - anchor.km)
      : (right.alternative?.distanceAlongKm ?? anchor.km) - anchor.km;
    return Math.abs(leftDist) - Math.abs(rightDist);
  });

  return merged.slice(0, MAX_ALTERNATIVES);
}

/** @deprecated Use buildStopAlternatives */
export function findNearbyStopAlternatives(
  anchor: CompanionStop,
  allStops: CompanionStop[],
): Array<{
  stop: CompanionStop;
  positionLabel: string;
  distanceM: number;
}> {
  return buildStopAlternatives(anchor, allStops)
    .filter((item) => item.stop)
    .map((item) => ({
      stop: item.stop!,
      positionLabel: item.distanceLabel,
      distanceM: Math.round(Math.abs(item.stop!.km - anchor.km) * 1000),
    }));
}
