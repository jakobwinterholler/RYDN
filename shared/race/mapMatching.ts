const EARTH_RADIUS_M = 6_371_000;

export interface RouteTrackPoint {
  lon: number;
  lat: number;
  km: number;
}

export interface RouteTrack {
  points: RouteTrackPoint[];
  totalKm: number;
}

export interface MapMatchResult {
  km: number;
  lat: number;
  lon: number;
  bearing: number;
  snapDistanceM: number;
  segmentIndex: number;
}

export function haversineM(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dPhi = ((lat2 - lat1) * Math.PI) / 180;
  const dLambda = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

function normalizeBearing(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

function bearingBetween(
  from: { lon: number; lat: number },
  to: { lon: number; lat: number },
): number {
  const fromLat = (from.lat * Math.PI) / 180;
  const toLat = (to.lat * Math.PI) / 180;
  const deltaLon = ((to.lon - from.lon) * Math.PI) / 180;
  const y = Math.sin(deltaLon) * Math.cos(toLat);
  const x =
    Math.cos(fromLat) * Math.sin(toLat) -
    Math.sin(fromLat) * Math.cos(toLat) * Math.cos(deltaLon);
  return normalizeBearing((Math.atan2(y, x) * 180) / Math.PI);
}

/** Build cumulative km track from [lon, lat] polyline coordinates. */
export function buildRouteTrack(
  coordinates: [number, number][],
  totalDistanceKm?: number,
): RouteTrack {
  if (coordinates.length === 0) {
    return { points: [], totalKm: 0 };
  }

  const points: RouteTrackPoint[] = coordinates.map(([lon, lat]) => ({ lon, lat, km: 0 }));

  let runningM = 0;
  for (let index = 0; index < points.length; index += 1) {
    if (index > 0) {
      const prev = coordinates[index - 1];
      const current = coordinates[index];
      runningM += haversineM(prev[1], prev[0], current[1], current[0]);
    }
    points[index].km = runningM / 1000;
  }

  const measuredKm = runningM / 1000;
  const scale =
    typeof totalDistanceKm === "number" && totalDistanceKm > 0 && measuredKm > 0
      ? totalDistanceKm / measuredKm
      : 1;

  if (scale !== 1) {
    for (const point of points) {
      point.km *= scale;
    }
  }

  const totalKm =
    typeof totalDistanceKm === "number" && totalDistanceKm > 0
      ? totalDistanceKm
      : points[points.length - 1]?.km ?? 0;

  if (points.length > 0) {
    points[points.length - 1].km = totalKm;
  }

  return { points, totalKm };
}

function projectOntoSegment(
  lat: number,
  lon: number,
  a: RouteTrackPoint,
  b: RouteTrackPoint,
): { lat: number; lon: number; t: number; distanceM: number } {
  const ax = a.lon;
  const ay = a.lat;
  const bx = b.lon;
  const by = b.lat;
  const px = lon;
  const py = lat;
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq <= 1e-12 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const projLon = ax + dx * t;
  const projLat = ay + dy * t;
  return {
    lat: projLat,
    lon: projLon,
    t,
    distanceM: haversineM(lat, lon, projLat, projLon),
  };
}

export interface MatchOptions {
  /**
   * Last known along-route km. When provided, matching prefers candidates
   * within a km-window around this value so self-intersecting routes (loops,
   * lollipops, out-and-backs) don't snap backward to a spatially-overlapping
   * segment at a different distance. Falls back to a global search when no
   * in-window candidate exists (e.g. first fix or rejoining after a shortcut).
   */
  hintKm?: number | null;
  /** How far behind the hint to allow (GPS jitter / small backtrack). Default 2 km. */
  windowBackKm?: number;
  /** How far ahead of the hint to allow (movement between fixes). Default 6 km. */
  windowAheadKm?: number;
}

/** Snap a GPS position onto the route polyline. */
export function matchPositionToRoute(
  lat: number,
  lon: number,
  track: RouteTrack,
  options?: MatchOptions,
): MapMatchResult | null {
  const { points } = track;
  if (points.length === 0) {
    return null;
  }
  if (points.length === 1) {
    const only = points[0];
    return {
      km: only.km,
      lat: only.lat,
      lon: only.lon,
      bearing: 0,
      snapDistanceM: haversineM(lat, lon, only.lat, only.lon),
      segmentIndex: 0,
    };
  }

  const hintKm = options?.hintKm ?? null;
  const backKm = options?.windowBackKm ?? 2;
  const aheadKm = options?.windowAheadKm ?? 6;
  const lowKm = hintKm === null ? -Infinity : hintKm - backKm;
  const highKm = hintKm === null ? Infinity : hintKm + aheadKm;

  let bestDistanceM = Infinity;
  let bestKm = points[0].km;
  let bestLat = points[0].lat;
  let bestLon = points[0].lon;
  let bestSegment = 0;

  let winDistanceM = Infinity;
  let winKm = points[0].km;
  let winLat = points[0].lat;
  let winLon = points[0].lon;
  let winSegment = -1;

  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    const projection = projectOntoSegment(lat, lon, a, b);
    const projKm = a.km + (b.km - a.km) * projection.t;

    if (projection.distanceM < bestDistanceM) {
      bestDistanceM = projection.distanceM;
      bestLat = projection.lat;
      bestLon = projection.lon;
      bestKm = projKm;
      bestSegment = index;
    }

    if (hintKm !== null && projKm >= lowKm && projKm <= highKm) {
      if (projection.distanceM < winDistanceM) {
        winDistanceM = projection.distanceM;
        winLat = projection.lat;
        winLon = projection.lon;
        winKm = projKm;
        winSegment = index;
      }
    }
  }

  const useWindowed = hintKm !== null && winSegment >= 0;
  const chosenDistanceM = useWindowed ? winDistanceM : bestDistanceM;
  const chosenKm = useWindowed ? winKm : bestKm;
  const chosenLat = useWindowed ? winLat : bestLat;
  const chosenLon = useWindowed ? winLon : bestLon;
  const chosenSegment = useWindowed ? winSegment : bestSegment;

  const aheadIndex = Math.min(points.length - 1, chosenSegment + 1);
  const bearing = bearingBetween(
    { lon: chosenLon, lat: chosenLat },
    { lon: points[aheadIndex].lon, lat: points[aheadIndex].lat },
  );

  return {
    km: Math.max(0, Math.min(track.totalKm, chosenKm)),
    lat: chosenLat,
    lon: chosenLon,
    bearing,
    snapDistanceM: chosenDistanceM,
    segmentIndex: chosenSegment,
  };
}

export function interpolateTrackAtKm(track: RouteTrack, km: number): RouteTrackPoint & { bearing: number } {
  const { points, totalKm } = track;
  if (points.length === 0) {
    return { lat: 0, lon: 0, km: 0, bearing: 0 };
  }
  const clamped = Math.max(0, Math.min(totalKm, km));
  if (clamped <= points[0].km) {
    const next = points[Math.min(1, points.length - 1)];
    return {
      ...points[0],
      bearing: bearingBetween(points[0], next),
    };
  }
  const last = points[points.length - 1];
  if (clamped >= last.km) {
    const prev = points[Math.max(0, points.length - 2)];
    return {
      ...last,
      bearing: bearingBetween(prev, last),
    };
  }

  let low = 0;
  let high = points.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (points[mid].km < clamped) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  const index = Math.max(1, low);
  const prev = points[index - 1];
  const next = points[index];
  const span = Math.max(0.000001, next.km - prev.km);
  const blend = (clamped - prev.km) / span;

  return {
    lat: prev.lat + (next.lat - prev.lat) * blend,
    lon: prev.lon + (next.lon - prev.lon) * blend,
    km: clamped,
    bearing: bearingBetween(prev, next),
  };
}

/** Exponential moving average smoother for lat/lon/km. */
export class PositionSmoother {
  private lat: number | null = null;
  private lon: number | null = null;
  private km: number | null = null;
  private readonly alpha: number;

  constructor(alpha = 0.35) {
    this.alpha = alpha;
  }

  reset(): void {
    this.lat = null;
    this.lon = null;
    this.km = null;
  }

  smooth(lat: number, lon: number, km: number): { lat: number; lon: number; km: number } {
    if (this.lat === null) {
      this.lat = lat;
      this.lon = lon;
      this.km = km;
      return { lat, lon, km };
    }
    const prevLat = this.lat as number;
    const prevLon = this.lon as number;
    const prevKm = this.km as number;
    this.lat = prevLat + this.alpha * (lat - prevLat);
    this.lon = prevLon + this.alpha * (lon - prevLon);
    this.km = prevKm + this.alpha * (km - prevKm);
    return { lat: this.lat, lon: this.lon, km: this.km };
  }
}

export const GPS_DEFAULTS = {
  minAccuracyM: 80,
  maxSnapDistanceM: 100,
  deadReckoningMaxSeconds: 45,
  deadReckoningMinSpeedKmh: 4,
} as const;
