import type { RejectAlgorithmTarget } from "./rejectReasonPresentation";

export type StopVerificationStatus = "verified" | "rejected" | "deferred";

export type StopRejectReason =
  | "too_large"
  | "closed"
  | "too_much_detour"
  | "not_practical"
  | "no_shop"
  | "shop_uncertain"
  | "not_in_street_view"
  | "bike_not_accessible"
  | "not_trustworthy"
  | "permanently_closed"
  | "duplicate_nearby"
  | "fountain_not_found"
  | "fountain_unreliable"
  | "fountain_not_accessible"
  | "other";

export interface StopRejectOption {
  id: StopRejectReason;
  label: string;
}

/** Snapshot of POI context at verification time for later algorithm analysis. */
export interface StopRejectFeedbackContext {
  zoneId: number;
  poiCategory?: string;
  categoryKey?: string;
  distanceAlongKm?: number;
  distanceOffRouteM?: number;
  fuelShopConfidence?: string;
  poiName?: string | null;
  algorithmTargets: RejectAlgorithmTarget[];
}

export interface VerifiedStopRecord {
  status: StopVerificationStatus;
  /** Structured reason code — kept separate from free-text notes for analysis. */
  rejectReason?: StopRejectReason;
  /** Optional rider notes (e.g. when reason is "other"). */
  rejectNotes?: string;
  /** POI snapshot captured when the decision was made. */
  feedbackContext?: StopRejectFeedbackContext;
  poiKey?: string;
  updatedAt: string;
}

export function verifiedStopKey(zoneId: number, poiId?: string | null): string {
  return poiId ?? String(zoneId);
}

/** Resolve verification record using poi_id first, then legacy zone key. */
export function lookupVerifiedStopRecord(
  verifiedStops: Record<string, VerifiedStopRecord>,
  zoneId: number,
  poiId?: string | null,
): VerifiedStopRecord | undefined {
  for (const key of [poiId, String(zoneId)].filter(Boolean) as string[]) {
    const record = verifiedStops[key];
    if (record?.status) {
      return record;
    }
  }
  return undefined;
}
