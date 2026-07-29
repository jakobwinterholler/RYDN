/** Planning map layers + Quick Action filters. */

export type PlanLayerId =
  | "water"
  | "food"
  | "fuel"
  | "h24"
  | "bike"
  | "sleep"
  | "pharmacy"
  | "verified"
  | "rejected"
  | "climbs"
  | "remote"
  | "stages";

export type QuickActionId =
  | "water"
  | "food"
  | "fuel"
  | "h24"
  | "bike"
  | "sleep"
  | "pharmacy"
  | "verified";

export type PlanMarkerKind = "climb" | "poi" | "sleep" | "remote" | "stage" | "decision" | "area";

export interface PlanMarker {
  id: string;
  lat: number;
  lon: number;
  kind: PlanMarkerKind;
  group?: string;
  category?: string;
  status?: string;
  is24h?: boolean;
  name?: string | null;
  qualityStars?: number;
  distanceOffRouteM?: number;
}

export const DEFAULT_LAYERS: Record<PlanLayerId, boolean> = {
  water: true,
  food: true,
  fuel: true,
  h24: false,
  bike: true,
  sleep: false,
  pharmacy: false,
  verified: true,
  rejected: false,
  climbs: true,
  remote: true,
  stages: true,
};

/** Ride Mode: verified + essentials only. */
export const RIDE_LAYERS: Record<PlanLayerId, boolean> = {
  water: true,
  food: true,
  fuel: true,
  h24: true,
  bike: true,
  sleep: true,
  pharmacy: true,
  verified: true,
  rejected: false,
  climbs: false,
  remote: false,
  stages: false,
};

export const QUICK_ACTIONS: {
  id: QuickActionId;
  label: string;
  layer: PlanLayerId;
}[] = [
  { id: "water", label: "Water", layer: "water" },
  { id: "food", label: "Food", layer: "food" },
  { id: "fuel", label: "Fuel", layer: "fuel" },
  { id: "h24", label: "24h", layer: "h24" },
  { id: "bike", label: "Bike", layer: "bike" },
  { id: "sleep", label: "Sleep", layer: "sleep" },
  { id: "pharmacy", label: "Pharmacy", layer: "pharmacy" },
  { id: "verified", label: "Verified", layer: "verified" },
];

export const LAYER_TOGGLES: { id: PlanLayerId; label: string }[] = [
  { id: "water", label: "Water" },
  { id: "food", label: "Food / markets" },
  { id: "fuel", label: "Fuel" },
  { id: "h24", label: "24h" },
  { id: "bike", label: "Bike shops" },
  { id: "pharmacy", label: "Pharmacy" },
  { id: "sleep", label: "Sleep" },
  { id: "verified", label: "Verified" },
  { id: "rejected", label: "Rejected" },
  { id: "climbs", label: "Climbs" },
  { id: "remote", label: "Remote" },
  { id: "stages", label: "Stages" },
];

export function stopMatchesLayer(m: PlanMarker, layer: PlanLayerId): boolean {
  const cat = (m.category || "").toLowerCase();
  const group = (m.group || "").toLowerCase();
  switch (layer) {
    case "water":
      return group === "water" || cat.includes("water") || cat.includes("drinking");
    case "food":
      return (
        group === "resupply" ||
        group === "dining" ||
        ["supermarket", "convenience", "bakery", "café", "cafe", "restaurant", "fast food"].some(
          (x) => cat.includes(x),
        )
      );
    case "fuel":
      return cat.includes("gas") || cat.includes("fuel");
    case "h24":
      return !!m.is24h;
    case "bike":
      return group === "service" && cat.includes("bike");
    case "pharmacy":
      return cat.includes("pharmacy");
    case "sleep":
      return m.kind === "sleep" || group === "sleep";
    case "verified":
      return m.status === "verified";
    case "rejected":
      return m.status === "rejected";
    case "climbs":
      return m.kind === "climb" || m.kind === "decision";
    case "remote":
      return m.kind === "remote";
    case "stages":
      return m.kind === "stage";
    default:
      return false;
  }
}

/** Independent layer visibility, with optional Quick Action emphasis. */
export function markerVisible(
  m: PlanMarker,
  layers: Record<PlanLayerId, boolean>,
  qa: QuickActionId | null,
): boolean {
  if (m.status === "rejected" && !layers.rejected) return false;

  if (m.kind === "climb" || m.kind === "decision") return layers.climbs;
  if (m.kind === "remote") return layers.remote;
  if (m.kind === "stage") return layers.stages;
  if (m.kind === "sleep" || m.group === "sleep") {
    if (!layers.sleep && qa !== "sleep") return false;
    if (qa === "sleep") return true;
    return layers.sleep;
  }

  // POI / area stops — match at least one active service layer
  const serviceLayers: PlanLayerId[] = ["water", "food", "fuel", "h24", "bike", "pharmacy", "sleep"];
  const matchesService = serviceLayers.some((id) => layers[id] && stopMatchesLayer(m, id));
  const isVerified = m.status === "verified";

  if (qa === "verified") return isVerified;
  if (qa) {
    return stopMatchesLayer(m, qa) && (layers.rejected || m.status !== "rejected");
  }

  if (isVerified && layers.verified) return true;
  return matchesService;
}

export function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

export function nearestOf(
  markers: PlanMarker[],
  lat: number,
  lon: number,
  pred: (m: PlanMarker) => boolean,
): { marker: PlanMarker; km: number } | null {
  let best: { marker: PlanMarker; km: number } | null = null;
  for (const m of markers) {
    if (!pred(m)) continue;
    const km = haversineKm(lat, lon, m.lat, m.lon);
    if (!best || km < best.km) best = { marker: m, km };
  }
  return best;
}
