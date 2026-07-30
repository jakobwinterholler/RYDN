/** Interactive planning map — MapLibre + OpenFreeMap Liberty (keyless vector). */

import { useEffect, useRef } from "react";
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap, type MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { ensurePlanSprites, iconForMarker, markerImageId, type ClusterTone } from "./icons";
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
  /** When set, ease camera to these marker ids (Quick Action nearest-5). */
  focusIds?: string[] | null;
  searching?: boolean;
  onSelectMarker?: (id: string) => void;
  /** Map center — used for nearest panel. Debounced by parent via this callback. */
  onViewChange?: (center: { lat: number; lon: number }, bbox: PlanMapBBox, userMoved: boolean) => void;
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

function toneForMarker(m: PlanMarker): ClusterTone {
  const cat = (m.category || "").toLowerCase();
  const group = (m.group || "").toLowerCase();
  if (m.kind === "sleep" || group === "sleep") return "sleep";
  if (group === "water" || cat.includes("water") || cat.includes("drinking") || cat.includes("fountain"))
    return "water";
  // Shops / snacks first — convenience is grocery, not a 24h fuel tone.
  if (
    group === "resupply" ||
    cat.includes("supermarket") ||
    cat.includes("market") ||
    cat.includes("convenience") ||
    cat.includes("bakery") ||
    cat.includes("grocery")
  )
    return "sage";
  if (cat.includes("24h") || cat.includes("fuel") || cat.includes("gas")) return "fuel";
  return "sage";
}

function markersToGeoJSON(
  markers: PlanMarker[],
  selectedId: string | null | undefined,
  searching: boolean,
) {
  // Cap for paint perf; prefer emphasized + verified + selected when trimming.
  // Clustering lets us keep more points without visual clutter when zoomed out.
  const sorted = [...markers].sort((a, b) => {
    const ae = a.emphasize ? 1 : 0;
    const be = b.emphasize ? 1 : 0;
    if (ae !== be) return be - ae;
    const av = a.status === "verified" ? 1 : 0;
    const bv = b.status === "verified" ? 1 : 0;
    if (av !== bv) return bv - av;
    const as = a.id === selectedId ? 1 : 0;
    const bs = b.id === selectedId ? 1 : 0;
    return bs - as;
  });
  return {
    type: "FeatureCollection" as const,
    features: sorted.slice(0, 160).map((m) => {
      const icon = iconForMarker(m);
      const verified = m.status === "verified";
      const rejected = m.status === "rejected";
      const selected = m.id === selectedId;
      const emphasize = !!m.emphasize;
      const dimmed = !!m.dimmed && !selected;
      const tone = toneForMarker(m);
      // Verified + nearest-5 sit above the rest
      const z = selected ? 5 : emphasize ? 4 : verified ? 3 : rejected ? 0 : dimmed ? 1 : 2;
      return {
        type: "Feature" as const,
        id: m.id,
        properties: {
          id: m.id,
          kind: m.kind,
          status: m.status || "unreviewed",
          group: m.group || "",
          category: m.category || "",
          icon,
          clusterTone: tone,
          // Flags for clusterProperties sums (MapLibre cluster aggregation)
          isWater: tone === "water" ? 1 : 0,
          isSage: tone === "sage" ? 1 : 0,
          isFuel: tone === "fuel" ? 1 : 0,
          isSleep: tone === "sleep" ? 1 : 0,
          selected: selected ? 1 : 0,
          verified: verified ? 1 : 0,
          rejected: rejected ? 1 : 0,
          emphasize: emphasize ? 1 : 0,
          dimmed: dimmed ? 1 : 0,
          z,
          sprite: markerImageId(icon, {
            selected,
            verified,
            rejected,
            emphasize,
            dimmed,
            loading: searching && selected,
          }),
        },
        geometry: {
          type: "Point" as const,
          coordinates: [m.lon, m.lat],
        },
      };
    }),
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
  map.fitBounds(bounds, { padding: 56, maxZoom: 12, duration: 480 });
}

/** Pick dominant category tone for a cluster from aggregated counts. */
function clusterToneExpr(): maplibregl.ExpressionSpecification {
  const maxAll: maplibregl.ExpressionSpecification = [
    "max",
    ["get", "sumWater"],
    ["max", ["get", "sumSage"], ["max", ["get", "sumFuel"], ["get", "sumSleep"]]],
  ];
  return [
    "case",
    ["all", [">", ["get", "sumWater"], 0], ["==", ["get", "sumWater"], maxAll]],
    "water",
    ["all", [">", ["get", "sumFuel"], 0], ["==", ["get", "sumFuel"], maxAll]],
    "fuel",
    ["all", [">", ["get", "sumSleep"], 0], ["==", ["get", "sumSleep"], maxAll]],
    "sleep",
    ["all", [">", ["get", "sumSage"], 0], ["==", ["get", "sumSage"], maxAll]],
    "sage",
    "mixed",
  ];
}

function clusterIconExpr(): maplibregl.ExpressionSpecification {
  const tone = clusterToneExpr();
  // Match baked sprite ids: rydn-cluster-{tone}-{2|3|…|9|10+|25+}
  return [
    "concat",
    "rydn-cluster-",
    tone,
    "-",
    [
      "case",
      [">=", ["get", "point_count"], 25],
      "25+",
      [">=", ["get", "point_count"], 10],
      "10+",
      [">=", ["get", "point_count"], 9],
      "9",
      [">=", ["get", "point_count"], 8],
      "8",
      [">=", ["get", "point_count"], 7],
      "7",
      [">=", ["get", "point_count"], 6],
      "6",
      [">=", ["get", "point_count"], 5],
      "5",
      [">=", ["get", "point_count"], 4],
      "4",
      [">=", ["get", "point_count"], 3],
      "3",
      "2",
    ],
  ];
}

function ensureLayers(map: MapLibreMap) {
  ensurePlanSprites(map);

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
        "circle-color": ["match", ["get", "role"], "start", "#1a1a18", "#f7f6f3"],
        "circle-stroke-color": "#1a1a18",
        "circle-stroke-width": 2,
      },
    });
  }

  if (!map.getSource("stops")) {
    map.addSource("stops", {
      type: "geojson",
      data: markersToGeoJSON([], null, false),
      promoteId: "id",
      // Cluster only when zoomed way out — prefer real category icons.
      cluster: true,
      clusterRadius: 28,
      clusterMaxZoom: 10,
      clusterProperties: {
        sumWater: ["+", ["get", "isWater"]],
        sumSage: ["+", ["get", "isSage"]],
        sumFuel: ["+", ["get", "isFuel"]],
        sumSleep: ["+", ["get", "isSleep"]],
      },
    });
  }

  // Category-tinted cluster symbols with baked count badges (never grey discs)
  if (!map.getLayer("stops-clusters")) {
    map.addLayer({
      id: "stops-clusters",
      type: "symbol",
      source: "stops",
      filter: ["has", "point_count"],
      layout: {
        "icon-image": clusterIconExpr(),
        "icon-size": [
          "interpolate",
          ["linear"],
          ["get", "point_count"],
          2,
          0.78,
          10,
          0.9,
          25,
          1.05,
        ],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
      paint: {
        "icon-opacity": 0.96,
      },
    });
  }

  // Halo under selected / nearest-5 / hover (unclustered only)
  if (!map.getLayer("stops-halo")) {
    map.addLayer({
      id: "stops-halo",
      type: "circle",
      source: "stops",
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          8,
          [
            "case",
            ["boolean", ["feature-state", "hover"], false],
            14,
            ["==", ["get", "selected"], 1],
            13,
            ["==", ["get", "emphasize"], 1],
            12,
            0,
          ],
          14,
          [
            "case",
            ["boolean", ["feature-state", "hover"], false],
            22,
            ["==", ["get", "selected"], 1],
            20,
            ["==", ["get", "emphasize"], 1],
            18,
            0,
          ],
        ],
        "circle-color": "rgba(47, 93, 80, 0.16)",
        "circle-opacity": [
          "case",
          ["==", ["get", "selected"], 1],
          1,
          ["==", ["get", "emphasize"], 1],
          0.9,
          ["boolean", ["feature-state", "hover"], false],
          0.85,
          0,
        ],
        "circle-stroke-width": 0,
      },
    });
  }

  // Zoom must be the top-level input to interpolate/step — nesting zoom
  // inside `*` made MapLibre reject the layer (fallback basemap, no icons).
  // feature-state is paint-only — never use it in layout icon-size.
  const stateMul = (base: number): maplibregl.ExpressionSpecification => [
    "*",
    base,
    [
      "case",
      ["==", ["get", "selected"], 1],
      1.12,
      ["==", ["get", "emphasize"], 1],
      1.06,
      ["==", ["get", "dimmed"], 1],
      0.78,
      0.92,
    ],
  ];
  const iconSizeExpr: maplibregl.ExpressionSpecification = [
    "interpolate",
    ["linear"],
    ["zoom"],
    // Large glanceable collectibles (sprites already ~48–56px logical @ pixelRatio 2)
    7,
    stateMul(0.95),
    10,
    stateMul(1.25),
    13,
    stateMul(1.55),
    16,
    stateMul(1.85),
  ];

  // Unverified / normal markers — category SymbolLayer (not circles)
  if (!map.getLayer("stops-icons")) {
    map.addLayer({
      id: "stops-icons",
      type: "symbol",
      source: "stops",
      filter: ["all", ["!", ["has", "point_count"]], ["!=", ["get", "verified"], 1]],
      layout: {
        "icon-image": ["get", "sprite"],
        "icon-size": iconSizeExpr,
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "symbol-sort-key": ["get", "z"],
      },
      paint: {
        "icon-opacity": [
          "case",
          ["==", ["get", "rejected"], 1],
          0.5,
          ["==", ["get", "dimmed"], 1],
          0.42,
          0.98,
        ],
        "icon-opacity-transition": { duration: 280, delay: 0 },
      },
    });
  }

  // Verified markers — same category glyph + green check badge in sprite
  if (!map.getLayer("stops-verified")) {
    map.addLayer({
      id: "stops-verified",
      type: "symbol",
      source: "stops",
      filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "verified"], 1]],
      layout: {
        "icon-image": ["get", "sprite"],
        "icon-size": iconSizeExpr,
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "symbol-sort-key": ["+", ["get", "z"], 20],
      },
      paint: {
        "icon-opacity": 1,
        "icon-opacity-transition": { duration: 280, delay: 0 },
      },
    });
  }
}

const HIT_LAYERS = ["stops-icons", "stops-verified"];

export default function PlanMap({
  points,
  markers,
  selectedId,
  className = "",
  fitKey,
  focusIds,
  searching = false,
  onSelectMarker,
  onViewChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const userMovedRef = useRef(false);
  const hoveredIdRef = useRef<string | null>(null);
  const onSelectRef = useRef(onSelectMarker);
  const onViewRef = useRef(onViewChange);
  const pointsRef = useRef(points);
  const markersRef = useRef(markers);
  const selectedRef = useRef(selectedId);
  const searchingRef = useRef(searching);

  useEffect(() => {
    onSelectRef.current = onSelectMarker;
  }, [onSelectMarker]);
  useEffect(() => {
    onViewRef.current = onViewChange;
  }, [onViewChange]);
  useEffect(() => {
    pointsRef.current = points;
  }, [points]);
  useEffect(() => {
    markersRef.current = markers;
  }, [markers]);
  useEffect(() => {
    selectedRef.current = selectedId;
  }, [selectedId]);
  useEffect(() => {
    searchingRef.current = searching;
  }, [searching]);

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
      fadeDuration: 180,
      maxPitch: 0,
    });
    mapRef.current = map;
    if (typeof window !== "undefined" && import.meta.env.DEV) {
      (window as unknown as { __planMap?: MapLibreMap }).__planMap = map;
    }

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

    const clearHover = () => {
      if (hoveredIdRef.current) {
        try {
          map.setFeatureState({ source: "stops", id: hoveredIdRef.current }, { hover: false });
        } catch {
          /* ignore */
        }
        hoveredIdRef.current = null;
      }
    };

    const onClick = (e: MapMouseEvent) => {
      // Cluster tap → expand
      const clusters = map.queryRenderedFeatures(e.point, { layers: ["stops-clusters"] });
      if (clusters.length) {
        const f = clusters[0];
        const clusterId = f.properties?.cluster_id as number | undefined;
        const coords = (f.geometry as { type: string; coordinates: number[] })?.coordinates;
        const source = map.getSource("stops") as GeoJSONSource | undefined;
        if (source && clusterId != null && coords) {
          void source.getClusterExpansionZoom(clusterId).then((zoom) => {
            map.easeTo({ center: [coords[0], coords[1]], zoom, duration: 380 });
          });
        }
        return;
      }

      const feats = map.queryRenderedFeatures(e.point, { layers: HIT_LAYERS });
      if (!feats.length) {
        onSelectRef.current?.("");
        return;
      }
      const f = feats[0];
      const id = String(f.properties?.id || f.id || "");
      if (id) {
        onSelectRef.current?.(id);
        const geom = f.geometry as { type: string; coordinates: number[] };
        if (geom?.coordinates) {
          const [lon, lat] = geom.coordinates;
          const pad = map.project([lon, lat]);
          const { width, height } = map.getCanvas();
          // Keep selected marker clear of the bottom sheet / edges
          const nearEdge =
            pad.x < 48 || pad.y < 56 || pad.x > width - 48 || pad.y > height - 160;
          if (nearEdge) {
            map.easeTo({ center: [lon, lat], duration: 380, offset: [0, -56] });
          }
        }
      }
    };
    map.on("click", onClick);

    const onMove = (e: MapMouseEvent) => {
      const clusterHit = map.queryRenderedFeatures(e.point, { layers: ["stops-clusters"] });
      if (clusterHit.length) {
        clearHover();
        map.getCanvas().style.cursor = "pointer";
        return;
      }
      const feats = map.queryRenderedFeatures(e.point, {
        layers: ["stops-icons", "stops-verified"],
      });
      const id = feats[0] ? String(feats[0].properties?.id || feats[0].id || "") : null;
      if (id === hoveredIdRef.current) return;
      clearHover();
      if (id) {
        hoveredIdRef.current = id;
        try {
          map.setFeatureState({ source: "stops", id }, { hover: true });
        } catch {
          /* ignore */
        }
        map.getCanvas().style.cursor = "pointer";
      } else {
        map.getCanvas().style.cursor = "";
      }
    };
    map.on("mousemove", onMove);
    map.on("mouseleave", clearHover);

    const syncData = () => {
      if (cancelled) return;
      try {
        map.resize();
        ensureLayers(map);
        (map.getSource("route") as GeoJSONSource | undefined)?.setData(
          routeToGeoJSON(pointsRef.current),
        );
        (map.getSource("ends") as GeoJSONSource | undefined)?.setData(
          endsToGeoJSON(pointsRef.current),
        );
        (map.getSource("stops") as GeoJSONSource | undefined)?.setData(
          markersToGeoJSON(markersRef.current, selectedRef.current, searchingRef.current),
        );
      } catch {
        /* style race */
      }
    };

    const onStyle = () => {
      syncData();
      fitRoute(map, pointsRef.current);
      userMovedRef.current = false;
      emitView();
    };

    map.on("load", onStyle);
    map.on("style.load", onStyle);

    map.on("error", (e) => {
      if (cancelled || usedFallback) return;
      const msg = String((e as { error?: { message?: string } })?.error?.message || "");
      // Layer expression bugs must not nuke the vector basemap — only fall back
      // when the style itself failed to load.
      if (/stops-icons|stops-verified|icon-size|icon-image/i.test(msg)) {
        console.warn(`[PlanMap] layer error (not falling back): ${msg}`);
        return;
      }
      if (!map.isStyleLoaded()) applyFallback(msg || "map error");
    });

    const fallbackTimer = window.setTimeout(() => {
      if (cancelled || usedFallback) return;
      if (!map.isStyleLoaded()) applyFallback("style load timeout");
    }, 12000);

    return () => {
      cancelled = true;
      window.clearTimeout(fallbackTimer);
      ro?.disconnect();
      clearHover();
      map.remove();
      mapRef.current = null;
    };
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
        markersToGeoJSON(markers, selectedId, searching),
      );
    } catch {
      /* ignore */
    }
  }, [markers, selectedId, searching]);

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

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded() || !focusIds?.length) return;
    const idSet = new Set(focusIds);
    const targets = markersRef.current.filter((m) => idSet.has(m.id));
    if (targets.length < 1) return;
    // Single card/marker pick → ease + leave room for the sheet
    if (targets.length === 1) {
      map.easeTo({
        center: [targets[0].lon, targets[0].lat],
        zoom: Math.max(map.getZoom(), 14),
        duration: 420,
        offset: [0, -56],
      });
      return;
    }
    const bounds = new maplibregl.LngLatBounds(
      [targets[0].lon, targets[0].lat],
      [targets[0].lon, targets[0].lat],
    );
    for (const m of targets) bounds.extend([m.lon, m.lat]);
    map.fitBounds(bounds, {
      padding: { top: 72, bottom: 140, left: 48, right: 72 },
      maxZoom: 14,
      duration: 520,
    });
    // Only when the focus set identity changes (QA toggle / card tap)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusIds?.join(",")]);

  return (
    <div
      ref={containerRef}
      className={`plan-map ${className}`.trim()}
      role="application"
      aria-label="Route planning map"
    />
  );
}
