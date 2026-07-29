/** Interactive planning map — MapLibre + OpenFreeMap Liberty (keyless vector). */

import { useEffect, useRef } from "react";
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap, type MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { PlanMarker } from "./planLayers";

/** OpenFreeMap Liberty — roads, paths, water, forests, places. No API key. */
export const PLAN_MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
export const PLAN_MAP_STYLE_NOTE =
  "MapLibre GL + OpenFreeMap Liberty (vector OSM, keyless). Fallback: OSM raster.";

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

export interface PlanMapBBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

interface Props {
  points: number[][];
  markers: PlanMarker[];
  selectedId?: string | null;
  className?: string;
  /** Re-fit camera when this changes (e.g. route id). */
  fitKey?: string;
  onSelectMarker?: (id: string) => void;
  /** Map center — used for nearest panel. Debounced by parent via this callback. */
  onViewChange?: (center: { lat: number; lon: number }, bbox: PlanMapBBox, userMoved: boolean) => void;
  onLongPress?: (lat: number, lon: number) => void;
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

/** Keep MapLibre snappy on long ultras. */
function decimate(points: number[][], max = 1800): number[][] {
  if (points.length <= max) return points;
  const step = Math.ceil(points.length / max);
  const out: number[][] = [];
  for (let i = 0; i < points.length; i += step) out.push(points[i]);
  const last = points[points.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

function markersToGeoJSON(markers: PlanMarker[], selectedId: string | null | undefined) {
  return {
    type: "FeatureCollection" as const,
    features: markers.slice(0, 500).map((m) => ({
      type: "Feature" as const,
      properties: {
        id: m.id,
        kind: m.kind,
        status: m.status || "unreviewed",
        group: m.group || "",
        category: m.category || "",
        selected: m.id === selectedId ? 1 : 0,
        verified: m.status === "verified" ? 1 : 0,
      },
      geometry: {
        type: "Point" as const,
        coordinates: [m.lon, m.lat],
      },
    })),
  };
}

function routeToGeoJSON(points: number[][]) {
  const coords = decimate(validPts(points)).map((p) => [p[1], p[0]]);
  return {
    type: "FeatureCollection" as const,
    features:
      coords.length >= 2
        ? [
            {
              type: "Feature" as const,
              properties: {},
              geometry: { type: "LineString" as const, coordinates: coords },
            },
          ]
        : [],
  };
}

function endsToGeoJSON(points: number[][]) {
  const pts = validPts(points);
  if (pts.length < 2) {
    return { type: "FeatureCollection" as const, features: [] };
  }
  const start = pts[0];
  const end = pts[pts.length - 1];
  return {
    type: "FeatureCollection" as const,
    features: [
      {
        type: "Feature" as const,
        properties: { role: "start" },
        geometry: { type: "Point" as const, coordinates: [start[1], start[0]] },
      },
      {
        type: "Feature" as const,
        properties: { role: "end" },
        geometry: { type: "Point" as const, coordinates: [end[1], end[0]] },
      },
    ],
  };
}

function fitRoute(map: MapLibreMap, points: number[][]) {
  const pts = validPts(points);
  if (pts.length < 2) return;
  const bounds = new maplibregl.LngLatBounds([pts[0][1], pts[0][0]], [pts[0][1], pts[0][0]]);
  for (const p of pts) bounds.extend([p[1], p[0]]);
  map.fitBounds(bounds, { padding: 56, maxZoom: 12, duration: 0 });
}

function ensureLayers(map: MapLibreMap) {
  if (!map.getSource("route")) {
    map.addSource("route", { type: "geojson", data: routeToGeoJSON([]) });
    map.addLayer({
      id: "route-casing",
      type: "line",
      source: "route",
      paint: {
        "line-color": "#f7f6f3",
        "line-width": 7,
        "line-opacity": 0.95,
      },
      layout: { "line-cap": "round", "line-join": "round" },
    });
    map.addLayer({
      id: "route-line",
      type: "line",
      source: "route",
      paint: {
        "line-color": "#1a1a18",
        "line-width": 3.2,
        "line-opacity": 0.92,
      },
      layout: { "line-cap": "round", "line-join": "round" },
    });
  }

  if (!map.getSource("ends")) {
    map.addSource("ends", { type: "geojson", data: endsToGeoJSON([]) });
    map.addLayer({
      id: "ends-circle",
      type: "circle",
      source: "ends",
      paint: {
        "circle-radius": 6,
        "circle-color": [
          "match",
          ["get", "role"],
          "start",
          "#1a1a18",
          "#f7f6f3",
        ],
        "circle-stroke-color": "#1a1a18",
        "circle-stroke-width": 2,
      },
    });
  }

  if (!map.getSource("stops")) {
    map.addSource("stops", {
      type: "geojson",
      data: markersToGeoJSON([], null),
      cluster: true,
      clusterMaxZoom: 12,
      clusterRadius: 42,
    });

    map.addLayer({
      id: "stops-clusters",
      type: "circle",
      source: "stops",
      filter: ["has", "point_count"],
      paint: {
        "circle-color": "#1a1a18",
        "circle-radius": ["step", ["get", "point_count"], 14, 8, 17, 25, 20],
        "circle-opacity": 0.82,
        "circle-stroke-width": 2,
        "circle-stroke-color": "#f7f6f3",
      },
    });
    // Cluster count as circle size only — avoids glyph/font mismatches across styles.

    map.addLayer({
      id: "stops-points",
      type: "circle",
      source: "stops",
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-radius": [
          "case",
          ["==", ["get", "selected"], 1],
          9,
          ["==", ["get", "verified"], 1],
          7,
          5.5,
        ],
        "circle-color": [
          "case",
          ["==", ["get", "verified"], 1],
          "#2f5d50",
          ["==", ["get", "status"], "rejected"],
          "#9a3412",
          ["==", ["get", "kind"], "remote"],
          "#9a3412",
          ["==", ["get", "kind"], "climb"],
          "#2f5d50",
          ["==", ["get", "kind"], "decision"],
          "#2f5d50",
          ["==", ["get", "kind"], "sleep"],
          "#5b4a3a",
          ["==", ["get", "kind"], "stage"],
          "#1a1a18",
          ["==", ["get", "group"], "water"],
          "#3b6ea5",
          "#6b7280",
        ],
        "circle-opacity": [
          "case",
          ["==", ["get", "status"], "rejected"],
          0.35,
          0.92,
        ],
        "circle-stroke-width": ["case", ["==", ["get", "selected"], 1], 2.5, 1],
        "circle-stroke-color": ["case", ["==", ["get", "selected"], 1], "#1a1a18", "#f7f6f3"],
      },
    });
  }
}

export default function PlanMap({
  points,
  markers,
  selectedId,
  className = "",
  fitKey,
  onSelectMarker,
  onViewChange,
  onLongPress,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const userMovedRef = useRef(false);
  const longPressRef = useRef<{ x: number; y: number; timer: number } | null>(null);
  const onSelectRef = useRef(onSelectMarker);
  const onViewRef = useRef(onViewChange);
  const onLongRef = useRef(onLongPress);

  useEffect(() => {
    onSelectRef.current = onSelectMarker;
  }, [onSelectMarker]);
  useEffect(() => {
    onViewRef.current = onViewChange;
  }, [onViewChange]);
  useEffect(() => {
    onLongRef.current = onLongPress;
  }, [onLongPress]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;
    const el = containerRef.current;

    let usedFallback = false;

    const map = new maplibregl.Map({
      container: el,
      style: PLAN_MAP_STYLE,
      center: [10, 48],
      zoom: 5,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
      fadeDuration: 0,
      maxPitch: 0,
    });
    mapRef.current = map;

    const applyFallback = (reason: string) => {
      if (cancelled || usedFallback) return;
      usedFallback = true;
      console.warn(`[PlanMap] basemap fallback (${reason})`);
      try {
        map.setStyle(FALLBACK_STYLE);
      } catch {
        /* ignore */
      }
    };

    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }),
      "top-right",
    );

    // Ensure canvas matches flex stage size (0×0 at first paint → blank white).
    requestAnimationFrame(() => {
      if (!cancelled) map.resize();
    });
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            if (!cancelled && mapRef.current) map.resize();
          })
        : null;
    ro?.observe(el);

    const emitView = () => {
      const c = map.getCenter();
      const b = map.getBounds();
      onViewRef.current?.(
        { lat: c.lat, lon: c.lng },
        {
          south: b.getSouth(),
          west: b.getWest(),
          north: b.getNorth(),
          east: b.getEast(),
        },
        userMovedRef.current,
      );
    };

    const onMoveEnd = () => emitView();
    const onDragStart = () => {
      userMovedRef.current = true;
    };
    const onZoomStart = () => {
      userMovedRef.current = true;
    };

    map.on("dragstart", onDragStart);
    map.on("zoomstart", onZoomStart);
    map.on("moveend", onMoveEnd);

    const onClick = (e: MapMouseEvent) => {
      const feats = map.queryRenderedFeatures(e.point, {
        layers: ["stops-points", "stops-clusters"],
      });
      if (!feats.length) {
        onSelectRef.current?.("");
        return;
      }
      const f = feats[0];
      if (f.properties?.cluster) {
        const source = map.getSource("stops") as GeoJSONSource;
        const clusterId = f.properties.cluster_id as number;
        source.getClusterExpansionZoom(clusterId).then((zoom) => {
          const geom = f.geometry as { type: string; coordinates: number[] };
          const coords = geom.coordinates as [number, number];
          map.easeTo({ center: coords, zoom });
        });
        return;
      }
      const id = String(f.properties?.id || "");
      if (id) onSelectRef.current?.(id);
    };
    map.on("click", onClick);

    map.on("mouseenter", "stops-points", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "stops-points", () => {
      map.getCanvas().style.cursor = "";
    });
    map.on("mouseenter", "stops-clusters", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "stops-clusters", () => {
      map.getCanvas().style.cursor = "";
    });

    const clearLong = () => {
      if (longPressRef.current) {
        window.clearTimeout(longPressRef.current.timer);
        longPressRef.current = null;
      }
    };
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      clearLong();
      longPressRef.current = {
        x: t.clientX,
        y: t.clientY,
        timer: window.setTimeout(() => {
          const rect = el.getBoundingClientRect();
          const point = new maplibregl.Point(t.clientX - rect.left, t.clientY - rect.top);
          const ll = map.unproject(point);
          onLongRef.current?.(ll.lat, ll.lng);
          longPressRef.current = null;
        }, 520),
      };
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!longPressRef.current || e.touches.length !== 1) return;
      const t = e.touches[0];
      if (
        Math.abs(t.clientX - longPressRef.current.x) > 12 ||
        Math.abs(t.clientY - longPressRef.current.y) > 12
      ) {
        clearLong();
      }
    };
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("touchend", clearLong);
    el.addEventListener("touchcancel", clearLong);

    const onStyle = () => {
      if (cancelled) return;
      try {
        map.resize();
        ensureLayers(map);
        const routeSrc = map.getSource("route") as GeoJSONSource | undefined;
        routeSrc?.setData(routeToGeoJSON(points));
        const endsSrc = map.getSource("ends") as GeoJSONSource | undefined;
        endsSrc?.setData(endsToGeoJSON(points));
        const stopsSrc = map.getSource("stops") as GeoJSONSource | undefined;
        stopsSrc?.setData(markersToGeoJSON(markers, selectedId));
        fitRoute(map, points);
        userMovedRef.current = false;
        emitView();
      } catch {
        /* style race */
      }
    };

    map.on("load", onStyle);
    map.on("style.load", onStyle);

    map.on("error", (e) => {
      if (cancelled || usedFallback) return;
      const msg = String((e as { error?: { message?: string } })?.error?.message || "");
      // Abandon primary style only before it loads (CSP/network). Ignore later tile misses.
      if (!map.isStyleLoaded()) applyFallback(msg || "map error");
    });

    const fallbackTimer = window.setTimeout(() => {
      if (cancelled || usedFallback) return;
      if (!map.isStyleLoaded()) applyFallback("style load timeout");
    }, 4500);

    return () => {
      cancelled = true;
      window.clearTimeout(fallbackTimer);
      ro?.disconnect();
      clearLong();
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", clearLong);
      el.removeEventListener("touchcancel", clearLong);
      map.remove();
      mapRef.current = null;
    };
    // Mount once — data synced in separate effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    try {
      ensureLayers(map);
      (map.getSource("route") as GeoJSONSource | undefined)?.setData(routeToGeoJSON(points));
      (map.getSource("ends") as GeoJSONSource | undefined)?.setData(endsToGeoJSON(points));
    } catch {
      /* ignore */
    }
  }, [points]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    try {
      ensureLayers(map);
      (map.getSource("stops") as GeoJSONSource | undefined)?.setData(
        markersToGeoJSON(markers, selectedId),
      );
    } catch {
      /* ignore */
    }
  }, [markers, selectedId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fitKey) return;
    const run = () => {
      fitRoute(map, points);
      userMovedRef.current = false;
    };
    if (map.isStyleLoaded()) run();
    else map.once("load", run);
  }, [fitKey, points]);

  return (
    <div
      ref={containerRef}
      className={`plan-map ${className}`.trim()}
      role="application"
      aria-label="Route planning map"
    />
  );
}
