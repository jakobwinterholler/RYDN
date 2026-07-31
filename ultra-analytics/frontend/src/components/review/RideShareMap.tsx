/** Calm, readable basemap for the shareable ride screen — MapLibre + OpenFreeMap Positron.
 * Ultra Overview keeps the SVG atlas (RoutePreview); this is ride-share only. */

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import RoutePreview from "../ui/RoutePreview";

/** Soft light basemap — roads + place labels without Liberty clutter. */
const SHARE_MAP_STYLE = "https://tiles.openfreemap.org/styles/positron";

type IntroReveal = boolean | "hold" | "play";

interface Props {
  points?: number[][];
  className?: string;
  reveal?: IntroReveal;
  onReady?: () => void;
}

function validPts(points: number[][] | undefined): number[][] {
  return (points || []).filter(
    (p) =>
      Array.isArray(p) &&
      p.length >= 2 &&
      Number.isFinite(Number(p[0])) &&
      Number.isFinite(Number(p[1])),
  );
}

function decimate(points: number[][], max = 800): number[][] {
  if (points.length <= max) return points;
  const step = Math.ceil(points.length / max);
  const out: number[][] = [];
  for (let i = 0; i < points.length; i += step) out.push(points[i]);
  const last = points[points.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

function routeGeoJSON(points: number[][]) {
  const coords = decimate(points).map((p) => [p[1], p[0]]);
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

function endsGeoJSON(points: number[][]) {
  if (points.length < 2) return { type: "FeatureCollection" as const, features: [] };
  const start = points[0];
  const end = points[points.length - 1];
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
  if (points.length < 2) return;
  const bounds = new maplibregl.LngLatBounds(
    [points[0][1], points[0][0]],
    [points[0][1], points[0][0]],
  );
  for (const p of points) bounds.extend([p[1], p[0]]);
  // Generous padding so roads/places around the route read at a glance.
  map.fitBounds(bounds, { padding: 64, maxZoom: 13, duration: 0 });
}

function ensureRouteLayers(map: MapLibreMap) {
  if (map.getSource("share-route")) return;
  map.addSource("share-route", { type: "geojson", data: routeGeoJSON([]) });
  map.addSource("share-ends", { type: "geojson", data: endsGeoJSON([]) });
  map.addLayer({
    id: "share-route-casing",
    type: "line",
    source: "share-route",
    paint: {
      "line-color": "#f7f6f3",
      "line-width": 6.5,
      "line-opacity": 0.92,
    },
    layout: { "line-cap": "round", "line-join": "round" },
  });
  map.addLayer({
    id: "share-route-line",
    type: "line",
    source: "share-route",
    paint: {
      "line-color": "#1a1a18",
      "line-width": 2.8,
      "line-opacity": 0.94,
    },
    layout: { "line-cap": "round", "line-join": "round" },
  });
  map.addLayer({
    id: "share-ends",
    type: "circle",
    source: "share-ends",
    paint: {
      "circle-radius": 5.5,
      "circle-color": ["match", ["get", "role"], "start", "#1a1a18", "#f7f6f3"],
      "circle-stroke-color": "#1a1a18",
      "circle-stroke-width": 1.75,
      "circle-opacity": 1,
    },
  });
}

/** Soften Positron toward RYDN paper tones; keep place labels, drop POI icons. */
function calmBasemap(map: MapLibreMap) {
  const style = map.getStyle();
  if (!style?.layers) return;
  for (const layer of style.layers) {
    const id = layer.id;
    const type = layer.type;
    try {
      if (type === "background" && map.getLayer(id)) {
        map.setPaintProperty(id, "background-color", "#e8ebe7");
      }
      if (type === "fill" && /water|ocean|lake|river/i.test(id)) {
        map.setPaintProperty(id, "fill-color", "#d5ddd8");
        map.setPaintProperty(id, "fill-opacity", 0.85);
      }
      if (type === "fill" && /park|landcover|wood|forest|grass/i.test(id)) {
        map.setPaintProperty(id, "fill-opacity", 0.45);
      }
      if (type === "line" && /road|street|path|highway|bridge|tunnel/i.test(id)) {
        const op = map.getPaintProperty(id, "line-opacity");
        if (typeof op === "number") {
          map.setPaintProperty(id, "line-opacity", Math.min(0.72, op));
        } else if (op == null) {
          map.setPaintProperty(id, "line-opacity", 0.72);
        }
      }
      if (type === "symbol" && /place|label|name|city|town|village|suburb/i.test(id)) {
        map.setPaintProperty(id, "text-opacity", 0.78);
        map.setPaintProperty(id, "text-halo-color", "#f4f1ea");
        map.setPaintProperty(id, "text-halo-width", 1.2);
      }
      if (type === "symbol" && /poi|shop|amenity|transit|airport/i.test(id)) {
        map.setLayoutProperty(id, "visibility", "none");
      }
    } catch {
      /* layer paint keys vary by style version */
    }
  }
}

function setRouteVisible(map: MapLibreMap, visible: boolean) {
  const op = visible ? 1 : 0;
  try {
    if (map.getLayer("share-route-casing")) {
      map.setPaintProperty("share-route-casing", "line-opacity", op * 0.92);
    }
    if (map.getLayer("share-route-line")) {
      map.setPaintProperty("share-route-line", "line-opacity", op * 0.94);
    }
    if (map.getLayer("share-ends")) {
      map.setPaintProperty("share-ends", "circle-opacity", op);
    }
  } catch {
    /* ignore */
  }
}

export default function RideShareMap({ points, className = "", reveal, onReady }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const onReadyRef = useRef(onReady);
  const readyFired = useRef(false);
  const [failed, setFailed] = useState(false);

  const pts = useMemo(() => validPts(points), [points]);
  const canMap = pts.length >= 2 && !failed;

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  // Sync intro reveal: hold hides ink until play.
  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    setRouteVisible(map, reveal !== "hold");
  }, [reveal]);

  useEffect(() => {
    if (!canMap || !containerRef.current || mapRef.current) return;

    let cancelled = false;
    const el = containerRef.current;
    let map: MapLibreMap;

    try {
      map = new maplibregl.Map({
        container: el,
        style: SHARE_MAP_STYLE,
        center: [pts[0][1], pts[0][0]],
        zoom: 10,
        attributionControl: { compact: true },
        interactive: false,
        dragRotate: false,
        pitchWithRotate: false,
        fadeDuration: 0,
        maxPitch: 0,
      });
    } catch {
      setFailed(true);
      return;
    }

    mapRef.current = map;

    const finishReady = () => {
      if (cancelled || readyFired.current) return;
      readyFired.current = true;
      onReadyRef.current?.();
    };

    const onLoad = () => {
      if (cancelled) return;
      try {
        calmBasemap(map);
        ensureRouteLayers(map);
        (map.getSource("share-route") as GeoJSONSource)?.setData(routeGeoJSON(pts));
        (map.getSource("share-ends") as GeoJSONSource)?.setData(endsGeoJSON(pts));
        fitRoute(map, pts);
        setRouteVisible(map, reveal !== "hold");
        requestAnimationFrame(() => {
          if (cancelled) return;
          map.resize();
          fitRoute(map, pts);
          finishReady();
        });
      } catch {
        if (!cancelled) setFailed(true);
      }
    };

    map.once("load", onLoad);
    map.once("error", () => {
      if (!cancelled && !map.isStyleLoaded()) setFailed(true);
    });

    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            if (!cancelled && mapRef.current) map.resize();
          })
        : null;
    ro?.observe(el);

    return () => {
      cancelled = true;
      ro?.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // Intentionally mount once when map is viable; geometry updates via separate effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canMap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded() || pts.length < 2) return;
    try {
      (map.getSource("share-route") as GeoJSONSource)?.setData(routeGeoJSON(pts));
      (map.getSource("share-ends") as GeoJSONSource)?.setData(endsGeoJSON(pts));
      fitRoute(map, pts);
    } catch {
      /* style race */
    }
  }, [pts]);

  if (!canMap) {
    return (
      <RoutePreview className={className} points={points} reveal={reveal} onReady={onReady} />
    );
  }

  return (
    <div className={`ride-share-map ${className}`.trim()} aria-label="Route map">
      <div ref={containerRef} className="ride-share-map__canvas" />
    </div>
  );
}
