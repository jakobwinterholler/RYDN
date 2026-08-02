/** Editorial atlas route plate — paper land, quieter sea, thin ink route. */

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Icon from "./Icon";
import { lodStyleFromViewSpan, type ThumbLodStyle, type ThumbLodTier } from "./routePreviewLod";

interface Props {
  points?: number[][];
  /** Chronological day polylines — drawn as separate strokes (no teleport lines). */
  segments?: number[][][];
  className?: string;
  /**
   * Ultra Overview opening: ink the route start→finish.
   * `"hold"` = pre-draw pose (no anim); `"play"` / `true` = run draw after paint.
   * Respects prefers-reduced-motion via CSS (instant final state).
   */
  reveal?: boolean | "hold" | "play";
  /** Fires once the map plate is ready (or unavailable) so parents can start intro. */
  onReady?: () => void;
  /**
   * Trips shelf thumbs: quieter plate, Apple-style start/finish dots (no planning markers).
   * LOD follows bbox span (geographic zoom), not route length km.
   */
  variant?: "detail" | "thumb";
  /** Country count hint for thumb LOD (secondary; from ultra.countryCodes). */
  countryCount?: number;
  /**
   * @deprecated Ignored — LOD uses bbox span only. Kept so callers need not change.
   */
  distanceKm?: number;
  /** Planning markers: climbs, services, remote gaps. */
  markers?: {
    id?: string;
    lat: number;
    lon: number;
    kind?: "climb" | "poi" | "sleep" | "remote" | "stage" | "decision";
    status?: "verified" | "rejected" | "skipped" | "unreviewed" | string;
  }[];
  selectedId?: string | null;
  onSelectMarker?: (id: string) => void;
}

function decimateClient(points: number[][], target: number): number[][] {
  const n = points.length;
  if (n <= target || target <= 0) return points;
  const step = n / target;
  const out: number[][] = [];
  for (let i = 0; i < n; i += step) {
    out.push(points[Math.min(n - 1, Math.floor(i))]);
  }
  const last = points[n - 1];
  if (out.length && (out[out.length - 1][0] !== last[0] || out[out.length - 1][1] !== last[1])) {
    out.push(last);
  }
  return out;
}

function spanKmApprox(points: number[][]): number {
  if (points.length < 2) return 0;
  const b = bboxOf(points);
  const midLat = (b.minLat + b.maxLat) / 2;
  const cos = Math.max(Math.cos((midLat * Math.PI) / 180), 0.3);
  const latKm = (b.maxLat - b.minLat) * 111;
  const lonKm = (b.maxLon - b.minLon) * 111 * cos;
  return Math.hypot(latKm, lonKm);
}

/** Total route stroke time (ms); segments share it sequentially. */
const REVEAL_ROUTE_MS = 420;

type CountriesFC = {
  features: { properties: { id: string }; geometry: { type: string; coordinates: unknown } }[];
};

type BBox = { minLat: number; maxLat: number; minLon: number; maxLon: number };

const W = 640;
const H = 400;
/** Small edge breathing — geographic framing carries the 70–80% fill. */
const PAD = 14;
/**
 * Thumb cards (~148–168px): pad so start/finish dots stay inside the plate
 * (overflow:hidden) while remaining readable after SVG scale-down.
 */
const PAD_THUMB = 36;
/** Route bounding box should occupy this fraction of the map viewport. */
const TARGET_FILL = 0.76;

/** Cooler sea vs warmer land — printed atlas, not a nav app. */
const SEA = "#e4e7e4";
const LAND = "#f4f1ea";
const BORDER = "#8a8378";
const ROUTE = "#1a1a18";
/** Apple Maps–style endpoint discs: saturated core + softer halo. */
const DOT_START = "#1db954";
const DOT_START_SOFT = "#34c759";
const DOT_FINISH = "#e53935";
const DOT_FINISH_SOFT = "#ff5252";
/** White ring + thin dark rim for contrast on land/sea. */
const DOT_RING = "#ffffff";
const DOT_RIM = "rgba(26, 26, 24, 0.22)";

let countriesCache: CountriesFC | null = null;
let countriesPromise: Promise<CountriesFC> | null = null;
let countriesFineCache: CountriesFC | null = null;
let countriesFinePromise: Promise<CountriesFC | null> | null = null;

function loadCountries(): Promise<CountriesFC> {
  if (countriesCache) return Promise.resolve(countriesCache);
  if (!countriesPromise) {
    countriesPromise = import("../../data/countries50m.json").then((m) => {
      countriesCache = m.default as CountriesFC;
      return countriesCache;
    });
  }
  return countriesPromise;
}

/** Higher-res atlas for short/local thumbs — denser coasts when zoomed in. */
function loadCountriesFine(): Promise<CountriesFC | null> {
  if (countriesFineCache) return Promise.resolve(countriesFineCache);
  if (!countriesFinePromise) {
    countriesFinePromise = import("../../data/countriesFine.json")
      .then((m) => {
        countriesFineCache = m.default as CountriesFC;
        return countriesFineCache;
      })
      .catch(() => {
        // Failed chunk must not leave thumbs stuck on a rejected promise.
        countriesFinePromise = null;
        return null;
      });
  }
  return countriesFinePromise;
}

function validPts(points: number[][] | undefined): number[][] {
  return (points || [])
    .filter(
      (p) =>
        Array.isArray(p) &&
        p.length >= 2 &&
        Number.isFinite(Number(p[0])) &&
        Number.isFinite(Number(p[1])),
    )
    .map((p) => [Number(p[0]), Number(p[1])]);
}

function bboxOf(points: number[][]): BBox {
  const lats = points.map((p) => p[0]);
  const lons = points.map((p) => p[1]);
  return {
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
    minLon: Math.min(...lons),
    maxLon: Math.max(...lons),
  };
}

/**
 * Frame so the route bbox fills ~TARGET_FILL of the map, with a viewport that
 * matches the SVG aspect ratio. Short and long Ultras then read at similar scale.
 */
function frameRoute(b: BBox, aspect: number, fill = TARGET_FILL): BBox {
  const midLat = (b.minLat + b.maxLat) / 2;
  const midLon = (b.minLon + b.maxLon) / 2;
  const cos = Math.max(Math.cos((midLat * Math.PI) / 180), 0.3);
  const routeLat = Math.max(b.maxLat - b.minLat, 0.02);
  const routeLon = Math.max(b.maxLon - b.minLon, 0.02);
  const routeW = routeLon * cos;
  const routeH = routeLat;

  let viewH = routeH / fill;
  let viewW = routeW / fill;
  if (viewW / viewH < aspect) viewW = viewH * aspect;
  else viewH = viewW / aspect;

  const halfLat = viewH / 2;
  const halfLon = viewW / cos / 2;
  return {
    minLat: midLat - halfLat,
    maxLat: midLat + halfLat,
    minLon: midLon - halfLon,
    maxLon: midLon + halfLon,
  };
}

function projectFactory(b: BBox, w: number, h: number, pad: number) {
  const latSpan = Math.max(b.maxLat - b.minLat, 0.0001);
  const lonSpan = Math.max(b.maxLon - b.minLon, 0.0001);
  const midLat = (b.minLat + b.maxLat) / 2;
  const cos = Math.max(Math.cos((midLat * Math.PI) / 180), 0.3);
  const lonScale = lonSpan * cos;
  const usableW = w - pad * 2;
  const usableH = h - pad * 2;
  const scale = Math.min(usableW / lonScale, usableH / latSpan);
  const drawnW = lonScale * scale;
  const drawnH = latSpan * scale;
  const ox = pad + (usableW - drawnW) / 2;
  const oy = pad + (usableH - drawnH) / 2;

  return (lat: number, lon: number) => {
    const x = ox + (lon - b.minLon) * cos * scale;
    const y = oy + (b.maxLat - lat) * scale;
    return [x, y] as const;
  };
}

/** Douglas–Peucker on projected rings — stronger on outline, none on fine. */
function simplifyRingPx(
  ring: number[][],
  project: (lat: number, lon: number) => readonly [number, number],
  tolPx: number,
): { x: number; y: number }[] {
  const pts = ring.map((c) => {
    const [x, y] = project(c[1], c[0]);
    return { x, y };
  });
  if (pts.length < 3 || tolPx <= 0) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  const tol2 = tolPx * tolPx;
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = pts[a].x;
    const ay = pts[a].y;
    const bx = pts[b].x;
    const by = pts[b].y;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    let maxD = 0;
    let maxI = a;
    for (let i = a + 1; i < b; i++) {
      const t = ((pts[i].x - ax) * dx + (pts[i].y - ay) * dy) / len2;
      const px = ax + t * dx;
      const py = ay + t * dy;
      const d = (pts[i].x - px) ** 2 + (pts[i].y - py) ** 2;
      if (d > maxD) {
        maxD = d;
        maxI = i;
      }
    }
    if (maxD > tol2) {
      keep[maxI] = 1;
      stack.push([a, maxI], [maxI, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

function ringToPath(
  ring: number[][],
  project: (lat: number, lon: number) => readonly [number, number],
  digits = 1,
  simplifyTolPx = 0,
): string {
  if (!ring.length) return "";
  const pts =
    simplifyTolPx > 0
      ? simplifyRingPx(ring, project, simplifyTolPx)
      : ring.map((c) => {
          const [x, y] = project(c[1], c[0]);
          return { x, y };
        });
  return pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(digits)} ${p.y.toFixed(digits)}`)
    .join(" ");
}

function intersects(a: BBox, b: BBox): boolean {
  return !(a.maxLon < b.minLon || a.minLon > b.maxLon || a.maxLat < b.minLat || a.minLat > b.maxLat);
}

/** Expand selection bbox so fine LOD keeps neighboring coast fragments. */
function inflateBBox(b: BBox, factor: number): BBox {
  const latPad = ((b.maxLat - b.minLat) * (factor - 1)) / 2;
  const lonPad = ((b.maxLon - b.minLon) * (factor - 1)) / 2;
  return {
    minLat: b.minLat - latPad,
    maxLat: b.maxLat + latPad,
    minLon: b.minLon - lonPad,
    maxLon: b.maxLon + lonPad,
  };
}

/** Fast bbox from a GeoJSON ring ([lon,lat]…). */
function ringBBox(ring: number[][]): BBox | null {
  if (!ring.length) return null;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const c of ring) {
    const lon = c[0];
    const lat = c[1];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }
  if (!Number.isFinite(minLat)) return null;
  return { minLat, maxLat, minLon, maxLon };
}

/**
 * Per-polygon parts that actually hit the view.
 * Critical: whole-feature bbox for RU/US/FR/NO spans the globe (overseas /
 * antimeridian), so feature-level intersects() alone pulled megabytes of SVG
 * into short-trip thumbs and left cards stuck on skeletons.
 */
function polysInView(
  geom: { type: string; coordinates: unknown },
  selectBox: BBox,
): number[][][][] {
  const out: number[][][][] = [];
  if (geom.type === "Polygon") {
    const rings = geom.coordinates as number[][][];
    const bb = ringBBox(rings[0] || []);
    if (bb && intersects(bb, selectBox)) out.push(rings);
  } else if (geom.type === "MultiPolygon") {
    for (const poly of geom.coordinates as number[][][][]) {
      const bb = ringBBox(poly[0] || []);
      if (bb && intersects(bb, selectBox)) out.push(poly);
    }
  }
  return out;
}

/** One path per polygon (exterior + holes) for evenodd fill. */
function geomToLandPaths(
  geom: { type: string; coordinates: unknown },
  project: (lat: number, lon: number) => readonly [number, number],
  digits = 1,
  simplifyTolPx = 0,
  selectBox?: BBox,
): string[] {
  const paths: string[] = [];
  const polyToPath = (rings: number[][][]) => {
    const parts = rings
      .map((ring) => {
        const d = ringToPath(ring, project, digits, simplifyTolPx);
        return d ? `${d} Z` : "";
      })
      .filter(Boolean);
    if (parts.length) paths.push(parts.join(" "));
  };
  const polys = selectBox
    ? polysInView(geom, selectBox)
    : geom.type === "Polygon"
      ? [geom.coordinates as number[][][]]
      : geom.type === "MultiPolygon"
        ? (geom.coordinates as number[][][][])
        : [];
  for (const poly of polys) polyToPath(poly);
  return paths;
}

/** Exterior rings only — cleaner borders/coastlines. */
function geomToBorderPaths(
  geom: { type: string; coordinates: unknown },
  project: (lat: number, lon: number) => readonly [number, number],
  digits = 1,
  simplifyTolPx = 0,
  selectBox?: BBox,
): string[] {
  const paths: string[] = [];
  const polys = selectBox
    ? polysInView(geom, selectBox)
    : geom.type === "Polygon"
      ? [geom.coordinates as number[][][]]
      : geom.type === "MultiPolygon"
        ? (geom.coordinates as number[][][][])
        : [];
  for (const poly of polys) {
    const d = ringToPath(poly[0] || [], project, digits, simplifyTolPx);
    if (d) paths.push(`${d} Z`);
  }
  return paths;
}

function featureBBox(geom: { type: string; coordinates: unknown }): BBox | null {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  let n = 0;
  const walk = (c: unknown) => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === "number" && typeof c[1] === "number") {
      const lon = c[0] as number;
      const lat = c[1] as number;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      n += 1;
      return;
    }
    for (const x of c) walk(x);
  };
  walk(geom.coordinates);
  if (n < 2) return null;
  return { minLat, maxLat, minLon, maxLon };
}

function pathFromLatLon(
  points: number[][],
  project: (lat: number, lon: number) => readonly [number, number],
): string {
  return points
    .map((p, i) => {
      const [x, y] = project(p[0], p[1]);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

/** Apple Maps–style disc radii in viewBox space (640×400). */
type DotGeom = { coreR: number; ringR: number; haloR: number; rimW: number };

function dotGeom(thumb: boolean): DotGeom {
  // Thumb: ~9–11px outer on a 148px card after 640→css scale — matches prior flag visibility.
  if (thumb) return { coreR: 15, ringR: 19.5, haloR: 27, rimW: 1.15 };
  return { coreR: 6.5, ringR: 8.6, haloR: 12, rimW: 0.75 };
}

/** Projected-space merge: one combined disc when start≈finish (loops). */
function endpointsOverlap(
  start: readonly [number, number],
  end: readonly [number, number],
  g: DotGeom,
): boolean {
  const dx = start[0] - end[0];
  const dy = start[1] - end[1];
  const merge = g.haloR * 1.05;
  return dx * dx + dy * dy <= merge * merge;
}

/** Soft halo → white ring → saturated core → bright center (Apple Maps location). */
function EndpointDot({
  x,
  y,
  g,
  core,
  soft,
  className,
}: {
  x: number;
  y: number;
  g: DotGeom;
  core: string;
  soft: string;
  className: string;
}) {
  return (
    <g className={className}>
      <circle cx={x} cy={y} r={g.haloR} fill={soft} opacity={0.32} />
      <circle cx={x} cy={y} r={g.ringR} fill={DOT_RING} />
      <circle
        cx={x}
        cy={y}
        r={g.ringR}
        fill="none"
        stroke={DOT_RIM}
        strokeWidth={g.rimW}
      />
      <circle cx={x} cy={y} r={g.coreR} fill={core} />
      <circle
        cx={x}
        cy={y - g.coreR * 0.18}
        r={g.coreR * 0.42}
        fill={soft}
        opacity={0.55}
      />
    </g>
  );
}

/** Loop terminus: left green / right red semicircles with shared halo + ring. */
function CombinedLoopDot({
  x,
  y,
  g,
}: {
  x: number;
  y: number;
  g: DotGeom;
}) {
  const r = g.coreR;
  const top = y - r;
  const bot = y + r;
  // Vertical split — clean semicircles readable at thumb size.
  const green = `M${x} ${top} A${r} ${r} 0 0 0 ${x} ${bot} Z`;
  const red = `M${x} ${top} A${r} ${r} 0 0 1 ${x} ${bot} Z`;
  return (
    <g className="route-preview__endpoint route-preview__endpoint--loop">
      <circle cx={x} cy={y} r={g.haloR} fill={DOT_START_SOFT} opacity={0.18} />
      <circle cx={x} cy={y} r={g.haloR} fill={DOT_FINISH_SOFT} opacity={0.18} />
      <circle cx={x} cy={y} r={g.ringR} fill={DOT_RING} />
      <circle
        cx={x}
        cy={y}
        r={g.ringR}
        fill="none"
        stroke={DOT_RIM}
        strokeWidth={g.rimW}
      />
      <path d={green} fill={DOT_START} />
      <path d={red} fill={DOT_FINISH} />
      <line
        x1={x}
        y1={top}
        x2={x}
        y2={bot}
        stroke={DOT_RING}
        strokeWidth={Math.max(0.9, g.rimW * 0.85)}
        strokeLinecap="round"
        opacity={0.9}
      />
      <circle
        cx={x}
        cy={y - r * 0.18}
        r={r * 0.38}
        fill="#ffffff"
        opacity={0.28}
      />
    </g>
  );
}

export default function RoutePreview({
  points,
  segments,
  className = "",
  reveal = false,
  onReady,
  variant = "detail",
  countryCount = 1,
  distanceKm: _distanceKm = 0,
  markers,
  selectedId,
  onSelectMarker,
}: Props) {
  void _distanceKm; // deprecated — LOD is bbox-span only
  const thumb = variant === "thumb";
  const [countries, setCountries] = useState<CountriesFC | null>(countriesCache);
  const [countriesFine, setCountriesFine] = useState<CountriesFC | null>(countriesFineCache);

  const segs = useMemo(() => {
    const fromSegs = (segments || []).map(validPts).filter((s) => s.length >= 2);
    if (fromSegs.length) return fromSegs;
    const flat = validPts(points);
    return flat.length >= 2 ? [flat] : [];
  }, [points, segments]);

  const allPtsRaw = useMemo(() => segs.flat(), [segs]);
  const viewSpanKm = useMemo(
    () => (allPtsRaw.length >= 2 ? spanKmApprox(allPtsRaw) : 0),
    [allPtsRaw],
  );

  const lodStyle = useMemo((): ThumbLodStyle | null => {
    if (!thumb || allPtsRaw.length < 2) return null;
    return lodStyleFromViewSpan(viewSpanKm, countryCount);
  }, [thumb, viewSpanKm, countryCount, allPtsRaw.length]);

  const thumbLod: ThumbLodTier | null = lodStyle?.tier ?? null;
  const localDetail = !thumb && allPtsRaw.length >= 2 && viewSpanKm < 750;
  const needsFineAtlas = Boolean(lodStyle?.useFineAtlas) || localDetail;

  useEffect(() => {
    let cancelled = false;
    void loadCountries().then((data) => {
      if (!cancelled) setCountries(data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!needsFineAtlas) return;
    let cancelled = false;
    void loadCountriesFine().then((data) => {
      if (!cancelled && data) setCountriesFine(data);
    });
    return () => {
      cancelled = true;
    };
  }, [needsFineAtlas]);

  const outlineLod = thumbLod === "outline";
  const activeAtlas =
    needsFineAtlas && countriesFine
      ? countriesFine
      : countries;

  const segsLod = useMemo(() => {
    if (!thumb || !lodStyle) return segs;
    const target = lodStyle.routePts;
    return segs.map((s) => decimateClient(s, Math.max(8, Math.floor(target / Math.max(segs.length, 1)))));
  }, [segs, thumb, lodStyle]);

  const allPts = useMemo(() => segsLod.flat(), [segsLod]);

  const plate = useMemo(() => {
    if (allPts.length < 2 || !activeAtlas) return null;
    const pad = thumb ? PAD_THUMB : PAD;
    const usableAspect = (W - pad * 2) / (H - pad * 2);
    const local = !thumb && viewSpanKm < 750;
    const fill = lodStyle ? lodStyle.fill : local ? 0.62 : TARGET_FILL;
    const digits = lodStyle?.digits ?? (local ? 2 : 1);
    const usingFine = Boolean(activeAtlas === countriesFine);
    // Fine atlas coasts are dense — keep a floor on thumb simplify so SVG stays paint-able.
    const baseSimplify = lodStyle?.simplify ?? (local ? 0 : 0.4);
    const simplify = thumb && usingFine ? Math.max(baseSimplify, 0.85) : baseSimplify;
    const routeBox = frameRoute(bboxOf(allPts), usableAspect, fill);
    const selectBox =
      (lodStyle?.useFineAtlas ?? false) || local ? inflateBBox(routeBox, 1.35) : routeBox;
    const project = projectFactory(routeBox, W, H, pad);
    const lands: string[] = [];
    const borders: string[] = [];
    for (const f of activeAtlas.features) {
      const fb = featureBBox(f.geometry);
      // Globe-spanning MultiPolygons (RU/US/…) always intersect via feature bbox —
      // still enter and let polysInView drop non-local parts.
      const globeSpanning = fb != null && (fb.maxLon - fb.minLon > 80 || fb.maxLat - fb.minLat > 50);
      if (!fb || (!intersects(fb, selectBox) && !globeSpanning)) continue;
      // Always fill land — LOD only changes stroke density / polyline decimation, never palette.
      lands.push(...geomToLandPaths(f.geometry, project, digits, simplify, selectBox));
      borders.push(...geomToBorderPaths(f.geometry, project, digits, simplify, selectBox));
    }
    const routePaths = segsLod.map((s) => pathFromLatLon(s, project));
    const start = project(segsLod[0][0][0], segsLod[0][0][1]);
    const lastSeg = segsLod[segsLod.length - 1];
    const end = project(lastSeg[lastSeg.length - 1][0], lastSeg[lastSeg.length - 1][1]);
    const dots = thumb
      ? []
      : (markers || [])
          .filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lon))
          .slice(0, 160)
          .map((m) => {
            const [x, y] = project(m.lat, m.lon);
            return {
              x,
              y,
              id: m.id,
              kind: m.kind || "poi",
              status: m.status || "unreviewed",
              selected: m.id != null && m.id === selectedId,
            };
          });
    return { lands, borders, routePaths, start, end, dots };
  }, [allPts, segsLod, activeAtlas, markers, selectedId, thumb, lodStyle, viewSpanKm]);

  const loadingMap = allPts.length >= 2 && !activeAtlas;
  const mapSettled = !loadingMap;

  useEffect(() => {
    if (!onReady || !mapSettled) return;
    onReady();
  }, [mapSettled, onReady, plate]);

  if (loadingMap) {
    return (
      <div
        className={`route-preview route-preview--empty${thumb ? " route-preview--thumb" : ""} ${className}`.trim()}
        aria-busy="true"
      >
        <div className="route-preview__placeholder">
          {thumb ? (
            <div className="skeleton skeleton--block" aria-hidden />
          ) : (
            <>
              <div className="skeleton skeleton--line" style={{ width: "40%" }} aria-hidden />
              <p className="route-preview__hint">Drawing map…</p>
            </>
          )}
        </div>
      </div>
    );
  }

  if (!plate) {
    if (thumb) {
      return (
        <div
          className={`route-preview route-preview--empty route-preview--thumb ${className}`.trim()}
          aria-hidden
        >
          <div className="route-preview__placeholder">
            <Icon name="route" size={18} />
          </div>
        </div>
      );
    }
    return (
      <div className={`route-preview route-preview--empty ${className}`.trim()} aria-label="Route preview unavailable">
        <div className="route-preview__placeholder">
          <Icon name="route" size={22} />
          <p className="route-preview__hint">Route preview unavailable</p>
          <p className="route-preview__sub">
            GPS appears here once member days have tracks. Open a day or sync Strava to add them.
          </p>
        </div>
      </div>
    );
  }

  const routeCount = Math.max(plate.routePaths.length, 1);
  const segDur = REVEAL_ROUTE_MS / routeCount;
  const revealHold = reveal === "hold";
  const revealPlay = reveal === "play" || reveal === true;

  const borderW = lodStyle ? lodStyle.borderW : 1.2;
  const routeW = lodStyle ? lodStyle.routeW : 2.15;
  const lodClass = thumbLod ? ` route-preview--${thumbLod}` : "";

  return (
    <div
      className={`route-preview${thumb ? " route-preview--thumb" : ""}${lodClass}${outlineLod ? " route-preview--outline" : ""}${revealHold ? " route-preview--reveal-hold" : ""}${revealPlay ? " route-preview--reveal" : ""}${className ? ` ${className}` : ""}`}
      aria-label={thumb ? undefined : "Route preview"}
      aria-hidden={thumb || undefined}
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="route-preview__svg" role="img">
        <rect width={W} height={H} fill={SEA} />
        {plate.lands.map((d, i) => (
          <path key={`f${i}`} d={d} fill={LAND} fillRule="evenodd" stroke="none" />
        ))}
        {plate.borders.map((d, i) => (
          <path
            key={`b${i}`}
            d={d}
            fill="none"
            stroke={BORDER}
            strokeWidth={borderW}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {plate.routePaths.map((d, i) => (
          <path
            key={`r${i}`}
            d={d}
            className="route-preview__route"
            fill="none"
            stroke={ROUTE}
            strokeWidth={routeW}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            pathLength={1}
            style={
              revealHold || revealPlay
                ? ({
                    ["--route-draw-dur"]: `${Math.max(segDur, 48)}ms`,
                    ["--route-draw-delay"]: `${i * segDur}ms`,
                  } as CSSProperties)
                : undefined
            }
          />
        ))}
        {plate.dots.map((d, i) => {
          let fill = "#6b7280";
          if (d.kind === "remote") fill = "#9a3412";
          else if (d.kind === "climb" || d.kind === "decision") fill = "#2f5d50";
          else if (d.kind === "sleep") fill = "#5b4a3a";
          else if (d.kind === "stage") fill = "#1a1a18";
          if (d.status === "verified") fill = "#2f5d50";
          if (d.status === "rejected") fill = "#9a3412";
          if (d.status === "skipped") fill = "#8a8378";
          const r = d.selected ? 5.5 : d.kind === "remote" || d.kind === "decision" ? 3.4 : 2.6;
          return (
            <circle
              key={`m${i}`}
              cx={d.x}
              cy={d.y}
              r={r}
              fill={fill}
              opacity={d.status === "rejected" ? 0.35 : 0.9}
              stroke={d.selected ? "#1a1a18" : "none"}
              strokeWidth={d.selected ? 1.5 : 0}
              style={{ cursor: d.id && onSelectMarker ? "pointer" : undefined }}
              onClick={(e) => {
                e.stopPropagation();
                if (d.id && onSelectMarker) onSelectMarker(d.id);
              }}
            />
          );
        })}
        {/* Start / finish dots — Apple Maps discs; loop → half green / half red. */}
        {(() => {
          const g = dotGeom(thumb);
          const start = plate.start;
          const end = plate.end;
          if (endpointsOverlap(start, end, g)) {
            // Midpoint so a loop mark sits on the shared terminus.
            const x = (start[0] + end[0]) / 2;
            const y = (start[1] + end[1]) / 2;
            return <CombinedLoopDot x={x} y={y} g={g} />;
          }
          return (
            <>
              <EndpointDot
                x={start[0]}
                y={start[1]}
                g={g}
                core={DOT_START}
                soft={DOT_START_SOFT}
                className="route-preview__endpoint route-preview__endpoint--start"
              />
              <EndpointDot
                x={end[0]}
                y={end[1]}
                g={g}
                core={DOT_FINISH}
                soft={DOT_FINISH_SOFT}
                className="route-preview__endpoint route-preview__endpoint--finish"
              />
            </>
          );
        })()}
      </svg>
    </div>
  );
}
