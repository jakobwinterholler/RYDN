/** Pure helpers for RoutePage — no React; keep class names/copy identical. */

import type {
  RecommendedStop,
  RouteAnalysis,
  RoutePreparation,
} from "../../types";
import type { QuickActionId } from "./planLayers";

export function mapViewportPoi(p: {
  id: string;
  osmId: number;
  osmType: string;
  name: string | null;
  category: string;
  group: string;
  lat: number;
  lon: number;
  distanceAlongKm: number;
  distanceOffRouteM: number;
  openingHours?: string | null;
  website?: string | null;
  phone?: string | null;
  is24h?: boolean;
  hasShop?: boolean;
  hotelStars?: number | null;
  googleMapsUrl?: string | null;
  qualityStars?: number;
  qualityLabel?: string;
  qualityScore?: number;
  resupplyScore?: number;
  storeSize?: string;
  services?: string[];
}): RecommendedStop {
  return {
    id: p.id,
    osmId: p.osmId,
    osmType: p.osmType,
    name: p.name,
    category: p.category,
    group: p.group,
    lat: p.lat,
    lon: p.lon,
    distanceAlongKm: p.distanceAlongKm,
    distanceOffRouteM: p.distanceOffRouteM,
    openingHours: p.openingHours,
    website: p.website,
    phone: p.phone,
    is24h: p.is24h,
    hasShop: p.hasShop,
    hotelStars: p.hotelStars ?? null,
    qualityStars: p.qualityStars ?? 3,
    qualityLabel: p.qualityLabel || "Area find",
    qualityScore: p.qualityScore,
    resupplyScore: p.resupplyScore,
    storeSize: p.storeSize,
    services: p.services,
    reviewStatus: "unreviewed",
    googleMapsUrl: p.googleMapsUrl,
  };
}

/** Subtle OSM hotel star line for Plan sheet meta — omit when unknown. */
export function fmtHotelStars(stars: number | null | undefined): string | null {
  if (stars == null || !Number.isFinite(stars)) return null;
  const n = Math.round(stars);
  if (n < 1 || n > 5) return null;
  return `${"★".repeat(n)}${"☆".repeat(5 - n)}`;
}

export function telHref(phone: string): string {
  const cleaned = phone.trim().replace(/[^\d+]/g, "");
  return cleaned ? `tel:${cleaned}` : `tel:${phone.trim()}`;
}

export function externalHref(url: string): string {
  const t = url.trim();
  if (!t) return t;
  if (/^https?:\/\//i.test(t)) return t;
  return `https://${t}`;
}

export function mapsLinks(lat: number, lon: number, name?: string | null) {
  const q = encodeURIComponent(name || `${lat},${lon}`);
  return {
    google: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=bicycling`,
    apple: `https://maps.apple.com/?daddr=${lat},${lon}&dirflg=c`,
    place: `https://www.google.com/maps/search/?api=1&query=${q}`,
    streetView: `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lon}`,
  };
}

export type ReviewStatus = "verified" | "rejected" | "skipped";
export type ReviewMotion = {
  stopId: string;
  status: ReviewStatus;
  phase: "confirming" | "exiting" | "done";
};
export type BriefingTab = "critical" | "stops" | "climbs" | "stages" | "verify" | "prep";

export const REVIEW_FEEDBACK_MS = 220;
export const REVIEW_EXIT_MS = 260;

export const REVIEW_LABELS: Record<
  ReviewStatus,
  { idle: string; pending: string; done: string }
> = {
  verified: { idle: "Verify", pending: "Verifying…", done: "✓ Verified" },
  rejected: { idle: "Reject", pending: "Rejecting…", done: "Rejected" },
  skipped: { idle: "Save for later", pending: "Saving…", done: "Saved" },
};

export function applyStopReview(
  analysis: RouteAnalysis,
  stopId: string,
  status: ReviewStatus | "unreviewed",
): RouteAnalysis {
  const stops = (analysis.recommendedStops || []).map((s) =>
    s.id === stopId ? { ...s, reviewStatus: status } : s,
  );
  const verified = stops.filter((s) => s.reviewStatus === "verified").length;
  const nextReviews = { ...(analysis.stopReviews || {}) };
  if (status === "unreviewed") delete nextReviews[stopId];
  else nextReviews[stopId] = status;
  return {
    ...analysis,
    recommendedStops: stops,
    stopReviews: nextReviews,
    summary: {
      ...analysis.summary,
      verifiedStopCount: verified,
      recommendedStopCount: stops.filter((s) => s.reviewStatus !== "rejected").length,
    },
  };
}

export const CHECKS: {
  key: keyof Omit<RoutePreparation, "notes">;
  label: string;
  doneHint: (a: RouteAnalysis | null) => string;
}[] = [
  {
    key: "routeUnderstood",
    label: "Route understood",
    doneHint: (a) =>
      a
        ? `${Math.round(a.summary.distanceKm)} km · ${a.summary.elevationGainM.toLocaleString("en-US")} m`
        : "Confirm the course shape and totals",
  },
  {
    key: "stopsVerified",
    label: "Stops reviewed",
    doneHint: (a) =>
      a
        ? `${a.summary.recommendedStopCount ?? 0} recommended · ${a.summary.verifiedStopCount ?? 0} verified`
        : "Review recommended stops",
  },
  {
    key: "keyClimbsReviewed",
    label: "Climbs reviewed",
    doneHint: (a) => (a ? `${a.summary.climbCount} climbs detected` : "Review major climbs"),
  },
  {
    key: "stagesPlanned",
    label: "Stages reviewed",
    doneHint: (a) => (a ? `${a.summary.stageCount} suggested days` : "Review stage breaks"),
  },
];

export function recommendWhy(stop: RecommendedStop): string {
  const parts: string[] = [];
  if (stop.qualityStars >= 5) parts.push("Top reliability for multi-day resupply");
  else if (stop.qualityStars >= 4) parts.push("Strong reliability on this stretch");
  else parts.push(`${stop.qualityLabel} option where coverage is thin`);
  if (stop.is24h) parts.push("open around the clock");
  if (stop.distanceOffRouteM <= 80) parts.push("essentially on the course");
  else if (stop.distanceOffRouteM <= 250) parts.push("short detour off the line");
  if (stop.group === "water") parts.push("water coverage for the next gap");
  else if (stop.group === "sleep") parts.push("sleep option near a stage break");
  else if (stop.category === "24h Shop" || stop.category === "Fuel shop" || stop.category === "Gas station")
    parts.push("fuel, water, and late hours in one stop");
  else if (stop.category === "Supermarket") parts.push("full resupply without hunting side streets");
  return `${parts.join(" · ")}.`;
}

export function qaToOverpassGroup(qa: QuickActionId | null): string {
  if (!qa) return "all";
  if (qa === "water") return "water";
  if (qa === "food") return "resupply";
  if (qa === "sleep") return "sleep";
  return "all";
}

export function searchStatusForQa(qa: QuickActionId | null, step: number): string {
  const finding =
    qa === "water"
      ? "Finding water…"
      : qa === "food"
        ? "Finding shops…"
        : qa === "sleep"
          ? "Finding sleep…"
          : "Finding stops…";
  const steps = ["Searching visible area…", finding, "Ranking best stops…"];
  return steps[Math.min(step, steps.length - 1)] || steps[0];
}

