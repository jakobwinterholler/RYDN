import { analyzeRouteSegmentDifficulty } from "@shared/race/routeSegmentDifficulty";
import { filterStopsForResupplyView } from "@shared/race/resupplyView";
import type { CompanionBundle, CompanionStop, ResupplyTimelineEntry } from "../types";
import {
  googleMapsUrl as sharedGoogleMapsUrl,
  googleStreetViewUrl as sharedGoogleStreetViewUrl,
  type StreetViewUrlOptions,
} from "@shared/race/streetViewUrl";
import { estimatedRidingToStop } from "./raceExecution";

export interface ResupplyGapInfo {
  distanceKm: number;
  elevationGainM: number;
  elevationLossM: number;
  ridingTimeHours: number;
  difficultyColor: string;
  difficultyLabel: string;
  unsupportedLabel?: string;
}

export interface ResupplyCardEntry {
  stop: CompanionStop;
  gapBefore?: ResupplyGapInfo;
}

export function elevationGainBetweenKm(
  bundle: CompanionBundle,
  fromKm: number,
  toKm: number,
): number {
  const elevations = bundle.route.elevationsM;
  const coordinates = bundle.route.coordinates;
  if (
    !elevations?.length ||
    elevations.length !== coordinates.length ||
    toKm <= fromKm
  ) {
    const total = bundle.race.distanceKm;
    const ratio = total > 0 ? (toKm - fromKm) / total : 0;
    return Math.round(bundle.race.elevationGainM * ratio);
  }

  const total = bundle.race.distanceKm;
  let gain = 0;
  for (let index = 1; index < elevations.length; index += 1) {
    const startKm = total * ((index - 1) / Math.max(elevations.length - 1, 1));
    const endKm = total * (index / Math.max(elevations.length - 1, 1));
    if (endKm <= fromKm || startKm >= toKm) {
      continue;
    }
    const delta = elevations[index] - elevations[index - 1];
    if (delta > 0) {
      gain += delta;
    }
  }
  return Math.round(gain);
}

export function elevationLossBetweenKm(
  bundle: CompanionBundle,
  fromKm: number,
  toKm: number,
): number {
  const elevations = bundle.route.elevationsM;
  const coordinates = bundle.route.coordinates;
  if (
    !elevations?.length ||
    elevations.length !== coordinates.length ||
    toKm <= fromKm
  ) {
    return 0;
  }

  const total = bundle.race.distanceKm;
  let loss = 0;
  for (let index = 1; index < elevations.length; index += 1) {
    const startKm = total * ((index - 1) / Math.max(elevations.length - 1, 1));
    const endKm = total * (index / Math.max(elevations.length - 1, 1));
    if (endKm <= fromKm || startKm >= toKm) {
      continue;
    }
    const delta = elevations[index] - elevations[index - 1];
    if (delta < 0) {
      loss += Math.abs(delta);
    }
  }
  return Math.round(loss);
}

export function unsupportedLabelBetweenKm(
  bundle: CompanionBundle,
  fromKm: number,
  toKm: number,
): string | undefined {
  const section = bundle.unsupportedSections.find(
    (item) => item.startKm < toKm && item.endKm > fromKm && item.distanceKm >= 5,
  );
  return section?.displayLabel;
}

export function buildResupplyCards(
  bundle: CompanionBundle,
  verifiedOnly: boolean,
): ResupplyCardEntry[] {
  const stops = filterStopsForResupplyView(bundle.stops, verifiedOnly).sort(
    (left, right) => left.km - right.km,
  );

  return stops.map((stop, index) => {
    const previous = stops[index - 1];
    if (!previous) {
      return { stop };
    }
    const fromKm = previous.km;
    const toKm = stop.km;
    const distanceKm = Math.max(0, toKm - fromKm);
    const elevationGainM = elevationGainBetweenKm(bundle, fromKm, toKm);
    const elevationLossM = elevationLossBetweenKm(bundle, fromKm, toKm);
    const ridingTimeHours = estimatedRidingToStop(bundle, fromKm, toKm);
    const difficulty = analyzeRouteSegmentDifficulty({
      distanceKm,
      elevationGainM,
      elevationLossM,
      ridingTimeHours,
    });
    return {
      stop,
      gapBefore: {
        distanceKm,
        elevationGainM,
        elevationLossM,
        ridingTimeHours,
        difficultyColor: difficulty.color,
        difficultyLabel: difficulty.label,
        unsupportedLabel: unsupportedLabelBetweenKm(bundle, fromKm, toKm),
      },
    };
  });
}

export function buildResupplyTimeline(
  bundle: CompanionBundle,
  includeUnverified: boolean,
): ResupplyTimelineEntry[] {
  const entries: ResupplyTimelineEntry[] = [];

  for (const stop of bundle.stops) {
    if (stop.verificationStatus === "verified" || includeUnverified) {
      entries.push({ kind: "stop", km: stop.km, stop });
    }
  }

  for (const section of bundle.unsupportedSections) {
    entries.push({ kind: "unsupported", km: section.startKm, section });
  }

  return entries.sort((left, right) => left.km - right.km || left.kind.localeCompare(right.kind));
}

export function formatKm(km: number): string {
  return `${Math.round(km)} km`;
}

export function googleMapsUrl(lat: number, lon: number, placeId?: string | null): string {
  return sharedGoogleMapsUrl(lat, lon, placeId);
}

export function googleStreetViewUrl(
  stop: Pick<CompanionStop, "lat" | "lon" | "placeId" | "km" | "name">,
  options?: StreetViewUrlOptions,
): string {
  return sharedGoogleStreetViewUrl(
    {
      lat: stop.lat,
      lon: stop.lon,
      placeId: stop.placeId,
      routeKm: stop.km,
      name: stop.name,
    },
    options,
  );
}

export function stopByZoneId(bundle: CompanionBundle, zoneId: number): CompanionStop | null {
  return bundle.stops.find((stop) => stop.zoneId === zoneId) ?? null;
}
