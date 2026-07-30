/** Editorial atlas route plate — paper land, quieter sea, thin ink route. */

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Icon from "./Icon";

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
/** Route bounding box should occupy this fraction of the map viewport. */
const TARGET_FILL = 0.76;

/** Cooler sea vs warmer land — printed atlas, not a nav app. */
const SEA = "#e4e7e4";
const LAND = "#f4f1ea";
const BORDER = "#8a8378";
const ROUTE = "#1a1a18";

let countriesCache: CountriesFC | null = null;
let countriesPromise: Promise<CountriesFC> | null = null;

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

function ringToPath(
  ring: number[][],
  project: (lat: number, lon: number) => readonly [number, number],
): string {
  if (!ring.length) return "";
  return ring
    .map((c, i) => {
      const [lon, lat] = c;
      const [x, y] = project(lat, lon);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

/** One path per polygon (exterior + holes) for evenodd fill. */
function geomToLandPaths(
  geom: { type: string; coordinates: unknown },
  project: (lat: number, lon: number) => readonly [number, number],
): string[] {
  const paths: string[] = [];
  const polyToPath = (rings: number[][][]) => {
    const parts = rings
      .map((ring) => {
        const d = ringToPath(ring, project);
        return d ? `${d} Z` : "";
      })
      .filter(Boolean);
    if (parts.length) paths.push(parts.join(" "));
  };
  if (geom.type === "Polygon") {
    polyToPath(geom.coordinates as number[][][]);
  } else if (geom.type === "MultiPolygon") {
    for (const poly of geom.coordinates as number[][][][]) {
      polyToPath(poly);
    }
  }
  return paths;
}

/** Exterior rings only — cleaner borders/coastlines. */
function geomToBorderPaths(
  geom: { type: string; coordinates: unknown },
  project: (lat: number, lon: number) => readonly [number, number],
): string[] {
  const paths: string[] = [];
  if (geom.type === "Polygon") {
    const rings = geom.coordinates as number[][][];
    const d = ringToPath(rings[0] || [], project);
    if (d) paths.push(`${d} Z`);
  } else if (geom.type === "MultiPolygon") {
    for (const poly of geom.coordinates as number[][][][]) {
      const d = ringToPath(poly[0] || [], project);
      if (d) paths.push(`${d} Z`);
    }
  }
  return paths;
}

function intersects(a: BBox, b: BBox): boolean {
  return !(a.maxLon < b.minLon || a.minLon > b.maxLon || a.maxLat < b.minLat || a.minLat > b.maxLat);
}

function featureBBox(geom: { type: string; coordinates: unknown }): BBox | null {
  const coords: number[][] = [];
  const walk = (c: unknown) => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === "number" && typeof c[1] === "number") {
      coords.push([c[1] as number, c[0] as number]);
      return;
    }
    for (const x of c) walk(x);
  };
  walk(geom.coordinates);
  if (coords.length < 2) return null;
  return bboxOf(coords);
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

export default function RoutePreview({
  points,
  segments,
  className = "",
  reveal = false,
  onReady,
  markers,
  selectedId,
  onSelectMarker,
}: Props) {
  const [countries, setCountries] = useState<CountriesFC | null>(countriesCache);

  useEffect(() => {
    let cancelled = false;
    void loadCountries().then((data) => {
      if (!cancelled) setCountries(data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const segs = useMemo(() => {
    const fromSegs = (segments || []).map(validPts).filter((s) => s.length >= 2);
    if (fromSegs.length) return fromSegs;
    const flat = validPts(points);
    return flat.length >= 2 ? [flat] : [];
  }, [points, segments]);

  const allPts = useMemo(() => segs.flat(), [segs]);

  const plate = useMemo(() => {
    if (allPts.length < 2 || !countries) return null;
    const usableAspect = (W - PAD * 2) / (H - PAD * 2);
    const routeBox = frameRoute(bboxOf(allPts), usableAspect);
    const project = projectFactory(routeBox, W, H, PAD);
    const lands: string[] = [];
    const borders: string[] = [];
    for (const f of countries.features) {
      const fb = featureBBox(f.geometry);
      if (!fb || !intersects(fb, routeBox)) continue;
      lands.push(...geomToLandPaths(f.geometry, project));
      borders.push(...geomToBorderPaths(f.geometry, project));
    }
    const routePaths = segs.map((s) => pathFromLatLon(s, project));
    const start = project(segs[0][0][0], segs[0][0][1]);
    const lastSeg = segs[segs.length - 1];
    const end = project(lastSeg[lastSeg.length - 1][0], lastSeg[lastSeg.length - 1][1]);
    const dots = (markers || [])
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
  }, [allPts, segs, countries, markers, selectedId]);

  const loadingMap = allPts.length >= 2 && !countries;
  const mapSettled = !loadingMap;

  useEffect(() => {
    if (!onReady || !mapSettled) return;
    onReady();
  }, [mapSettled, onReady, plate]);

  if (loadingMap) {
    return (
      <div className={`route-preview route-preview--empty ${className}`.trim()} aria-busy="true">
        <div className="route-preview__placeholder">
          <div className="skeleton skeleton--line" style={{ width: "40%" }} aria-hidden />
          <p className="route-preview__hint">Drawing map…</p>
        </div>
      </div>
    );
  }

  if (!plate) {
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

  return (
    <div
      className={`route-preview${revealHold ? " route-preview--reveal-hold" : ""}${revealPlay ? " route-preview--reveal" : ""}${className ? ` ${className}` : ""}`}
      aria-label="Route preview"
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
            strokeWidth="1.2"
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
            strokeWidth="2.15"
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
        <circle
          className="route-preview__endpoint"
          cx={plate.start[0]}
          cy={plate.start[1]}
          r="3.6"
          fill={ROUTE}
        />
        <circle
          className="route-preview__endpoint"
          cx={plate.end[0]}
          cy={plate.end[1]}
          r="3.6"
          fill="none"
          stroke={ROUTE}
          strokeWidth="1.7"
        />
      </svg>
    </div>
  );
}
