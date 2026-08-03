import type { StopVerificationStatus, VerifiedStopRecord } from "./types";
import { verifiedStopKey } from "./types";

export type DisplayVerificationStatus = StopVerificationStatus | "not_reviewed" | "skipped";

export type VerificationStatusIconSize = "sm" | "md" | "lg";

export interface VerificationStatusPresentation {
  label: string;
  shortLabel: string;
  /** Tooltip / map label prefix */
  iconGlyph: string;
  markerColor: string | null;
  iconBgClass: string;
  iconRingClass: string;
  iconContentClass: string;
  labelClass: string;
}

export const VERIFICATION_STATUS_PRESENTATION: Record<
  DisplayVerificationStatus,
  VerificationStatusPresentation
> = {
  verified: {
    label: "Verified",
    shortLabel: "Verified",
    iconGlyph: "✓",
    markerColor: "#059669",
    iconBgClass: "bg-emerald-500",
    iconRingClass: "ring-emerald-600/20",
    iconContentClass: "text-white",
    labelClass: "text-emerald-800",
  },
  rejected: {
    label: "Skipped",
    shortLabel: "Skipped",
    iconGlyph: "✕",
    markerColor: "#94A3B8",
    iconBgClass: "bg-slate-400",
    iconRingClass: "ring-slate-400/20",
    iconContentClass: "text-white",
    labelClass: "text-slate-600",
  },
  deferred: {
    label: "Skipped",
    shortLabel: "Skipped",
    iconGlyph: "✕",
    markerColor: "#94A3B8",
    iconBgClass: "bg-slate-400",
    iconRingClass: "ring-slate-400/20",
    iconContentClass: "text-white",
    labelClass: "text-slate-600",
  },
  skipped: {
    label: "Skipped",
    shortLabel: "Skipped",
    iconGlyph: "✕",
    markerColor: "#94A3B8",
    iconBgClass: "bg-slate-400",
    iconRingClass: "ring-slate-400/20",
    iconContentClass: "text-white",
    labelClass: "text-slate-600",
  },
  not_reviewed: {
    label: "Suggested",
    shortLabel: "Suggested",
    iconGlyph: "○",
    markerColor: null,
    iconBgClass: "bg-white",
    iconRingClass: "ring-accent/30",
    iconContentClass: "text-accent",
    labelClass: "text-muted",
  },
};

export const VERIFICATION_STATUS_ORDER: DisplayVerificationStatus[] = [
  "verified",
  "skipped",
  "not_reviewed",
];

export function zoneVerificationStatus(
  zoneId: number,
  verifiedStops: Record<string, VerifiedStopRecord>,
): DisplayVerificationStatus {
  const record = verifiedStops[verifiedStopKey(zoneId)];
  if (!record) {
    return "not_reviewed";
  }
  return record.status;
}

function poiVerificationKey(poi: { osm_id: number; osm_type: string }): string {
  return `${poi.osm_type}-${poi.osm_id}`;
}

/** Verification applies to the chosen POI within a hub, not every POI in the hub. */
export function poiVerificationStatus(
  zoneId: number,
  poi: { osm_id: number; osm_type: string },
  verifiedStops: Record<string, VerifiedStopRecord>,
  fallbackPoi?: { osm_id: number; osm_type: string } | null,
): DisplayVerificationStatus {
  const record = verifiedStops[verifiedStopKey(zoneId)];
  if (!record) {
    return "not_reviewed";
  }

  const key = poiVerificationKey(poi);
  if (record.poiKey) {
    return record.poiKey === key ? record.status : "not_reviewed";
  }

  if (
    fallbackPoi &&
    fallbackPoi.osm_type === poi.osm_type &&
    fallbackPoi.osm_id === poi.osm_id
  ) {
    return record.status;
  }

  return "not_reviewed";
}

export function verificationStatusPresentation(
  status: DisplayVerificationStatus,
): VerificationStatusPresentation {
  return VERIFICATION_STATUS_PRESENTATION[status];
}

export function verificationStatusTooltipLabel(status: DisplayVerificationStatus): string {
  const presentation = verificationStatusPresentation(status);
  return `${presentation.iconGlyph} ${presentation.label}`;
}
