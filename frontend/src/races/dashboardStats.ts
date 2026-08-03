import type { ResupplyZone, RoadbookResult } from "../api";
import type { VerifiedStopRecord } from "../planning/stopVerification/types";
import { lookupVerifiedStopRecord } from "../planning/stopVerification/types";
import { analyzeUnsupportedSections } from "../planning/unsupportedSections";
import { resolveSuggestedStops, suggestedStopZoneIds } from "../planning/suggestedStops";
import {
  buildDashboardStats,
  isSupermarketCategory,
  type RaceDashboardStats,
  type RaceReadinessInput,
} from "@shared/race/readiness";
import type { RiderAssumptions } from "@shared/race/riderAssumptions";
import { DEFAULT_RIDER_ASSUMPTIONS } from "@shared/race/riderAssumptions";

function zoneHasCategory(zone: ResupplyZone, key: "water" | "fuel" | "food"): boolean {
  return zone.categories.some((group) => group.key === key && group.primary !== null);
}

function primaryPoi(zone: ResupplyZone) {
  for (const key of ["water", "food", "fuel"] as const) {
    const group = zone.categories.find((item) => item.key === key);
    if (group?.primary) {
      return group.primary;
    }
  }
  return zone.categories.find((group) => group.primary)?.primary ?? null;
}

function isVerified(
  zoneId: number,
  verifiedStops: Record<string, VerifiedStopRecord>,
  poiId?: string | null,
): boolean {
  return lookupVerifiedStopRecord(verifiedStops, zoneId, poiId)?.status === "verified";
}

function lastVerificationAt(verifiedStops: Record<string, VerifiedStopRecord>): string | null {
  const timestamps = Object.values(verifiedStops)
    .filter((record) => record.status === "verified")
    .map((record) => record.updatedAt)
    .filter(Boolean);
  if (timestamps.length === 0) {
    return null;
  }
  return timestamps.sort()[timestamps.length - 1] ?? null;
}

export function computeDashboardStatsFromRoadbook(
  roadbook: RoadbookResult,
  verifiedStops: Record<string, VerifiedStopRecord>,
  assumptions: RiderAssumptions = DEFAULT_RIDER_ASSUMPTIONS,
): RaceDashboardStats {
  const zoneIds = suggestedStopZoneIds(resolveSuggestedStops(roadbook));
  const zones = roadbook.resupply_zones.filter((zone) => zoneIds.has(zone.zone_id));
  let verifiedCount = 0;
  let unverifiedCount = 0;
  let supermarkets = 0;
  let waterStops = 0;
  let fuelStops = 0;
  let supermarketVerified = 0;
  let waterVerified = 0;
  let fuelVerified = 0;
  let missingHours = 0;

  for (const zone of zones) {
    const verified = isVerified(zone.zone_id, verifiedStops);
    if (verified) {
      verifiedCount += 1;
    } else {
      unverifiedCount += 1;
    }

    const poi = primaryPoi(zone);
    const hasWater = zoneHasCategory(zone, "water");
    const hasFuel = zoneHasCategory(zone, "fuel");
    const hasSupermarket =
      zoneHasCategory(zone, "food") &&
      isSupermarketCategory(String(poi?.poi_category ?? ""));

    if (hasWater) {
      waterStops += 1;
      if (verified) {
        waterVerified += 1;
      }
    }
    if (hasFuel) {
      fuelStops += 1;
      if (verified) {
        fuelVerified += 1;
      }
    }
    if (hasSupermarket) {
      supermarkets += 1;
      if (verified) {
        supermarketVerified += 1;
      }
    }

    if (!poi?.opening_hours?.trim()) {
      missingHours += 1;
    }
  }

  const unsupported = analyzeUnsupportedSections(
    roadbook.resupply_zones,
    roadbook.route,
    roadbook.summary.distance_km,
  );
  const longestUnsupported =
    unsupported.length > 0 ? Math.max(...unsupported.map((section) => section.distanceKm)) : null;

  const input: RaceReadinessInput & {
    lastVerificationAt: string | null;
    stopCounts: { supermarkets: number; water: number; fuel: number };
  } = {
    verifiedStops: verifiedCount,
    unverifiedStops: unverifiedCount,
    categories: {
      supermarkets: { total: supermarkets, verified: supermarketVerified },
      water: { total: waterStops, verified: waterVerified },
      fuel: { total: fuelStops, verified: fuelVerified },
    },
    stopsMissingOpeningHours: missingHours,
    longestUnsupportedKm: longestUnsupported,
    maxGapKm: assumptions.maxGapWithoutResupplyKm,
    lastVerificationAt: lastVerificationAt(verifiedStops),
    stopCounts: { supermarkets, water: waterStops, fuel: fuelStops },
  };

  return buildDashboardStats(input, assumptions);
}
