import type { CompanionBundle, CompanionStop, CompanionUnsupportedSection } from "../types";
import {
  DEFAULT_RIDER_ASSUMPTIONS,
  estimateRidingHours,
  type RiderAssumptions,
} from "@shared/race/riderAssumptions";
import { filterStopsForResupplyView } from "@shared/race/resupplyView";

export function bundleAssumptions(bundle: CompanionBundle): RiderAssumptions {
  return {
    ...DEFAULT_RIDER_ASSUMPTIONS,
    ...(bundle.riderAssumptions ?? {}),
  };
}

export function visibleStops(bundle: CompanionBundle, includeUnverified: boolean): CompanionStop[] {
  return filterStopsForResupplyView(bundle.stops, !includeUnverified);
}

export function nextResupplyStop(
  bundle: CompanionBundle,
  currentKm: number,
  includeUnverified: boolean,
): CompanionStop | null {
  const stops = visibleStops(bundle, includeUnverified)
    .filter((stop) => stop.km >= currentKm - 0.25)
    .sort((left, right) => left.km - right.km);
  return stops[0] ?? null;
}

export function unsupportedAfterKm(
  bundle: CompanionBundle,
  fromKm: number,
): CompanionUnsupportedSection | null {
  const sections = [...bundle.unsupportedSections]
    .filter((section) => section.startKm >= fromKm - 0.5)
    .sort((left, right) => left.startKm - right.startKm);
  return sections[0] ?? null;
}

export function remainingStops(
  bundle: CompanionBundle,
  currentKm: number,
  includeUnverified: boolean,
): number {
  return visibleStops(bundle, includeUnverified).filter((stop) => stop.km >= currentKm - 0.25).length;
}

export function remainingUnsupportedKm(
  bundle: CompanionBundle,
  currentKm: number,
): number {
  return bundle.unsupportedSections
    .filter((section) => section.endKm > currentKm)
    .reduce((total, section) => {
      const start = Math.max(section.startKm, currentKm);
      const end = section.endKm;
      return total + Math.max(0, end - start);
    }, 0);
}

export function estimatedRidingToStop(
  bundle: CompanionBundle,
  fromKm: number,
  toKm: number,
): number {
  const assumptions = bundleAssumptions(bundle);
  const distance = Math.max(0, toKm - fromKm);
  const ratio = bundle.race.distanceKm > 0 ? distance / bundle.race.distanceKm : 0;
  const elevation = bundle.race.elevationGainM * ratio;
  return estimateRidingHours(distance, elevation, assumptions);
}

export function serviceLabels(stop: CompanionStop): string {
  const services = [];
  if (stop.hasFood) {
    services.push("Food");
  }
  if (stop.hasWater) {
    services.push("Water");
  }
  if (stop.hasFuel) {
    services.push("Fuel");
  }
  if (stop.hasCoffee) {
    services.push("Coffee");
  }
  return services.length > 0 ? services.join(" · ") : stop.categoryLabel;
}

export function formatEstimatedArrival(ridingHours: number | null): string | null {
  if (ridingHours == null || !Number.isFinite(ridingHours) || ridingHours <= 0) {
    return null;
  }
  const arrival = new Date(Date.now() + ridingHours * 3_600_000);
  return arrival.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function stopStatusLabel(status: CompanionStop["verificationStatus"]): string {
  if (status === "verified") {
    return "Verified everywhere";
  }
  if (status === "pending") {
    return "✓ Verified on this device";
  }
  if (status === "needs_review") {
    return "Needs review";
  }
  return "Unverified";
}

export function isVerifiedEverywhere(status: CompanionStop["verificationStatus"]): boolean {
  return status === "verified";
}

export function isVerifiedLocally(status: CompanionStop["verificationStatus"]): boolean {
  return status === "pending";
}

export function canVerifyStop(status: CompanionStop["verificationStatus"]): boolean {
  return status !== "verified" && status !== "pending";
}

export function canConfirmOnRoute(status: CompanionStop["verificationStatus"]): boolean {
  return status === "verified";
}
