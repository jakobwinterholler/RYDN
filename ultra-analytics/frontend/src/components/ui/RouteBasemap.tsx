/**
 * Compact detail / share certificate map — MapLibre + RYDN-restyled Liberty.
 * Lakes, major water, quiet roads, and place names for local recognizability.
 * North-up, non-interactive; falls back via onFail when tiles/style break.
 */

import { useEffect, useRef } from "react";
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { applyRydnBasemapTheme, RYDN_INK, RYDN_LAND } from "./routeBasemapTheme";

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

const FALLBACK_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap",
      maxzoom: 19,
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

const DOT_START = "#1db954";
const DOT_FINISH = "#e53935";
const REVEAL_MS = 420;

type IntroReveal = boolean | "hold" | "play";

interface Props {
  points: number[][];
  className?: string;
  reveal?: IntroReveal;
  onReady?: () => void;
  /** Style/tile failure — parent should render atlas SVG instead. */
  onFail?: () => void;
}

function validPts(points: number[][]): number[][] {
  return (points || []).filter(
    (p) =>
      Array.isArray(p) &&
      p.length >= 2 &&
      Number.isFinite(Number(p[0])) &&
      Number.isFinite(Number(p[1])),
  );
}

function decimate(points: number[][], max = 2200): number[][] {
  if (points.length <= max) return points;
  const step = points.length / max;
  const out: number[][] = [];
  for (let i = 0; i < points.length; i += step) {
    out.push(points[Math.min(points.length - 1, Math.floor(i))]);
  }
  const last = points[points.length - 1];
  const tail = out[out.length - 1];
  if (!tail || tail[0] !== last[0] || tail[1] !== last[1]) out.push(last);
  return out;
}

function routeGeoJSON(points: number[][]): GeoJSON.FeatureCollection {
  const pts = decimate(validPts(points));
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: pts.map((p) => [p[1], p[0]]),
        },
      },
    ],
  };
}

function endsGeoJSON(points: number[][]): GeoJSON.FeatureCollection {
  const pts = validPts(points);
  if (pts.length < 2) return { type: "FeatureCollection", features: [] };
  const start = pts[0];
  const end = pts[pts.length - 1];
  const dx = start[0] - end[0];
  const dy = start[1] - end[1];
  // ~80 m — loop terminus (same point); paint splits green/red via translate.
  const loop = dx * dx + dy * dy < 0.0007 * 0.0007;
  if (loop) {
    const midLon = (start[1] + end[1]) / 2;
    const midLat = (start[0] + end[0]) / 2;
    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { role: "start" },
          geometry: { type: "Point", coordinates: [midLon, midLat] },
        },
        {
          type: "Feature",
          properties: { role: "finish" },
          geometry: { type: "Point", coordinates: [midLon, midLat] },
        },
      ],
    };
  }
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { role: "start" },
        geometry: { type: "Point", coordinates: [start[1], start[0]] },
      },
      {
        type: "Feature",
        properties: { role: "finish" },
        geometry: { type: "Point", coordinates: [end[1], end[0]] },
      },
    ],
  };
}

function ensureRouteLayers(map: MapLibreMap): void {
  if (!map.getSource("rydn-route")) {
    map.addSource("rydn-route", { type: "geojson", data: routeGeoJSON([]) });
    map.addLayer({
      id: "rydn-route-casing",
      type: "line",
      source: "rydn-route",
      paint: {
        "line-color": RYDN_LAND,
        "line-width": 6.5,
        "line-opacity": 0.92,
      },
      layout: { "line-cap": "round", "line-join": "round" },
    });
    map.addLayer({
      id: "rydn-route-line",
      type: "line",
      source: "rydn-route",
      paint: {
        "line-color": RYDN_INK,
        "line-width": 2.6,
        "line-opacity": 0.94,
      },
      layout: { "line-cap": "round", "line-join": "round" },
    });
  }
  if (!map.getSource("rydn-ends")) {
    map.addSource("rydn-ends", { type: "geojson", data: endsGeoJSON([]) });
    // Soft halo
    map.addLayer({
      id: "rydn-ends-halo",
      type: "circle",
      source: "rydn-ends",
      paint: {
        "circle-radius": 12,
        "circle-color": ["match", ["get", "role"], "start", DOT_START, DOT_FINISH],
        "circle-opacity": 0.22,
      },
    });
    map.addLayer({
      id: "rydn-ends-ring",
      type: "circle",
      source: "rydn-ends",
      paint: {
        "circle-radius": 7.4,
        "circle-color": "#ffffff",
        "circle-stroke-color": "rgba(26, 26, 24, 0.22)",
        "circle-stroke-width": 0.85,
      },
    });
    // Pixel translate: loops read as half-green / half-red; open rides barely nudge.
    map.addLayer({
      id: "rydn-ends-core-start",
      type: "circle",
      source: "rydn-ends",
      filter: ["==", ["get", "role"], "start"],
      paint: {
        "circle-radius": 5.5,
        "circle-color": DOT_START,
        "circle-translate": [-2.4, 0],
      },
    });
    map.addLayer({
      id: "rydn-ends-core-finish",
      type: "circle",
      source: "rydn-ends",
      filter: ["==", ["get", "role"], "finish"],
      paint: {
        "circle-radius": 5.5,
        "circle-color": DOT_FINISH,
        "circle-translate": [2.4, 0],
      },
    });
  }
}

function setRouteData(map: MapLibreMap, points: number[][]): void {
  const route = map.getSource("rydn-route") as GeoJSONSource | undefined;
  const ends = map.getSource("rydn-ends") as GeoJSONSource | undefined;
  route?.setData(routeGeoJSON(points));
  ends?.setData(endsGeoJSON(points));
}

function fitRoute(map: MapLibreMap, points: number[][]): void {
  const pts = validPts(points);
  if (pts.length < 2) return;
  const bounds = new maplibregl.LngLatBounds([pts[0][1], pts[0][0]], [pts[0][1], pts[0][0]]);
  for (const p of pts) bounds.extend([p[1], p[0]]);
  // ~TARGET_FILL 0.76 → generous padding so the plate breathes like the atlas.
  map.fitBounds(bounds, {
    padding: { top: 36, bottom: 36, left: 40, right: 40 },
    maxZoom: 12.5,
    duration: 0,
    bearing: 0,
    pitch: 0,
  });
}

function setOverlayOpacity(map: MapLibreMap, opacity: number): void {
  const lineOp = Math.max(0, Math.min(1, opacity)) * 0.94;
  const casingOp = Math.max(0, Math.min(1, opacity)) * 0.92;
  const endOp = Math.max(0, Math.min(1, opacity));
  try {
    if (map.getLayer("rydn-route-line")) map.setPaintProperty("rydn-route-line", "line-opacity", lineOp);
    if (map.getLayer("rydn-route-casing"))
      map.setPaintProperty("rydn-route-casing", "line-opacity", casingOp);
    if (map.getLayer("rydn-ends-halo"))
      map.setPaintProperty("rydn-ends-halo", "circle-opacity", endOp * 0.22);
    if (map.getLayer("rydn-ends-ring"))
      map.setPaintProperty("rydn-ends-ring", "circle-opacity", endOp);
    if (map.getLayer("rydn-ends-core-start"))
      map.setPaintProperty("rydn-ends-core-start", "circle-opacity", endOp);
    if (map.getLayer("rydn-ends-core-finish"))
      map.setPaintProperty("rydn-ends-core-finish", "circle-opacity", endOp);
  } catch {
    /* ignore */
  }
}

export default function RouteBasemap({
  points,
  className = "",
  reveal = false,
  onReady,
  onFail,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const readyRef = useRef(false);
  const failRef = useRef(false);
  const pointsRef = useRef(points);
  const revealRef = useRef(reveal);
  const onReadyRef = useRef(onReady);
  const onFailRef = useRef(onFail);

  pointsRef.current = points;
  revealRef.current = reveal;
  onReadyRef.current = onReady;
  onFailRef.current = onFail;

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    let cancelled = false;
    let usedFallback = false;
    let settleTimer: number | null = null;

    const fail = () => {
      if (cancelled || failRef.current) return;
      failRef.current = true;
      onFailRef.current?.();
    };

    const map = new maplibregl.Map({
      container: el,
      style: STYLE_URL,
      center: [11.5, 48.1],
      zoom: 8,
      attributionControl: { compact: true },
      interactive: false,
      dragPan: false,
      scrollZoom: false,
      boxZoom: false,
      doubleClickZoom: false,
      keyboard: false,
      touchZoomRotate: false,
      touchPitch: false,
      fadeDuration: 120,
      maxPitch: 0,
      pitchWithRotate: false,
    });
    mapRef.current = map;

    const markReady = () => {
      if (cancelled || readyRef.current || failRef.current) return;
      readyRef.current = true;
      onReadyRef.current?.();
    };

    const settle = () => {
      if (cancelled) return;
      ensureRouteLayers(map);
      setRouteData(map, pointsRef.current);
      fitRoute(map, pointsRef.current);
      const hold = revealRef.current === "hold";
      setOverlayOpacity(map, hold ? 0 : 1);
      // Wait for tiles after fit — share screenshots need a finished plate.
      map.once("idle", () => {
        if (cancelled) return;
        markReady();
      });
      // Safety if idle never fires (cached tiles / stalled network).
      if (settleTimer != null) window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(markReady, 2200);
    };

    const onStyle = () => {
      if (cancelled) return;
      if (!usedFallback) {
        try {
          applyRydnBasemapTheme(map);
        } catch {
          /* theme best-effort */
        }
      }
      settle();
    };

    const applyFallback = (reason: string) => {
      if (cancelled || usedFallback) return;
      usedFallback = true;
      console.warn(`[RouteBasemap] style fallback (${reason})`);
      try {
        map.setStyle(FALLBACK_STYLE);
      } catch {
        fail();
      }
    };

    map.on("style.load", onStyle);
    map.on("error", (e) => {
      const msg = String((e as { error?: { message?: string } }).error?.message || e);
      // Tile 404s are common at edges — only fail hard on style load.
      if (/style|Failed to fetch|CORS|network/i.test(msg) && !map.isStyleLoaded()) {
        applyFallback(msg.slice(0, 80));
      }
    });

    // If Liberty never loads, fall back then atlas.
    const bootTimer = window.setTimeout(() => {
      if (cancelled || readyRef.current) return;
      if (!map.isStyleLoaded()) applyFallback("style timeout");
    }, 5000);
    const hardFailTimer = window.setTimeout(() => {
      if (cancelled || readyRef.current) fail();
    }, 9000);

    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            if (cancelled || !mapRef.current) return;
            map.resize();
          })
        : null;
    ro?.observe(el);
    requestAnimationFrame(() => {
      if (!cancelled) map.resize();
    });

    return () => {
      cancelled = true;
      window.clearTimeout(bootTimer);
      window.clearTimeout(hardFailTimer);
      if (settleTimer != null) window.clearTimeout(settleTimer);
      ro?.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // Mount once — points/reveal updated in separate effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    ensureRouteLayers(map);
    setRouteData(map, points);
    fitRoute(map, points);
  }, [points]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const hold = reveal === "hold";
    const play = reveal === "play" || reveal === true;
    if (hold) {
      setOverlayOpacity(map, 0);
      return;
    }
    if (play) {
      setOverlayOpacity(map, 0);
      // Double-rAF so paint sees the zero opacity before the transition.
      const raf = requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          try {
            map.setPaintProperty("rydn-route-line", "line-opacity-transition", {
              duration: REVEAL_MS,
              delay: 0,
            });
            map.setPaintProperty("rydn-route-casing", "line-opacity-transition", {
              duration: REVEAL_MS,
              delay: 0,
            });
            for (const id of [
              "rydn-ends-core-start",
              "rydn-ends-core-finish",
              "rydn-ends-ring",
              "rydn-ends-halo",
            ]) {
              if (!map.getLayer(id)) continue;
              map.setPaintProperty(id, "circle-opacity-transition", {
                duration: Math.round(REVEAL_MS * 0.7),
                delay: Math.round(REVEAL_MS * 0.35),
              });
            }
          } catch {
            /* ignore */
          }
          setOverlayOpacity(map, 1);
        });
      });
      return () => cancelAnimationFrame(raf);
    }
    setOverlayOpacity(map, 1);
  }, [reveal]);

  return (
    <div
      className={`route-preview route-preview--basemap ${className}`.trim()}
      aria-label="Route preview"
    >
      <div ref={hostRef} className="route-preview__basemap" />
    </div>
  );
}
