/** Planning map layers + Quick Action filters.
 *
 * Interaction model (not GIS dump):
 * - Default calm map: route + verified + major warnings (remote) + selected.
 * - Quick Actions: show ONLY that category; emphasize nearest 5; cap the rest.
 *
 * Primary Quick Actions (planning speed):
 * Water · Markets · 24h (fuel shops) · Sleep
 * Verified is a badge on category icons — not a toolbar button.
 */

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

/** Primary Quick Actions — tap only, no hidden gestures. */
export type QuickActionId = "water" | "food" | "h24" | "sleep";

export type PlanMarkerKind = "climb" | "poi" | "sleep" | "remote" | "stage" | "decision" | "area";

/** Permanent verified layer vs temporary search workspace. */
export type PlanMarkerLayer = "temp" | "verified" | "system";

export interface PlanMarker {
  id: string;
  lat: number;
  lon: number;
  kind: PlanMarkerKind;
  /** temp = search results (replaced each search); verified = permanent; system = climbs/remote/… */
  layer?: PlanMarkerLayer;
  group?: string;
  category?: string;
  status?: string;
  is24h?: boolean;
  hasShop?: boolean;
  name?: string | null;
  qualityStars?: number;
  distanceOffRouteM?: number;
  /** 1 = nearest-N highlight under active Quick Action */
  emphasize?: boolean;
  /** Dim non-nearest extras while QA is active */
  dimmed?: boolean;
}

/** How many nearest POIs get full emphasis under a Quick Action. */
export const QA_NEAREST_N = 6;

/** Soft cap for non-emphasized extras while a Quick Action is on (≈10 total). */
export const QA_EXTRA_CAP = 4;

/** Show service POIs within this corridor of the route (sleep may be farther). */
export const CORRIDOR_MAX_M = 500;

/**
 * Calm default — answer nothing until asked.
 * Visible: verified stops, remote/critical warnings. Service layers off.
 */
export const DEFAULT_LAYERS: Record<PlanLayerId, boolean> = {
  water: false,
  food: false,
  fuel: false,
  h24: false,
  bike: false,
  sleep: false,
  pharmacy: false,
  verified: true,
  rejected: false,
  climbs: false,
  remote: true,
  stages: false,
};

/** Ride Mode: same calm baseline — essentials appear via Quick Actions. */
export const RIDE_LAYERS: Record<PlanLayerId, boolean> = {
  ...DEFAULT_LAYERS,
  remote: false,
  climbs: false,
  stages: false,
};

export const QUICK_ACTIONS: {
  id: QuickActionId;
  label: string;
  layer: PlanLayerId;
  emoji: string;
}[] = [
  { id: "water", label: "Water", layer: "water", emoji: "💧" },
  { id: "food", label: "Markets", layer: "food", emoji: "🛒" },
  { id: "h24", label: "24h", layer: "h24", emoji: "🌙" },
  { id: "sleep", label: "Sleep", layer: "sleep", emoji: "🛏" },
];

/** Layers panel — verified is a badge on icons, not a toolbar category. */
export const LAYER_TOGGLES: { id: PlanLayerId; label: string }[] = [
  { id: "water", label: "Water" },
  { id: "food", label: "Markets" },
  { id: "h24", label: "24h shops" },
  { id: "sleep", label: "Sleep" },
  { id: "rejected", label: "Rejected" },
  { id: "climbs", label: "Climbs" },
  { id: "remote", label: "Remote" },
  { id: "stages", label: "Stages" },
];

function isFuelShop(m: PlanMarker): boolean {
  const cat = (m.category || "").toLowerCase();
  if (cat.includes("24h shop") || cat.includes("fuel shop")) return true;
  if (!(cat.includes("gas") || cat.includes("fuel"))) return false;
  if (m.hasShop === true) return true;
  if (m.hasShop === false) return false;
  // Legacy markers: 24h fuel usually means a shop, not a bare pump
  return !!m.is24h;
}

export function stopMatchesLayer(m: PlanMarker, layer: PlanLayerId): boolean {
  const cat = (m.category || "").toLowerCase();
  const group = (m.group || "").toLowerCase();
  switch (layer) {
    case "water":
      return group === "water" || cat.includes("water") || cat.includes("drinking");
    case "food":
      return (
        (group === "resupply" ||
          ["supermarket", "convenience", "bakery", "market"].some((x) => cat.includes(x))) &&
        !isFuelShop(m)
      );
    case "fuel":
    case "h24":
      // 24h fuel stations with shops — not bare pumps
      if (isFuelShop(m)) return layer === "fuel" ? true : !!m.is24h || cat.includes("24h");
      if (cat.includes("convenience") && m.is24h) return true;
      return false;
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

/**
 * Independent layer visibility, with Quick Action exclusivity.
 * When `qa` is set: hide unrelated service POIs; only that category (+ selected).
 */
function withinCorridor(m: PlanMarker): boolean {
  if (m.distanceOffRouteM == null) return true;
  if (m.kind === "sleep" || m.group === "sleep") return m.distanceOffRouteM <= 1500;
  return m.distanceOffRouteM <= CORRIDOR_MAX_M;
}

export function markerVisible(
  m: PlanMarker,
  layers: Record<PlanLayerId, boolean>,
  qa: QuickActionId | null,
  selectedId?: string | null,
): boolean {
  if (selectedId && m.id === selectedId) return true;

  if (m.status === "rejected" && !layers.rejected) return false;

  // Warnings / structure — never flooded by QA unless they match
  if (m.kind === "decision") {
    if (qa) return false;
    return true;
  }
  if (m.kind === "climb") {
    if (qa) return false;
    return layers.climbs;
  }
  if (m.kind === "remote") {
    if (qa) return false;
    return layers.remote;
  }
  if (m.kind === "stage") {
    if (qa) return false;
    return layers.stages;
  }

  // Service POIs: ~500 m corridor (sleep slightly farther)
  if (!withinCorridor(m)) return false;

  // Temporary search finds: only while a matching Quick Action is on
  if (m.layer === "temp" || m.kind === "area") {
    if (!qa) return false;
    return stopMatchesLayer(m, qa) && (layers.rejected || m.status !== "rejected");
  }

  // Quick Action: exclusive category filter — map answers only that question
  if (qa) {
    return stopMatchesLayer(m, qa) && (layers.rejected || m.status !== "rejected");
  }

  // Calm default: verified service stops only (+ sleep only if layer on)
  if (m.kind === "sleep" || m.group === "sleep") {
    if (m.status === "verified" && layers.verified) return true;
    return layers.sleep;
  }

  const isVerified = m.status === "verified" || m.layer === "verified";
  if (isVerified && layers.verified) return true;

  // Explicit layer toggles (Layers panel) can still surface unverified services
  const serviceLayers: PlanLayerId[] = ["water", "food", "fuel", "h24", "sleep"];
  return serviceLayers.some((id) => layers[id] && stopMatchesLayer(m, id));
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
  const list = nearestN(markers, lat, lon, pred, 1);
  if (!list.length) return null;
  return { marker: list[0], km: haversineKm(lat, lon, list[0].lat, list[0].lon) };
}

/** Nearest N markers matching `pred`, sorted ascending by distance. */
export function nearestN(
  markers: PlanMarker[],
  lat: number,
  lon: number,
  pred: (m: PlanMarker) => boolean,
  n = QA_NEAREST_N,
): PlanMarker[] {
  return markers
    .filter(pred)
    .map((m) => ({ m, km: haversineKm(lat, lon, m.lat, m.lon) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, Math.max(0, n))
    .map((x) => x.m);
}

/**
 * Apply Quick Action emphasis: nearest N highlighted, extras capped + dimmed.
 * Without QA, returns markers unchanged (calm set already filtered by markerVisible).
 */
export function applyQuickActionEmphasis(
  markers: PlanMarker[],
  qa: QuickActionId | null,
  ref: { lat: number; lon: number } | null,
  selectedId?: string | null,
): PlanMarker[] {
  if (!qa || !ref) {
    return markers.map((m) => ({ ...m, emphasize: false, dimmed: false }));
  }

  const pred = (m: PlanMarker) => stopMatchesLayer(m, qa);

  const ranked = markers
    .filter(pred)
    .map((m) => ({ m, km: haversineKm(ref.lat, ref.lon, m.lat, m.lon) }))
    .sort((a, b) => a.km - b.km);

  const nearestIds = new Set(ranked.slice(0, QA_NEAREST_N).map((x) => x.m.id));
  const kept = ranked.slice(0, QA_NEAREST_N + QA_EXTRA_CAP).map((x) => x.m);

  // Always keep selection even if outside cap
  const selected = selectedId ? markers.find((m) => m.id === selectedId) : null;
  if (selected && !kept.some((m) => m.id === selected.id)) kept.push(selected);

  return kept.map((m) => ({
    ...m,
    emphasize: nearestIds.has(m.id) || m.id === selectedId,
    dimmed: !nearestIds.has(m.id) && m.id !== selectedId,
  }));
}

/** Best recommendations for the visible bbox — quality over quantity. */
export function searchLimitForBbox(bbox: {
  south: number;
  west: number;
  north: number;
  east: number;
}): number {
  return searchLimitForQa(null, bbox);
}

/**
 * Caps by viewport span — 3–15 high-quality results.
 */
export function searchLimitForQa(
  qa: QuickActionId | null,
  bbox: { south: number; west: number; north: number; east: number },
): number {
  const span = Math.max(bbox.north - bbox.south, Math.abs(bbox.east - bbox.west));
  if (qa === "h24") {
    if (span > 1.2) return 5;
    if (span > 0.55) return 10;
    if (span > 0.22) return 12;
    return 15;
  }
  if (span > 1.2) return 3;
  if (span > 0.55) return 6;
  if (span > 0.22) return 10;
  return 15;
}

/** Interpolate a lat/lon along route points by distance fraction (ride progress). */
export function pointAlongRoute(
  points: number[][],
  distanceKm: number,
  totalKm: number,
): { lat: number; lon: number } | null {
  const pts = (points || []).filter(
    (p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]),
  );
  if (pts.length < 1) return null;
  if (pts.length === 1 || !totalKm || totalKm <= 0) {
    return { lat: pts[0][0], lon: pts[0][1] };
  }
  const t = Math.max(0, Math.min(1, distanceKm / totalKm));
  const target = t * (pts.length - 1);
  const i = Math.floor(target);
  const f = target - i;
  const a = pts[Math.min(i, pts.length - 1)];
  const b = pts[Math.min(i + 1, pts.length - 1)];
  return {
    lat: a[0] + (b[0] - a[0]) * f,
    lon: a[1] + (b[1] - a[1]) * f,
  };
}
