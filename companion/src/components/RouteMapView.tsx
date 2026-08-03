import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { analyzeClimbDifficulty } from "@shared/race/climbDifficulty";
import { buildRouteTrack, interpolateTrackAtKm } from "@shared/race/mapMatching";
import { collectAllBundlePois, resolveRenderedStop, type BundlePoiEntry } from "@shared/race/bundlePois";
import { isMapVisibleStopStatus } from "@shared/race/discoverVerification";
import {
  ALTERNATIVE_STOP_COLOR,
  DIMMED_STOP_COLOR,
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
  SKIPPED_STOP_COLOR,
  SUGGESTED_STOP_COLOR,
} from "@shared/race/companionMapTheme";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useCompanion } from "../context/CompanionContext";
import {
  mapBoundsFromMaplibre,
} from "../planning/discoverStopsAdapter";
import { discoverMarkerHtml } from "@shared/race/discoverMarker";
import type { DiscoverCandidate, MapBounds } from "@shared/race/discoverStops";
import { poiOsmKey } from "@shared/race/discoverStops";
import type { CompanionClimb } from "@shared/types/sync";
import type { CompanionStop, CompanionUnsupportedSection } from "../types";

const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const FOLLOW_ZOOM = 14;
const EMBEDDED_FOCUS_ZOOM = POI_FOCUS_ZOOM;
const EMBEDDED_FOCUS_OFFSET = POI_FOCUS_OFFSET;
const FOCUS_ANIMATION_MS = POI_FOCUS_ANIMATION_MS;

function stopPoiId(stop: Pick<CompanionStop, "poiId" | "zoneId">): string {
  return stop.poiId ?? `zone-${stop.zoneId}`;
}

export interface RouteMapHandle {
  recenter: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetNorth: () => void;
}

interface RouteMapViewProps {
  embedded?: boolean;
  /**
   * Whether the map is the currently-visible tab. The map is kept mounted (hidden)
   * across tab switches; when not visible we skip GPS-follow and focus camera
   * animations so a hidden map doesn't churn the GPU/battery or fire bounds
   * callbacks that re-render the tree. Defaults to true.
   */
  visible?: boolean;
  showClimbs?: boolean;
  onClimbSelect?: (climbId: string) => void;
  focusStop?: Pick<CompanionStop, "lat" | "lon" | "zoneId"> | null;
  discoverCandidates?: DiscoverCandidate[];
  selectedDiscoverKey?: string | null;
  onDiscoverBoundsChange?: (bounds: MapBounds) => void;
  onSelectDiscoverCandidate?: (candidate: DiscoverCandidate) => void;
}

function stopMarkerTone(status: CompanionStop["verificationStatus"]): "verified" | "suggested" | "skipped" {
  if (status === "verified" || status === "pending") {
    return "verified";
  }
  if (status === "needs_review") {
    return "skipped";
  }
  return "suggested";
}

function stopsGeoJson(
  entries: BundlePoiEntry[],
  selectedPoiId: string | null,
  selectedZoneId: number | null,
  focusPoiId: string | null,
  showUnverified: boolean,
): GeoJSON.FeatureCollection {
  const focusActive = selectedPoiId != null || focusPoiId != null;
  const activePoiId = focusPoiId ?? selectedPoiId;
  return {
    type: "FeatureCollection",
    features: entries.flatMap((entry) => {
      const stop = entry.stop;
      if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lon)) {
        return [];
      }
      if (!isMapVisibleStopStatus(stop.verificationStatus, showUnverified)) {
        return [];
      }
      const poiId = entry.poiId;
      const isSelected = activePoiId != null && poiId === activePoiId;
      const isAlternative =
        focusActive &&
        entry.role === "alternative" &&
        selectedZoneId != null &&
        entry.parentZoneId === selectedZoneId;
      const dimmed = focusActive && !isSelected && !isAlternative;
      const tone = stopMarkerTone(stop.verificationStatus);
      return [
        {
          type: "Feature" as const,
          properties: {
            zoneId: stop.zoneId,
            poiId,
            verified: tone === "verified" ? 1 : 0,
            suggested: tone === "suggested" ? 1 : 0,
            skipped: tone === "skipped" ? 1 : 0,
            selected: isSelected ? 1 : 0,
            alternative: isAlternative ? 1 : 0,
            dimmed: dimmed ? 1 : 0,
          },
          geometry: {
            type: "Point" as const,
            coordinates: [stop.lon, stop.lat],
          },
        },
      ];
    }),
  };
}

function unsupportedGeoJson(
  sections: CompanionUnsupportedSection[],
  coordinates: [number, number][],
  totalKm: number,
): GeoJSON.FeatureCollection {
  const track = buildRouteTrack(coordinates, totalKm);
  return {
    type: "FeatureCollection",
    features: sections.map((section) => {
      const start = interpolateTrackAtKm(track, section.startKm);
      const end = interpolateTrackAtKm(track, section.endKm);
      const segmentCoords: [number, number][] = track.points
        .filter((point) => point.km >= section.startKm && point.km <= section.endKm)
        .map((point) => [point.lon, point.lat]);
      if (segmentCoords.length < 2) {
        segmentCoords.push([start.lon, start.lat], [end.lon, end.lat]);
      }
      return {
        type: "Feature",
        properties: { id: section.id, label: section.displayLabel },
        geometry: {
          type: "LineString",
          coordinates: segmentCoords,
        },
      };
    }),
  };
}

function climbSegmentsGeoJson(
  climbs: CompanionClimb[],
  coordinates: [number, number][],
  totalKm: number,
): GeoJSON.FeatureCollection {
  const track = buildRouteTrack(coordinates, totalKm);
  return {
    type: "FeatureCollection",
    features: climbs.map((climb) => {
      const segmentCoords: [number, number][] = track.points
        .filter((point) => point.km >= climb.startKm && point.km <= climb.endKm)
        .map((point) => [point.lon, point.lat]);
      if (segmentCoords.length < 2) {
        const start = interpolateTrackAtKm(track, climb.startKm);
        const end = interpolateTrackAtKm(track, climb.endKm);
        segmentCoords.push([start.lon, start.lat], [end.lon, end.lat]);
      }
      const tier = analyzeClimbDifficulty(climb);
      return {
        type: "Feature",
        properties: {
          climbId: climb.id,
          color: tier.color,
        },
        geometry: {
          type: "LineString",
          coordinates: segmentCoords,
        },
      };
    }),
  };
}

function climbMarkersGeoJson(
  climbs: CompanionClimb[],
  coordinates: [number, number][],
  totalKm: number,
): GeoJSON.FeatureCollection {
  const track = buildRouteTrack(coordinates, totalKm);
  return {
    type: "FeatureCollection",
    features: climbs.map((climb) => {
      const midpointKm = (climb.startKm + climb.endKm) / 2;
      const point = interpolateTrackAtKm(track, midpointKm);
      const tier = analyzeClimbDifficulty(climb);
      return {
        type: "Feature",
        properties: {
          climbId: climb.id,
          color: tier.color,
          label: `⛰ ${climb.lengthKm.toFixed(1)}km`,
        },
        geometry: {
          type: "Point",
          coordinates: [point.lon, point.lat],
        },
      };
    }),
  };
}

const RouteMapView = forwardRef<RouteMapHandle, RouteMapViewProps>(function RouteMapView(
  {
    embedded = false,
    visible = true,
    showClimbs = false,
    onClimbSelect,
    focusStop = null,
    discoverCandidates = [],
    selectedDiscoverKey = null,
    onDiscoverBoundsChange,
    onSelectDiscoverCandidate,
  },
  ref,
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  const userExploringRef = useRef(false);
  const initialFitDoneRef = useRef(false);
  const stopsRef = useRef<CompanionStop[]>([]);
  const onClimbSelectRef = useRef(onClimbSelect);
  const selectStopRef = useRef<(stop: CompanionStop | null) => void>(() => undefined);
  const onDiscoverBoundsChangeRef = useRef(onDiscoverBoundsChange);
  const onSelectDiscoverCandidateRef = useRef(onSelectDiscoverCandidate);
  const discoverMarkersRef = useRef<maplibregl.Marker[]>([]);
  const lastFocusKeyRef = useRef<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const {
    bundle,
    gps,
    selectedStop,
    selectStop,
    followGps,
    setFollowGps,
    showUnverified,
  } = useCompanion();

  const climbs = bundle.climbs ?? [];
  const poiEntries = useMemo(() => collectAllBundlePois(bundle), [bundle]);
  const visibleStops = useMemo(() => poiEntries.map((entry) => entry.stop), [poiEntries]);
  const selectedRenderedStop = useMemo(() => {
    if (!selectedStop) {
      return null;
    }
    return resolveRenderedStop(bundle, selectedStop);
  }, [bundle, selectedStop]);
  const selectedMarkerPoiId = selectedRenderedStop?.poiId ?? selectedStop?.poiId ?? null;
  const selectedZoneId = selectedRenderedStop?.zoneId ?? selectedStop?.zoneId ?? null;
  const focusPoiId = focusStop ? stopPoiId(focusStop) : null;

  stopsRef.current = visibleStops;
  onClimbSelectRef.current = onClimbSelect;
  selectStopRef.current = selectStop;
  onDiscoverBoundsChangeRef.current = onDiscoverBoundsChange;
  onSelectDiscoverCandidateRef.current = onSelectDiscoverCandidate;

  const recenter = useCallback(() => {
    const map = mapRef.current;
    if (!map || gps.lat == null || gps.lon == null) {
      return;
    }
    userExploringRef.current = false;
    setFollowGps(true);
    map.easeTo({
      center: [gps.lon, gps.lat],
      bearing: gps.bearing,
      zoom: Math.max(map.getZoom(), FOLLOW_ZOOM),
      duration: 450,
      essential: true,
    });
  }, [gps.bearing, gps.lat, gps.lon, setFollowGps]);

  useImperativeHandle(
    ref,
    () => ({
      recenter,
      zoomIn: () => {
        userExploringRef.current = true;
        setFollowGps(false);
        mapRef.current?.zoomIn({ duration: 200 });
      },
      zoomOut: () => {
        userExploringRef.current = true;
        setFollowGps(false);
        mapRef.current?.zoomOut({ duration: 200 });
      },
      resetNorth: () => {
        userExploringRef.current = true;
        setFollowGps(false);
        mapRef.current?.easeTo({ bearing: 0, duration: 300 });
      },
    }),
    [recenter, setFollowGps],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    let cancelled = false;
    readyRef.current = false;
    userExploringRef.current = false;
    initialFitDoneRef.current = false;
    setLoadError(null);

    const map = new maplibregl.Map({
      container: host,
      style: MAP_STYLE,
      center: [
        (bundle.route.bounds.west + bundle.route.bounds.east) / 2,
        (bundle.route.bounds.south + bundle.route.bounds.north) / 2,
      ],
      zoom: embedded ? 11 : 10,
      dragRotate: !embedded,
      touchPitch: !embedded,
      touchZoomRotate: true,
      doubleClickZoom: !embedded,
      fadeDuration: 0,
      refreshExpiredTiles: false,
    });
    mapRef.current = map;

    const fail = (message: string) => {
      if (cancelled) {
        return;
      }
      setLoadError(message);
    };

    map.on("error", (event) => {
      fail(event.error?.message ?? "Map failed to load.");
    });

    const setup = () => {
      if (cancelled || map.getSource("route")) {
        return;
      }

      try {
      map.addSource("route", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: bundle.route.coordinates,
          },
        },
      });

      map.addLayer({
        id: "route-halo",
        type: "line",
        source: "route",
        paint: {
          "line-color": ROUTE_HALO_COLOR,
          "line-width": embedded ? ROUTE_HALO_WIDTH - 2 : ROUTE_HALO_WIDTH,
          "line-opacity": ROUTE_HALO_OPACITY,
        },
      });

      map.addLayer({
        id: "route-core",
        type: "line",
        source: "route",
        paint: {
          "line-color": ROUTE_CORE_COLOR,
          "line-width": embedded ? ROUTE_CORE_WIDTH - 1 : ROUTE_CORE_WIDTH,
          "line-opacity": ROUTE_CORE_OPACITY,
        },
      });

      map.addLayer({
        id: "route-direction",
        type: "symbol",
        source: "route",
        minzoom: 9,
        layout: {
          "symbol-placement": "line",
          "symbol-spacing": [
            "interpolate",
            ["linear"],
            ["zoom"],
            10,
            120,
            14,
            70,
            17,
            40,
          ],
          "text-field": "▸",
          "text-size": ["interpolate", ["linear"], ["zoom"], 10, 10, 14, 13, 17, 15],
          "text-keep-upright": false,
          "text-rotation-alignment": "map",
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: {
          "text-color": "#ffffff",
          "text-halo-color": ROUTE_CORE_COLOR,
          "text-halo-width": 1.2,
          "text-opacity": 0.9,
        },
      });

      map.addSource("climb-segments", {
        type: "geojson",
        data: climbSegmentsGeoJson(climbs, bundle.route.coordinates, bundle.race.distanceKm),
      });

      map.addLayer({
        id: "climb-segments-line",
        type: "line",
        source: "climb-segments",
        layout: { visibility: showClimbs ? "visible" : "none" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": embedded ? 5 : 7,
          "line-opacity": 0.95,
        },
      });

      map.addSource("climb-markers", {
        type: "geojson",
        data: climbMarkersGeoJson(climbs, bundle.route.coordinates, bundle.race.distanceKm),
      });

      map.addLayer({
        id: "climb-markers-bg",
        type: "circle",
        source: "climb-markers",
        layout: { visibility: showClimbs ? "visible" : "none" },
        paint: {
          "circle-radius": embedded ? 10 : 14,
          "circle-color": ["get", "color"],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });

      map.addSource("unsupported", {
        type: "geojson",
        data: unsupportedGeoJson(
          bundle.unsupportedSections,
          bundle.route.coordinates,
          bundle.race.distanceKm,
        ),
      });

      map.addLayer({
        id: "unsupported-line",
        type: "line",
        source: "unsupported",
        paint: {
          "line-color": "#f59e0b",
          "line-width": embedded ? 4 : 5,
          "line-opacity": 0.7,
        },
      });

      map.addSource("stops", {
        type: "geojson",
        data: stopsGeoJson(poiEntries, selectedMarkerPoiId, selectedZoneId, focusPoiId, showUnverified),
      });

      map.addLayer({
        id: "stops-dimmed",
        type: "circle",
        source: "stops",
        filter: ["==", ["get", "dimmed"], 1],
        paint: {
          "circle-radius": 6,
          "circle-color": DIMMED_STOP_COLOR,
          "circle-opacity": 0.35,
          "circle-stroke-width": 1,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-opacity": 0.35,
        },
      });

      map.addLayer({
        id: "stops-alternative",
        type: "circle",
        source: "stops",
        filter: ["==", ["get", "alternative"], 1],
        paint: {
          "circle-radius": 7,
          "circle-color": ALTERNATIVE_STOP_COLOR,
          "circle-opacity": 0.85,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-opacity": 0.9,
        },
      });

      map.addLayer({
        id: "stops-suggested",
        type: "circle",
        source: "stops",
        filter: ["all", ["==", ["get", "suggested"], 1], ["==", ["get", "selected"], 0], ["==", ["get", "dimmed"], 0], ["==", ["get", "alternative"], 0]],
        paint: {
          "circle-radius": embedded ? 8 : 11,
          "circle-color": SUGGESTED_STOP_COLOR,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });

      map.addLayer({
        id: "stops-skipped",
        type: "circle",
        source: "stops",
        filter: ["all", ["==", ["get", "skipped"], 1], ["==", ["get", "selected"], 0], ["==", ["get", "dimmed"], 0], ["==", ["get", "alternative"], 0]],
        paint: {
          "circle-radius": embedded ? 8 : 11,
          "circle-color": SKIPPED_STOP_COLOR,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });

      map.addLayer({
        id: "stops-verified-bg",
        type: "circle",
        source: "stops",
        filter: ["all", ["==", ["get", "verified"], 1], ["==", ["get", "selected"], 0], ["==", ["get", "dimmed"], 0], ["==", ["get", "alternative"], 0]],
        paint: {
          "circle-radius": embedded ? 9 : 12,
          "circle-color": "#10b981",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });

      map.addLayer({
        id: "stops-selected-halo",
        type: "circle",
        source: "stops",
        filter: ["==", ["get", "selected"], 1],
        paint: {
          "circle-radius": embedded ? 20 : 24,
          "circle-color": SELECTED_STOP_HALO,
          "circle-opacity": 0.35,
          "circle-stroke-width": 0,
        },
      });

      map.addLayer({
        id: "stops-selected-ring",
        type: "circle",
        source: "stops",
        filter: ["==", ["get", "selected"], 1],
        paint: {
          "circle-radius": embedded ? 14 : 17,
          "circle-color": SELECTED_STOP_CORE,
          "circle-stroke-width": 3,
          "circle-stroke-color": "#ffffff",
        },
      });

      map.addLayer({
        id: "stops-selected-core",
        type: "circle",
        source: "stops",
        filter: ["==", ["get", "selected"], 1],
        paint: {
          "circle-radius": embedded ? 8 : 10,
          "circle-color": "#ffffff",
          "circle-stroke-width": 3,
          "circle-stroke-color": SELECTED_STOP_CORE,
        },
      });

      map.addSource("discover-detours", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.addLayer({
        id: "discover-detours-halo",
        type: "line",
        source: "discover-detours",
        layout: { visibility: "none" },
        paint: {
          "line-color": "#2563EB",
          "line-width": 4,
          "line-opacity": 0.18,
          "line-dasharray": [2, 4],
        },
      });

      map.addLayer({
        id: "discover-detours-core",
        type: "line",
        source: "discover-detours",
        layout: { visibility: "none", "line-cap": "round" },
        paint: {
          "line-color": "#2563EB",
          "line-width": 2,
          "line-opacity": 0.9,
          "line-dasharray": [6, 8],
        },
      });

      map.addSource("rider", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: [0, 0] },
        },
      });

      if (!embedded) {
        map.addLayer({
          id: "rider-pulse",
          type: "circle",
          source: "rider",
          paint: {
            "circle-radius": 18,
            "circle-color": "#0ea5e9",
            "circle-opacity": 0.18,
          },
        });

        map.addLayer({
          id: "rider-core",
          type: "circle",
          source: "rider",
          paint: {
            "circle-radius": 8,
            "circle-color": "#0ea5e9",
            "circle-stroke-width": 3,
            "circle-stroke-color": "#ffffff",
          },
        });
      } else {
        map.addLayer({
          id: "rider-core",
          type: "circle",
          source: "rider",
          layout: { visibility: "none" },
          paint: {
            "circle-radius": 7,
            "circle-color": "#0ea5e9",
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
          },
        });
      }

      if (!embedded && !initialFitDoneRef.current) {
        map.fitBounds(
          [
            [bundle.route.bounds.west, bundle.route.bounds.south],
            [bundle.route.bounds.east, bundle.route.bounds.north],
          ],
          { padding: 40, duration: 0 },
        );
        initialFitDoneRef.current = true;
      }

      readyRef.current = true;
      } catch (error) {
        fail(error instanceof Error ? error.message : "Map failed to set up.");
      }
    };

    if (map.loaded()) {
      setup();
    } else {
      map.once("load", setup);
    }

    map.on("click", (event) => {
      const climbFeatures = map.queryRenderedFeatures(event.point, {
        layers: ["climb-markers-bg", "climb-segments-line"],
      });
      if (climbFeatures.length > 0 && onClimbSelectRef.current) {
        const climbId = climbFeatures[0].properties?.climbId;
        if (typeof climbId === "string") {
          onClimbSelectRef.current(climbId);
          return;
        }
      }

      const stopFeatures = map.queryRenderedFeatures(event.point, {
        layers: [
          "stops-verified-bg",
          "stops-suggested",
          "stops-skipped",
          "stops-alternative",
          "stops-selected-ring",
          "stops-selected-core",
        ],
      });
      if (stopFeatures.length === 0) {
        return;
      }
      const poiId = stopFeatures[0].properties?.poiId;
      if (typeof poiId !== "string") {
        return;
      }
      const stop =
        stopsRef.current.find((item) => stopPoiId(item) === poiId) ?? null;
      selectStopRef.current(stop);
    });

    const pauseFollow = () => {
      userExploringRef.current = true;
      setFollowGps(false);
    };
    map.on("dragstart", pauseFollow);
    map.on("zoomstart", pauseFollow);
    map.on("rotatestart", pauseFollow);
    map.on("pitchstart", pauseFollow);

    const emitBounds = () => {
      onDiscoverBoundsChangeRef.current?.(mapBoundsFromMaplibre(map.getBounds()));
    };
    map.on("moveend", emitBounds);
    map.on("zoomend", emitBounds);
    emitBounds();

    // Keep the canvas matched to its container. The map is kept alive (only
    // hidden) across tab switches, and the surrounding header/banners change
    // height between tabs — resizing here means the map is already correct the
    // instant it becomes visible again, with no reflow flash.
    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            if (mapRef.current && host.clientWidth > 0 && host.clientHeight > 0) {
              mapRef.current.resize();
            }
          })
        : null;
    resizeObserver?.observe(host);

    return () => {
      cancelled = true;
      readyRef.current = false;
      resizeObserver?.disconnect();
      for (const marker of discoverMarkersRef.current) {
        marker.remove();
      }
      discoverMarkersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, [bundle.race.id, embedded, setFollowGps]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getSource("stops") || !readyRef.current) {
      return;
    }
    (map.getSource("stops") as maplibregl.GeoJSONSource).setData(
      stopsGeoJson(poiEntries, selectedMarkerPoiId, selectedZoneId, focusPoiId, showUnverified),
    );
  }, [focusPoiId, poiEntries, selectedMarkerPoiId, selectedZoneId, showUnverified]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) {
      return;
    }

    for (const marker of discoverMarkersRef.current) {
      marker.remove();
    }
    discoverMarkersRef.current = [];

    const detourSource = map.getSource("discover-detours") as maplibregl.GeoJSONSource | undefined;
    detourSource?.setData({ type: "FeatureCollection", features: [] });
    for (const layerId of ["discover-detours-halo", "discover-detours-core"]) {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, "visibility", "none");
      }
    }

    if (discoverCandidates.length === 0) {
      return;
    }

    for (const [index, candidate] of discoverCandidates.entries()) {
      const key = poiOsmKey(candidate.osmType, candidate.osmId);
      const selected = selectedDiscoverKey === key;
      const element = document.createElement("button");
      element.type = "button";
      element.className = "discover-marker";
      element.style.animationDelay = `${index * 60}ms`;
      element.setAttribute("aria-label", candidate.name ?? candidate.category);
      element.innerHTML = discoverMarkerHtml({ selected, animationDelayMs: index * 60 });
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        onSelectDiscoverCandidateRef.current?.(candidate);
      });
      const marker = new maplibregl.Marker({ element, anchor: "center" })
        .setLngLat([candidate.lon, candidate.lat])
        .addTo(map);
      discoverMarkersRef.current.push(marker);
    }
  }, [discoverCandidates, selectedDiscoverKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getSource("climb-segments") || !readyRef.current) {
      return;
    }
    const visibility = showClimbs && climbs.length > 0 ? "visible" : "none";
    (map.getSource("climb-segments") as maplibregl.GeoJSONSource).setData(
      climbSegmentsGeoJson(climbs, bundle.route.coordinates, bundle.race.distanceKm),
    );
    (map.getSource("climb-markers") as maplibregl.GeoJSONSource).setData(
      climbMarkersGeoJson(climbs, bundle.route.coordinates, bundle.race.distanceKm),
    );
    for (const layerId of ["climb-segments-line", "climb-markers-bg"]) {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, "visibility", visibility);
      }
    }
  }, [bundle.race.distanceKm, bundle.route.coordinates, climbs, showClimbs]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getSource("rider") || !readyRef.current || gps.lat == null || gps.lon == null) {
      return;
    }
    (map.getSource("rider") as maplibregl.GeoJSONSource).setData({
      type: "Feature",
      properties: {},
      geometry: { type: "Point", coordinates: [gps.lon, gps.lat] },
    });
    if (embedded && map.getLayer("rider-core")) {
      map.setLayoutProperty("rider-core", "visibility", "visible");
    }
  }, [embedded, gps.lat, gps.lon]);

  useEffect(() => {
    const map = mapRef.current;
    if (
      !map ||
      embedded ||
      !visible ||
      !readyRef.current ||
      !followGps ||
      userExploringRef.current ||
      gps.lat == null ||
      gps.lon == null
    ) {
      return;
    }
    map.easeTo({
      center: [gps.lon, gps.lat],
      bearing: gps.bearing,
      duration: 450,
      essential: true,
    });
  }, [embedded, visible, followGps, gps.bearing, gps.lat, gps.lon]);

  useEffect(() => {
    const map = mapRef.current;
    const target = focusStop ?? selectedStop;
    if (!map || !readyRef.current) {
      return;
    }
    // Don't animate the camera of a hidden map (e.g. a stop selected from the
    // Resupply tab): it would move under the covers, fire moveend/bounds and
    // waste GPU. The focus applies when the map becomes visible again.
    if (!visible && !embedded) {
      return;
    }
    if (!target) {
      lastFocusKeyRef.current = null;
      return;
    }
    if (!embedded && followGps && !selectedStop) {
      return;
    }
    if (!Number.isFinite(target.lat) || !Number.isFinite(target.lon)) {
      return;
    }
    const focusKey = stopPoiId(target);
    if (focusKey === lastFocusKeyRef.current) {
      return;
    }
    lastFocusKeyRef.current = focusKey;

    const focusingSelectedStop = !embedded && selectedStop != null;
    map.stop();
    map.easeTo({
      center: [target.lon, target.lat],
      zoom: embedded || focusingSelectedStop ? EMBEDDED_FOCUS_ZOOM : map.getZoom(),
      bearing: map.getBearing(),
      offset: embedded || focusingSelectedStop ? EMBEDDED_FOCUS_OFFSET : undefined,
      duration: FOCUS_ANIMATION_MS,
      essential: true,
    });
  }, [embedded, visible, focusStop, followGps, selectedStop]);

  useEffect(() => {
    if (followGps) {
      userExploringRef.current = false;
    }
  }, [followGps]);

  return (
    <div className="absolute inset-0 bg-[#0c1018]">
      <div ref={hostRef} className="absolute inset-0" />
      {loadError ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
          <p className="text-sm font-medium text-white/75">Map unavailable</p>
          <p className="mt-1 text-xs text-white/45">{loadError}</p>
        </div>
      ) : null}
    </div>
  );
});

export default RouteMapView;
