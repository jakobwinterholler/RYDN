import type { CompanionStop } from "../types/sync";
import type { CompanionVerificationSubmission } from "../types/verification";

/** Stable identity for a rendered POI — prefer poiId, fall back to zone+coords. */
export function stopIdentity(
  stop: Pick<CompanionStop, "poiId" | "zoneId" | "osmId" | "osmType">,
): string {
  if (stop.poiId) {
    return stop.poiId;
  }
  if (stop.osmId != null && stop.osmType) {
    return `${stop.osmType}-${stop.osmId}`;
  }
  return `zone-${stop.zoneId}`;
}

export function submissionIdentity(submission: CompanionVerificationSubmission): string {
  if (submission.poiId) {
    return submission.poiId;
  }
  return `zone-${submission.zoneId}`;
}

export function sameStop(
  left: Pick<CompanionStop, "poiId" | "zoneId" | "osmId" | "osmType">,
  right: Pick<CompanionStop, "poiId" | "zoneId" | "osmId" | "osmType">,
): boolean {
  return stopIdentity(left) === stopIdentity(right);
}

export function stopMatchesSubmission(
  stop: Pick<CompanionStop, "poiId" | "zoneId">,
  submission: CompanionVerificationSubmission,
): boolean {
  if (submission.poiId) {
    return stop.poiId === submission.poiId;
  }
  return stop.zoneId === submission.zoneId;
}

export function findStopByIdentity(
  stops: CompanionStop[],
  needle: Pick<CompanionStop, "poiId" | "zoneId" | "osmId" | "osmType">,
): CompanionStop | null {
  const key = stopIdentity(needle);
  return stops.find((stop) => stopIdentity(stop) === key) ?? null;
}
