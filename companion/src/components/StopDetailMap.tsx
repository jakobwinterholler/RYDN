import { useEffect, useMemo, useRef, useState } from "react";
import { buildRouteTrack } from "@shared/race/mapMatching";
import {
  ALTERNATIVE_STOP_COLOR,
  DETAIL_ROUTE_WINDOW_KM,
  POI_FOCUS_ANIMATION_MS,
  POI_FOCUS_OFFSET,
  POI_FOCUS_ZOOM,
  ROUTE_CORE_COLOR,
  ROUTE_CORE_OPACITY,
  ROUTE_CORE_WIDTH,
  ROUTE_HALO_COLOR,
  ROUTE_HALO_OPACITY,
  ROUTE_HALO_WIDTH,
  SELECTED_STOP_CORE,
  SELECTED_STOP_HALO,
} from "@shared/race/companionMapTheme";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { CompanionBundle, CompanionStop } from "../types";

const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

interface StopDetailMapProps {
  stop: CompanionStop;
  bundle: CompanionBundle;
  alternatives?: CompanionStop[];
  riderLat?: number | null;
  riderLon?: number | null;
}

function stopFocusKey(stop: Pick<CompanionStop, "poiId" | "zoneId">): string {
  return stop.poiId ?? `zone-${stop.zoneId}`;
}

function routeSegmentGeoJson(
  coordinates: [number, number][],
  totalKm: number,
  stopKm: number,
): GeoJSON.FeatureCollection {
  const track = buildRouteTrack(coordinates, totalKm);
  const segment = track.points
    .filter((point) => Math.abs(point.km - stopKm) <= DETAIL_ROUTE_WINDOW_KM)
    .map((point) => [point.lon, point.lat] as [number, number]);

  if (segment.length < 2) {
    const anchor = track.points.find((point) => Math.abs(point.km - stopKm) <= 0.5);
    if (anchor) {
      segment.push([anchor.lon, anchor.lat], [anchor.lon + 0.0008, anchor.lat + 0.0008]);
    }
  }

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: segment,
        },
      },
    ],
  };
}

function poiGeoJson(
  stop: CompanionStop,
  alternatives: CompanionStop[],
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [
    {
      type: "Feature",
      properties: { role: "selected" },
      geometry: {
        type: "Point",
        coordinates: [stop.lon, stop.lat],
      },
    },
  ];

  for (const alt of alternatives) {
    if (!Number.isFinite(alt.lat) || !Number.isFinite(alt.lon)) {
      continue;
    }
    if (alt.poiId === stop.poiId) {
      continue;
    }
    features.push({
      type: "Feature",
      properties: { role: "alternative" },
      geometry: {
        type: "Point",
        coordinates: [alt.lon, alt.lat],
      },
    });
  }

  return { type: "FeatureCollection", features };
}

export default function StopDetailMap({
  stop,
  bundle,
  alternatives = [],
  riderLat,
  riderLon,
}: StopDetailMapProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  const lastFocusKeyRef = useRef<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const routeData = useMemo(
    () => routeSegmentGeoJson(bundle.route.coordinates, bundle.race.distanceKm, stop.km),
    [bundle.race.distanceKm, bundle.route.coordinates, stop.km],
  );
  const poiData = useMemo(() => poiGeoJson(stop, alternatives), [alternatives, stop]);
  const focusKey = stopFocusKey(stop);

  const routeDataRef = useRef(routeData);
  const poiDataRef = useRef(poiData);
  routeDataRef.current = routeData;
  poiDataRef.current = poiData;

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !Number.isFinite(stop.lat) || !Number.isFinite(stop.lon)) {
      return;
    }

    let cancelled = false;
    setLoadError(null);
    readyRef.current = false;
    lastFocusKeyRef.current = null;

    const map = new maplibregl.Map({
      container: host,
      style: MAP_STYLE,
      center: [stop.lon, stop.lat],
      zoom: POI_FOCUS_ZOOM,
      bearing: 0,
      pitch: 0,
      interactive: false,
      dragPan: false,
      scrollZoom: false,
      boxZoom: false,
      dragRotate: false,
      keyboard: false,
      doubleClickZoom: false,
      touchZoomRotate: false,
      touchPitch: false,
      fadeDuration: 0,
      refreshExpiredTiles: false,
      attributionControl: false,
    });
    mapRef.current = map;

    const fail = (message: string) => {
      if (cancelled) {
        return;
      }
      setLoadError(message);
    };

    map.on("error", (event) => {
      fail(event.error?.message ?? "Street map failed to load.");
    });

    const setup = () => {
      if (cancelled || map.getSource("detail-route")) {
        return;
      }

      try {
        map.addSource("detail-route", {
          type: "geojson",
          data: routeDataRef.current,
        });

        map.addLayer({
          id: "detail-route-halo",
          type: "line",
          source: "detail-route",
          paint: {
            "line-color": ROUTE_HALO_COLOR,
            "line-width": ROUTE_HALO_WIDTH,
            "line-opacity": ROUTE_HALO_OPACITY,
          },
        });

        map.addLayer({
          id: "detail-route-core",
          type: "line",
          source: "detail-route",
          paint: {
            "line-color": ROUTE_CORE_COLOR,
            "line-width": ROUTE_CORE_WIDTH,
            "line-opacity": ROUTE_CORE_OPACITY,
          },
        });

        map.addSource("detail-poi", {
          type: "geojson",
          data: poiDataRef.current,
        });

        map.addLayer({
          id: "detail-alt-marker",
          type: "circle",
          source: "detail-poi",
          filter: ["==", ["get", "role"], "alternative"],
          paint: {
            "circle-radius": 6,
            "circle-color": ALTERNATIVE_STOP_COLOR,
            "circle-opacity": 0.9,
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
          },
        });

        map.addLayer({
          id: "detail-poi-halo",
          type: "circle",
          source: "detail-poi",
          filter: ["==", ["get", "role"], "selected"],
          paint: {
            "circle-radius": 18,
            "circle-color": SELECTED_STOP_HALO,
            "circle-opacity": 0.35,
          },
        });

        map.addLayer({
          id: "detail-poi-pin",
          type: "circle",
          source: "detail-poi",
          filter: ["==", ["get", "role"], "selected"],
          paint: {
            "circle-radius": 9,
            "circle-color": "#ffffff",
            "circle-stroke-width": 3,
            "circle-stroke-color": SELECTED_STOP_CORE,
          },
        });

        map.addSource("detail-rider", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: [],
          },
        });

        map.addLayer({
          id: "detail-rider",
          type: "circle",
          source: "detail-rider",
          layout: { visibility: "none" },
          paint: {
            "circle-radius": 7,
            "circle-color": "#0ea5e9",
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
          },
        });

        map.easeTo({
          center: [stop.lon, stop.lat],
          zoom: POI_FOCUS_ZOOM,
          offset: POI_FOCUS_OFFSET,
          duration: 0,
          essential: true,
        });
        lastFocusKeyRef.current = stopFocusKey(stop);
        readyRef.current = true;
        map.resize();
      } catch (error) {
        fail(error instanceof Error ? error.message : "Street map failed to set up.");
      }
    };

    if (map.loaded()) {
      setup();
    } else {
      map.once("load", setup);
    }

    const resizeObserver = new ResizeObserver(() => {
      if (!cancelled) {
        map.resize();
      }
    });
    resizeObserver.observe(host);

    return () => {
      cancelled = true;
      readyRef.current = false;
      lastFocusKeyRef.current = null;
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getSource("detail-route") || !readyRef.current) {
      return;
    }
    (map.getSource("detail-route") as maplibregl.GeoJSONSource).setData(routeData);
    (map.getSource("detail-poi") as maplibregl.GeoJSONSource).setData(poiData);
  }, [poiData, routeData]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) {
      return;
    }
    if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lon)) {
      return;
    }
    if (focusKey === lastFocusKeyRef.current) {
      return;
    }
    lastFocusKeyRef.current = focusKey;

    map.stop();
    map.easeTo({
      center: [stop.lon, stop.lat],
      zoom: POI_FOCUS_ZOOM,
      offset: POI_FOCUS_OFFSET,
      duration: POI_FOCUS_ANIMATION_MS,
      essential: true,
    });
  }, [focusKey, stop.lat, stop.lon]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getSource("detail-rider") || !readyRef.current) {
      return;
    }
    const source = map.getSource("detail-rider") as maplibregl.GeoJSONSource;
    if (riderLat == null || riderLon == null) {
      source.setData({ type: "FeatureCollection", features: [] });
      if (map.getLayer("detail-rider")) {
        map.setLayoutProperty("detail-rider", "visibility", "none");
      }
      return;
    }
    source.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "Point",
            coordinates: [riderLon, riderLat],
          },
        },
      ],
    });
    if (map.getLayer("detail-rider")) {
      map.setLayoutProperty("detail-rider", "visibility", "visible");
    }
  }, [riderLat, riderLon]);

  return (
    <div className="stop-detail-map relative h-full w-full touch-none select-none">
      <div ref={hostRef} className="pointer-events-none absolute inset-0" aria-hidden />
      {loadError ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0c1018] px-4 text-center">
          <p className="text-sm font-medium text-white/70">Street preview unavailable</p>
          <p className="mt-1 text-xs text-white/40">{loadError}</p>
        </div>
      ) : (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#0c1018]/80 to-transparent px-2 pb-1.5 pt-6 text-[10px] text-white/35">
          Route context · OpenFreeMap
        </div>
      )}
    </div>
  );
}
