/** Custom POIs — rider-placed stops on the planning map. */

import type { RecommendedStop } from "../../types";
import type { PlanIconId } from "./icons/types";
import { haversineKm } from "./planLayers";

/** Curated set — race + resupply essentials (keep small). */
export type CustomPoiKind = "checkpoint" | "water" | "shop" | "cafe" | "hotel";

export interface CustomPoiKindMeta {
  kind: CustomPoiKind;
  label: string;
  category: string;
  group: string;
  icon: PlanIconId;
}

export const CUSTOM_POI_KINDS: CustomPoiKindMeta[] = [
  { kind: "checkpoint", label: "Checkpoint", category: "Checkpoint", group: "checkpoint", icon: "stage" },
  { kind: "water", label: "Water", category: "Water", group: "water", icon: "waterFountain" },
  { kind: "shop", label: "Shop", category: "Shop", group: "resupply", icon: "supermarket" },
  { kind: "cafe", label: "Cafe", category: "Cafe", group: "dining", icon: "cafe" },
  { kind: "hotel", label: "Hotel", category: "Hotel", group: "sleep", icon: "sleepSpot" },
];

const KIND_BY_ID = new Map(CUSTOM_POI_KINDS.map((k) => [k.kind, k]));

export function customPoiMeta(kind: CustomPoiKind): CustomPoiKindMeta {
  return KIND_BY_ID.get(kind) || CUSTOM_POI_KINDS[0];
}

export function isCustomStopId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith("custom-");
}

export function isCustomStop(stop: { id?: string; osmType?: string | null } | null | undefined): boolean {
  if (!stop) return false;
  if (isCustomStopId(stop.id)) return true;
  return (stop.osmType || "").toLowerCase() === "custom";
}

export function kindFromStop(stop: {
  category?: string | null;
  group?: string | null;
}): CustomPoiKind {
  const cat = (stop.category || "").toLowerCase();
  const group = (stop.group || "").toLowerCase();
  if (group === "checkpoint" || cat.includes("checkpoint")) return "checkpoint";
  if (group === "water" || cat === "water" || cat.includes("drinking")) return "water";
  if (group === "dining" || cat.includes("cafe") || cat.includes("café")) return "cafe";
  if (group === "sleep" || cat.includes("hotel") || cat.includes("hostel")) return "hotel";
  if (group === "resupply" || cat.includes("shop") || cat.includes("supermarket")) return "shop";
  return "checkpoint";
}

export function newCustomStopId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `custom-${crypto.randomUUID()}`;
  }
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Project a lat/lon onto the course polyline → along-km + off-route metres. */
export function projectOntoRoute(
  points: number[][],
  lat: number,
  lon: number,
): { distanceAlongKm: number; distanceOffRouteM: number } {
  const pts = (points || []).filter(
    (p) =>
      Array.isArray(p) &&
      p.length >= 2 &&
      Number.isFinite(Number(p[0])) &&
      Number.isFinite(Number(p[1])),
  );
  if (pts.length < 1) {
    return { distanceAlongKm: 0, distanceOffRouteM: 0 };
  }

  let bestD = Infinity;
  let bestAlong = 0;
  let along = 0;

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const dKm = haversineKm(lat, lon, Number(p[0]), Number(p[1]));
    if (dKm < bestD) {
      bestD = dKm;
      bestAlong = along;
    }
    if (i + 1 < pts.length) {
      const n = pts[i + 1];
      along += haversineKm(Number(p[0]), Number(p[1]), Number(n[0]), Number(n[1]));
    }
  }

  return {
    distanceAlongKm: Math.round(bestAlong * 100) / 100,
    distanceOffRouteM: Math.round(bestD * 1000),
  };
}

export function buildCustomStop(input: {
  id?: string;
  name: string;
  kind: CustomPoiKind;
  lat: number;
  lon: number;
  points: number[][];
}): RecommendedStop {
  const meta = customPoiMeta(input.kind);
  const proj = projectOntoRoute(input.points, input.lat, input.lon);
  const name = input.name.trim().slice(0, 80) || meta.label;
  return {
    id: input.id || newCustomStopId(),
    osmId: 0,
    osmType: "custom",
    name,
    category: meta.category,
    group: meta.group,
    lat: input.lat,
    lon: input.lon,
    distanceAlongKm: proj.distanceAlongKm,
    distanceOffRouteM: proj.distanceOffRouteM,
    qualityStars: 4,
    qualityLabel: "Custom",
    reviewStatus: "verified",
    services: ["custom"],
    googleMapsUrl: `https://www.google.com/maps?q=${input.lat},${input.lon}`,
  };
}

export function sanitizeCustomName(raw: string, fallback = "Custom stop"): string {
  const cleaned = raw.replace(/\s+/g, " ").trim().slice(0, 80);
  return cleaned || fallback;
}
