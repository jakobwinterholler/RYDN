import type { ResupplyZone, RouteVisualization } from "../../api";
import { computeUltraStopScore } from "../stopPresentation";
import { analyzeUnsupportedSections } from "../unsupportedSections";
import type { TimeMode } from "../types";
import type { TimeWindowId } from "../timeWindows";
import type { VerifiedStopRecord } from "./types";
import { verifiedStopKey } from "./types";

export type VerificationPriorityTier = 1 | 2 | 3 | 4 | 5;

export interface PrioritizedStop {
  zone: ResupplyZone;
  tier: VerificationPriorityTier;
  tierScore: number;
  context: {
    isLastBeforeRemote: boolean;
    isOnlyStopInArea: boolean;
    isBorderline: boolean;
  };
}

const REMOTE_SECTION_KM = 35;
const SOLO_STOP_RADIUS_KM = 30;
/** Stops within this gap share an area — priority applies inside the area only. */
const AREA_CLUSTER_KM = 12;

export function isStopDecided(record: VerifiedStopRecord | undefined): boolean {
  return (
    record?.status === "verified" ||
    record?.status === "rejected" ||
    record?.status === "deferred"
  );
}

export function isStopPending(
  zoneId: number,
  verifiedStops: Record<string, VerifiedStopRecord>,
): boolean {
  return !isStopDecided(verifiedStops[verifiedStopKey(zoneId)]);
}

function lastStopBeforeRemoteZoneIds(
  zones: ResupplyZone[],
  route: RouteVisualization,
  totalKm: number,
): Set<number> {
  const sections = analyzeUnsupportedSections(zones, route, totalKm);
  const ids = new Set<number>();
  for (const section of sections) {
    if (section.distanceKm < REMOTE_SECTION_KM) {
      continue;
    }
    if (
      section.riskLevel === "critical" ||
      section.riskLevel === "extreme" ||
      section.riskLevel === "high"
    ) {
      const stop = section.reliableFoodBefore ?? section.stopBefore;
      if (stop) {
        ids.add(stop.zoneId);
      }
    }
  }
  return ids;
}

function onlyStopInAreaIds(zones: ResupplyZone[]): Set<number> {
  const ids = new Set<number>();
  for (let index = 0; index < zones.length; index += 1) {
    const zone = zones[index];
    const prevKm = index > 0 ? zones[index - 1].distance_along_km : -Infinity;
    const nextKm = index < zones.length - 1 ? zones[index + 1].distance_along_km : Infinity;
    const prevGap = zone.distance_along_km - prevKm;
    const nextGap = nextKm - zone.distance_along_km;
    if (prevGap >= SOLO_STOP_RADIUS_KM && nextGap >= SOLO_STOP_RADIUS_KM) {
      ids.add(zone.zone_id);
    }
  }
  return ids;
}

function assignTier(
  zone: ResupplyZone,
  remoteBefore: Set<number>,
  soloStop: Set<number>,
  ultraScore: number,
): { tier: VerificationPriorityTier; tierScore: number; context: PrioritizedStop["context"] } {
  const isLastBeforeRemote = remoteBefore.has(zone.zone_id);
  const isOnlyStopInArea = soloStop.has(zone.zone_id);
  const isBorderline = ultraScore >= 38 && ultraScore < 58;

  if (isLastBeforeRemote) {
    return {
      tier: 1,
      tierScore: 1000 + ultraScore,
      context: { isLastBeforeRemote, isOnlyStopInArea, isBorderline },
    };
  }
  if (ultraScore >= 58) {
    return {
      tier: 2,
      tierScore: 700 + ultraScore,
      context: { isLastBeforeRemote, isOnlyStopInArea, isBorderline },
    };
  }
  if (isOnlyStopInArea) {
    return {
      tier: 3,
      tierScore: 600 + ultraScore,
      context: { isLastBeforeRemote, isOnlyStopInArea, isBorderline },
    };
  }
  if (isBorderline) {
    const borderlineCloseness = 50 - Math.abs(ultraScore - 48);
    return {
      tier: 4,
      tierScore: 400 + borderlineCloseness,
      context: { isLastBeforeRemote, isOnlyStopInArea, isBorderline },
    };
  }
  return {
    tier: 5,
    tierScore: ultraScore,
    context: { isLastBeforeRemote, isOnlyStopInArea, isBorderline },
  };
}

function comparePriority(left: PrioritizedStop, right: PrioritizedStop): number {
  if (left.tier !== right.tier) {
    return left.tier - right.tier;
  }
  if (left.tierScore !== right.tierScore) {
    return right.tierScore - left.tierScore;
  }
  return left.zone.distance_along_km - right.zone.distance_along_km;
}

function sortWithinArea(stops: PrioritizedStop[]): PrioritizedStop[] {
  return [...stops].sort(comparePriority);
}

function clusterIntoAreas(stops: PrioritizedStop[]): PrioritizedStop[][] {
  const byKm = [...stops].sort(
    (left, right) => left.zone.distance_along_km - right.zone.distance_along_km,
  );
  const areas: PrioritizedStop[][] = [];
  let current: PrioritizedStop[] = [];

  for (const stop of byKm) {
    if (current.length === 0) {
      current.push(stop);
      continue;
    }
    const lastKm = current[current.length - 1].zone.distance_along_km;
    if (stop.zone.distance_along_km - lastKm <= AREA_CLUSTER_KM) {
      current.push(stop);
    } else {
      areas.push(sortWithinArea(current));
      current = [stop];
    }
  }
  if (current.length > 0) {
    areas.push(sortWithinArea(current));
  }
  return areas;
}

function buildPrioritizedStops(
  planningHubs: ResupplyZone[],
  route: RouteVisualization,
  totalKm: number,
  timeWindowId: TimeWindowId | null,
  timeMode: TimeMode,
): PrioritizedStop[] {
  const remoteBefore = lastStopBeforeRemoteZoneIds(planningHubs, route, totalKm);
  const soloStop = onlyStopInAreaIds(planningHubs);

  return planningHubs.map((zone) => {
    const ultra = computeUltraStopScore(zone, timeWindowId, timeMode);
    const { tier, tierScore, context } = assignTier(
      zone,
      remoteBefore,
      soloStop,
      ultra.score,
    );
    return { zone, tier, tierScore, context };
  });
}

/**
 * Full verification route: start → finish, with priority ordering inside each area.
 */
export function buildVerificationRoute(
  planningHubs: ResupplyZone[],
  route: RouteVisualization,
  totalKm: number,
  timeWindowId: TimeWindowId | null,
  timeMode: TimeMode,
): PrioritizedStop[] {
  const stops = buildPrioritizedStops(planningHubs, route, totalKm, timeWindowId, timeMode);
  return clusterIntoAreas(stops).flat();
}

/** @deprecated Use buildVerificationRoute — kept for tests importing the old name. */
export function buildVerificationQueue(
  planningHubs: ResupplyZone[],
  route: RouteVisualization,
  totalKm: number,
  verifiedStops: Record<string, VerifiedStopRecord>,
  timeWindowId: TimeWindowId | null,
  timeMode: TimeMode,
): PrioritizedStop[] {
  return buildVerificationRoute(
    planningHubs,
    route,
    totalKm,
    timeWindowId,
    timeMode,
  ).filter((item) => isStopPending(item.zone.zone_id, verifiedStops));
}

export function firstPendingIndex(
  route: PrioritizedStop[],
  verifiedStops: Record<string, VerifiedStopRecord>,
): number {
  return route.findIndex((item) => isStopPending(item.zone.zone_id, verifiedStops));
}

export function nextPendingIndex(
  route: PrioritizedStop[],
  verifiedStops: Record<string, VerifiedStopRecord>,
  afterIndex: number,
): number {
  for (let index = afterIndex + 1; index < route.length; index += 1) {
    if (isStopPending(route[index].zone.zone_id, verifiedStops)) {
      return index;
    }
  }
  for (let index = 0; index <= afterIndex; index += 1) {
    if (isStopPending(route[index].zone.zone_id, verifiedStops)) {
      return index;
    }
  }
  return -1;
}

export function verificationProgress(
  planningHubs: ResupplyZone[],
  verifiedStops: Record<string, VerifiedStopRecord>,
): { verified: number; total: number; remaining: number; estimatedMinutes: number; verifiedPercent: number } {
  const total = planningHubs.length;
  let verified = 0;
  let remaining = 0;
  for (const zone of planningHubs) {
    const record = verifiedStops[verifiedStopKey(zone.zone_id)];
    if (record?.status === "verified") {
      verified += 1;
    } else if (!isStopDecided(record)) {
      remaining += 1;
    }
  }
  const estimatedMinutes = Math.max(1, Math.ceil((remaining * 25) / 60));
  const verifiedPercent = total > 0 ? Math.round((verified / total) * 100) : 0;
  return { verified, total, remaining, estimatedMinutes, verifiedPercent };
}

export function allStopsReviewed(
  planningHubs: ResupplyZone[],
  verifiedStops: Record<string, VerifiedStopRecord>,
): boolean {
  return planningHubs.every((zone) => !isStopPending(zone.zone_id, verifiedStops));
}
