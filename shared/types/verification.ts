/** Companion-submitted stop verification awaiting desktop review. */

export interface CompanionVerificationServices {
  hasWater?: boolean;
  hasFood?: boolean;
  hasFuel?: boolean;
  hasCoffee?: boolean;
  hasToilet?: boolean;
  cardPayment?: boolean;
  indoorSeating?: boolean;
  bikeVisible?: boolean;
}

export interface CompanionVerificationUpdates {
  status: "verified" | "rejected";
  services?: CompanionVerificationServices;
  openingHours?: string | null;
  openingHoursCorrect?: boolean;
  permanentlyClosed?: boolean;
  temporarilyClosed?: boolean;
  category?: string;
  notes?: string | null;
  rejectReason?: string;
}

export interface CompanionVerificationSubmission {
  id: string;
  raceId: string;
  zoneId: number;
  /** Permanent POI identity when available. */
  poiId?: string;
  stopName: string;
  submittedAt: string;
  source: "companion";
  reviewStatus: "pending" | "accepted" | "rejected";
  reviewedAt?: string;
  reviewAction?: "accept" | "reject";
  lat?: number;
  lon?: number;
  updates: CompanionVerificationUpdates;
}

export function isCompanionVerificationSubmission(
  value: unknown,
): value is CompanionVerificationSubmission {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as CompanionVerificationSubmission;
  return (
    typeof record.id === "string" &&
    typeof record.raceId === "string" &&
    typeof record.zoneId === "number" &&
    typeof record.submittedAt === "string" &&
    !!record.updates &&
    typeof record.updates.status === "string"
  );
}
