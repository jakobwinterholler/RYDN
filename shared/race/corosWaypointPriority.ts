export type WaypointExportPriority = "critical" | "recommended" | "optional";

export const WAYPOINT_EXPORT_PRIORITIES: WaypointExportPriority[] = [
  "critical",
  "recommended",
  "optional",
];

export interface WaypointPriorityInput {
  resupplyReason?: string | null;
  hasFuel?: boolean;
  hasWater?: boolean;
  hasFood?: boolean;
  confidenceScore?: number | null;
  verificationStatus: string;
}

const CRITICAL_REASON_MARKERS = [
  "last",
  "no water for",
  "no fuel",
  "before summit",
  "before climb",
  "only stop",
  "refill at km",
] as const;

export function assignWaypointPriority(input: WaypointPriorityInput): WaypointExportPriority {
  const reason = (input.resupplyReason ?? "").toLowerCase();

  if (CRITICAL_REASON_MARKERS.some((marker) => reason.includes(marker))) {
    return "critical";
  }

  if (input.verificationStatus !== "verified") {
    return "optional";
  }

  const score = input.confidenceScore ?? 0;
  if (score >= 50 || input.hasFuel || input.hasWater) {
    return "recommended";
  }
  if (score >= 35 || input.hasFood) {
    return "recommended";
  }

  return "optional";
}

export function shouldExportPriority(
  priority: WaypointExportPriority,
  includeOptional: boolean,
): boolean {
  if (includeOptional) {
    return true;
  }
  return priority === "critical" || priority === "recommended";
}
