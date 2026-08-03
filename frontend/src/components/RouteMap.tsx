import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import type { ClimbCandidateRow, ClimbRow, ResupplyZone, RoadbookResult, RouteVisualization } from "../api";
import { discoverMarkerHtml } from "@shared/race/discoverMarker";
import type { DiscoverCandidate } from "@shared/race/discoverStops";
import { poiOsmKey } from "@shared/race/discoverStops";
import { mapBoundsFromLeaflet } from "../planning/discoverStopsAdapter";
import type { MapBounds } from "@shared/race/discoverStops";
import { legendForView } from "../planning/viewModel";
import type { OverlayMode, TimeMode, ZoneDensityMode } from "../planning/types";
import type { TimeWindowId } from "../planning/timeWindows";
import { zoneAvailability } from "../planning/stopAvailability";
import { climbDisplayName } from "../planning/climbLabels";
import { surfaceSegmentMatchesSelection } from "../planning/surfaceBreakdown";
import { primaryMapPois } from "../planning/poiMapMarkers";
import {
  buildSuggestedStopMapMarkers,
  isSuggestedStopVerified,
  suggestedStopMarkerColor,
} from "../planning/suggestedStopMapMarkers";
import type { KmRangeSelection } from "../planning/useRouteWorkspaceSelection";
import type { StopSelection } from "../planning/stopSelection";
import OverlayLegend from "./OverlayLegend";
import { zoneHasCategory } from "./routeInsights";
import { useRace } from "../races/RaceContext";
import {
  verificationStatusPresentation,
  verificationStatusTooltipLabel,
  zoneVerificationStatus,
} from "../planning/stopVerification/verificationStatusPresentation";
import {
  boundsForKmRange,
  buildColoredSegments,
  findNearestTrackIndexByLatLng,
  segmentPositionsForKmRange,
  zoneMarkerColor,
} from "./routeUtils";
import { zoneMapDivIcon } from "./maps/zoneMapMarker";
import PlanningTileLayer from "./maps/PlanningTileLayer";
import RouteGlowLayers from "./maps/RouteGlowLayers";
import { MAP_HIGHLIGHT, PLANNING_MAP_CLASS } from "./maps/planningMapTheme";
import { PLANNING_MAP_INTERACTIVE_PROPS } from "./maps/planningMapInteraction";
import {
  fitPlanningBounds,
  fitPlanningRoute,
} from "./maps/planningMapView";

import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  iconShadow: markerShadow,
});

interface RouteMapProps {
  route: RouteVisualization;
  zones: ResupplyZone[];
  climbs: ClimbRow[];
  rejectedClimbs: ClimbCandidateRow[];
  showRejectedClimbs: boolean;
  zoneDensity: ZoneDensityMode;
  overlay: OverlayMode;
  timeMode: TimeMode;
  arrivalTimeWindow: TimeWindowId | null;
  selectedSurfaceType: string | null;
  activeIndex: number | null;
  selectedZoneId: number | null;
  selectedClimbId: string | null;
  selectedCandidateId: string | null;
  /** Visual route highlight — may include hover preview. */
  highlightKmRange?: KmRangeSelection | null;
  /** Viewport focus — only from explicit selection (clicks / navigation actions). */
  focusKmRange?: KmRangeSelection | null;
  fillHeight?: boolean;
  onActiveIndexChange: (index: number | null) => void;
  onSelectZone: (zoneId: number) => void;
  onHoverZone?: (zoneId: number | null) => void;
  onSelectClimb: (climbId: string) => void;
  onSelectCandidate: (candidateId: string) => void;
  onSelectPoi: (selection: StopSelection) => void;
  poiDebugMode?: boolean;
  climbDebugMode?: boolean;
  onPoiDebugClick?: (lat: number, lon: number) => void;
  onClimbDebugClick?: (lat: number, lon: number) => void;
  discoverCandidates?: DiscoverCandidate[];
  selectedDiscoverKey?: string | null;
  onDiscoverBoundsChange?: (bounds: MapBounds) => void;
  onSelectDiscoverCandidate?: (candidate: DiscoverCandidate) => void;
  roadbookResult?: RoadbookResult | null;
}

function PanToFocus({
  points,
  selectedZone,
  selectedClimb,
  selectedZoneId,
  selectedClimbId,
  selectedCandidate,
  selectedCandidateId,
  focusKmRange,
}: {
  points: RouteVisualization["track_points"];
  selectedZone?: ResupplyZone;
  selectedClimb: ClimbRow | null;
  selectedZoneId: number | null;
  selectedClimbId: string | null;
  selectedCandidate: ClimbCandidateRow | null;
  selectedCandidateId: string | null;
  focusKmRange?: KmRangeSelection | null;
}) {
  const map = useMap();
  const lastFocusKeyRef = useRef<string | null>(null);
  const FOCUS_DURATION_S = 1;

  useEffect(() => {
    if (focusKmRange) {
      const focusKey = `range:${focusKmRange.startKm}-${focusKmRange.endKm}`;
      if (focusKey === lastFocusKeyRef.current) {
        return;
      }
      lastFocusKeyRef.current = focusKey;
      const bounds = boundsForKmRange(points, focusKmRange.startKm, focusKmRange.endKm);
      if (bounds) {
        fitPlanningBounds(map, bounds, "local", {
          padding: [32, 32],
          maxZoom: 14,
          animate: true,
        });
      }
      return;
    }

    if (selectedCandidateId && selectedCandidate) {
      const focusKey = `candidate:${selectedCandidateId}`;
      if (focusKey === lastFocusKeyRef.current) {
        return;
      }
      lastFocusKeyRef.current = focusKey;
      const bounds = boundsForKmRange(points, selectedCandidate.start_km, selectedCandidate.end_km);
      if (bounds) {
        fitPlanningBounds(map, bounds, "local", {
          padding: [32, 32],
          maxZoom: 14,
          animate: true,
        });
      }
      return;
    }

    if (selectedClimbId && selectedClimb) {
      const focusKey = `climb:${selectedClimbId}`;
      if (focusKey === lastFocusKeyRef.current) {
        return;
      }
      lastFocusKeyRef.current = focusKey;
      const bounds = boundsForKmRange(points, selectedClimb.start_km, selectedClimb.end_km);
      if (bounds) {
        fitPlanningBounds(map, bounds, "local", {
          padding: [32, 32],
          maxZoom: 14,
          animate: true,
        });
      }
      return;
    }

    if (selectedZoneId && selectedZone) {
      const focusKey = `zone:${selectedZoneId}`;
      if (focusKey === lastFocusKeyRef.current) {
        return;
      }
      lastFocusKeyRef.current = focusKey;
      map.flyTo([selectedZone.lat, selectedZone.lon], Math.max(map.getZoom(), 14), {
        animate: true,
        duration: FOCUS_DURATION_S,
      });
      return;
    }

    lastFocusKeyRef.current = null;
  }, [
    map,
    points,
    selectedCandidate,
    selectedCandidateId,
    selectedClimb,
    selectedClimbId,
    selectedZone,
    selectedZoneId,
    focusKmRange,
  ]);

  return null;
}

function FitBounds({ route }: { route: RouteVisualization }) {
  const map = useMap();
  const routeFingerprint = useMemo(() => {
    const points = route.track_points;
    if (points.length === 0) {
      return "empty";
    }
    return `${points.length}:${points[0].km}:${points[points.length - 1].km}`;
  }, [route.track_points]);

  useEffect(() => {
    fitPlanningRoute(map, route, "workspace", {
      regionalFocus: false,
      maxZoom: 13,
    });
  }, [map, route, routeFingerprint]);

  return null;
}

function MapInteractionHandler({
  points,
  onActiveIndexChange,
  poiDebugMode = false,
  climbDebugMode = false,
  onPoiDebugClick,
  onClimbDebugClick,
}: {
  points: RouteVisualization["track_points"];
  onActiveIndexChange: (index: number | null) => void;
  poiDebugMode?: boolean;
  climbDebugMode?: boolean;
  onPoiDebugClick?: (lat: number, lon: number) => void;
  onClimbDebugClick?: (lat: number, lon: number) => void;
}) {
  useMapEvents({
    click(event: L.LeafletMouseEvent) {
      if (poiDebugMode && onPoiDebugClick) {
        onPoiDebugClick(event.latlng.lat, event.latlng.lng);
        return;
      }
      if (climbDebugMode && onClimbDebugClick) {
        onClimbDebugClick(event.latlng.lat, event.latlng.lng);
        return;
      }
      const index = findNearestTrackIndexByLatLng(points, event.latlng.lat, event.latlng.lng);
      onActiveIndexChange(index);
    },
    mousemove(event: L.LeafletMouseEvent) {
      if (poiDebugMode || climbDebugMode) {
        return;
      }
      const index = findNearestTrackIndexByLatLng(points, event.latlng.lat, event.latlng.lng);
      onActiveIndexChange(index);
    },
    mouseout() {
      if (poiDebugMode || climbDebugMode) {
        return;
      }
      onActiveIndexChange(null);
    },
  });
  return null;
}

function ZoomWatcher({ onZoomChange }: { onZoomChange: (zoom: number) => void }) {
  const map = useMap();

  useEffect(() => {
    onZoomChange(map.getZoom());
    const handler = () => onZoomChange(map.getZoom());
    map.on("zoomend", handler);
    return () => {
      map.off("zoomend", handler);
    };
  }, [map, onZoomChange]);

  return null;
}

function zoneTooltip(zone: ResupplyZone): string {
  const services = [
    zoneHasCategory(zone, "food") ? "Food" : null,
    zoneHasCategory(zone, "water") ? "Water" : null,
    zoneHasCategory(zone, "fuel") ? "Fuel" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return `${zone.name} (${zone.distance_along_km.toFixed(0)} km)${services ? ` — ${services}` : ""}`;
}

function poiDivIcon(icon: string): L.DivIcon {
  return L.divIcon({
    html: `<div style="font-size:18px;line-height:1;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35));">${icon}</div>`,
    className: "",
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

function discoverDivIcon(selected = false, animationDelayMs = 0): L.DivIcon {
  const markerSpan = selected ? 17 : 16;
  return L.divIcon({
    html: discoverMarkerHtml({ selected, animationDelayMs }),
    className: "discover-marker",
    iconSize: [markerSpan, markerSpan],
    iconAnchor: [markerSpan / 2, markerSpan / 2],
  });
}

function MapBoundsWatcher({ onBoundsChange }: { onBoundsChange?: (bounds: MapBounds) => void }) {
  const map = useMap();

  useEffect(() => {
    if (!onBoundsChange) {
      return;
    }
    const emit = () => onBoundsChange(mapBoundsFromLeaflet(map.getBounds()));
    emit();
    map.on("moveend", emit);
    map.on("zoomend", emit);
    return () => {
      map.off("moveend", emit);
      map.off("zoomend", emit);
    };
  }, [map, onBoundsChange]);

  return null;
}

export default function RouteMap({
  route,
  zones,
  climbs,
  rejectedClimbs,
  showRejectedClimbs,
  zoneDensity,
  overlay,
  timeMode,
  arrivalTimeWindow,
  selectedSurfaceType,
  activeIndex,
  selectedZoneId,
  selectedClimbId,
  selectedCandidateId,
  highlightKmRange = null,
  focusKmRange = null,
  fillHeight = false,
  onActiveIndexChange,
  onSelectZone,
  onHoverZone,
  onSelectClimb,
  onSelectCandidate,
  onSelectPoi,
  poiDebugMode = false,
  climbDebugMode = false,
  onPoiDebugClick,
  onClimbDebugClick,
  discoverCandidates = [],
  selectedDiscoverKey = null,
  onDiscoverBoundsChange,
  onSelectDiscoverCandidate,
  roadbookResult = null,
}: RouteMapProps) {
  const { verifiedStops } = useRace();
  const [mapZoom, setMapZoom] = useState(11);
  const routePositions = useMemo(
    () => route.track_points.map((point) => [point.lat, point.lon] as [number, number]),
    [route.track_points],
  );
  const segments = useMemo(() => buildColoredSegments(route, overlay), [route, overlay]);
  const highlightedSurfaceSegments = useMemo(() => {
    if (overlay !== "surface" || !selectedSurfaceType) {
      return [];
    }
    return route.surface_segments.filter((segment) =>
      surfaceSegmentMatchesSelection(segment, selectedSurfaceType),
    );
  }, [overlay, route.surface_segments, selectedSurfaceType]);

  const activePoint = activeIndex !== null ? route.track_points[activeIndex] : null;
  const selectedZone = zones.find((zone) => zone.zone_id === selectedZoneId);
  const selectedClimb = climbs.find((climb) => climb.id === selectedClimbId) ?? null;
  const selectedCandidate =
    rejectedClimbs.find((candidate) => candidate.candidate_id === selectedCandidateId) ?? null;
  const legend = legendForView(overlay, timeMode);
  const poiMarkers = useMemo(() => primaryMapPois(zones, zoneDensity), [zones, zoneDensity]);
  const suggestedMarkers = useMemo(
    () => (roadbookResult ? buildSuggestedStopMapMarkers(roadbookResult, verifiedStops) : []),
    [roadbookResult, verifiedStops],
  );
  const zonesById = useMemo(
    () =>
      new Map(
        (roadbookResult?.resupply_zones ?? zones).map((zone) => [zone.zone_id, zone] as const),
      ),
    [roadbookResult?.resupply_zones, zones],
  );
  const focusActive =
    selectedClimbId !== null || selectedZoneId !== null || highlightKmRange !== null;
  const showLabels = mapZoom >= 14;

  const rangeHighlightPositions = useMemo(() => {
    if (!highlightKmRange) {
      return null;
    }
    return segmentPositionsForKmRange(
      route.track_points,
      highlightKmRange.startKm,
      highlightKmRange.endKm,
    );
  }, [highlightKmRange, route.track_points]);

  return (
    <div
      className={`relative overflow-hidden bg-card ${
        fillHeight ? "absolute inset-0 h-full rounded-xl border border-line/60" : "rounded-2xl border border-line shadow-card"
      }`}
    >
      <MapContainer
        className={`${PLANNING_MAP_CLASS} ${fillHeight ? "h-full w-full" : "h-[min(58vh,520px)] w-full"}`}
        center={[route.track_points[0]?.lat ?? 0, route.track_points[0]?.lon ?? 0]}
        zoom={12}
        {...PLANNING_MAP_INTERACTIVE_PROPS}
      >
        <PlanningTileLayer />
        <FitBounds route={route} />
        <ZoomWatcher onZoomChange={setMapZoom} />
        <MapBoundsWatcher onBoundsChange={onDiscoverBoundsChange} />
        <PanToFocus
          points={route.track_points}
          selectedZone={selectedZone}
          selectedClimb={selectedClimb}
          selectedZoneId={selectedZoneId}
          selectedClimbId={selectedClimbId}
          selectedCandidate={selectedCandidate}
          selectedCandidateId={selectedCandidateId}
          focusKmRange={focusKmRange}
        />
        <MapInteractionHandler
          points={route.track_points}
          onActiveIndexChange={onActiveIndexChange}
          poiDebugMode={poiDebugMode}
          climbDebugMode={climbDebugMode}
          onPoiDebugClick={onPoiDebugClick}
          onClimbDebugClick={onClimbDebugClick}
        />

        {overlay === "normal" ? (
          <RouteGlowLayers
            positions={routePositions}
            variant={focusActive ? "faded" : "primary"}
          />
        ) : (
          segments.map((segment, index) => (
            <Polyline
              key={`segment-${index}`}
              positions={segment.positions}
              pathOptions={{
                color: segment.color,
                weight: focusActive ? 4 : 6,
                opacity: focusActive ? 0.18 : selectedSurfaceType && overlay === "surface" ? 0.2 : 0.92,
                lineCap: "round",
              }}
            />
          ))
        )}

        {highlightedSurfaceSegments.map((segment, index) => {
          const positions = segmentPositionsForKmRange(
            route.track_points,
            segment.start_km,
            segment.end_km,
          );
          if (positions.length < 2) {
            return null;
          }
          return (
            <Polyline
              key={`highlight-surface-${index}`}
              positions={positions}
              pathOptions={{
                color: segment.color,
                weight: 9,
                opacity: 1,
                lineCap: "round",
              }}
            />
          );
        })}

        {rangeHighlightPositions && rangeHighlightPositions.length >= 2 && (
          <Polyline
            positions={rangeHighlightPositions}
            pathOptions={{
              color: MAP_HIGHLIGHT.climb,
              weight: 10,
              opacity: 1,
              lineCap: "round",
            }}
          />
        )}

        {showRejectedClimbs &&
          rejectedClimbs
            .filter((candidate) => candidate.status === "rejected")
            .map((candidate) => {
              const positions = segmentPositionsForKmRange(
                route.track_points,
                candidate.start_km,
                candidate.end_km,
              );
              if (positions.length < 2) {
                return null;
              }
              return (
                <Polyline
                  key={candidate.candidate_id}
                  positions={positions}
                  pathOptions={{
                    color: selectedCandidateId === candidate.candidate_id ? "#6b7280" : "#9ca3af",
                    weight: selectedCandidateId === candidate.candidate_id ? 7 : 4,
                    opacity: 0.75,
                    dashArray: "8 8",
                  }}
                  eventHandlers={{
                    click: () => onSelectCandidate(candidate.candidate_id),
                  }}
                />
              );
            })}

        {climbs.map((climb, index) => {
          const positions = segmentPositionsForKmRange(
            route.track_points,
            climb.start_km,
            climb.end_km,
          );
          if (positions.length < 2) {
            return null;
          }
          const selected = selectedClimbId === climb.id;
          const dimmed = focusActive && !selected;
          return (
            <Polyline
              key={climb.id}
              positions={positions}
              pathOptions={{
                color: selected ? "#b91c1c" : MAP_HIGHLIGHT.climb,
                weight: selected ? 8 : 5,
                opacity: dimmed ? 0.2 : 0.95,
                lineCap: "round",
              }}
              eventHandlers={{
                click: () => onSelectClimb(climb.id),
              }}
            >
              {showLabels && (
                <Tooltip permanent direction="top" offset={[0, -6]}>
                  {climbDisplayName(climb, index)}
                </Tooltip>
              )}
            </Polyline>
          );
        })}

        {discoverCandidates.map((candidate, index) => {
          const key = poiOsmKey(candidate.osmType, candidate.osmId);
          const selected = selectedDiscoverKey === key;
          return (
            <Marker
              key={`discover-${key}`}
              position={[candidate.lat, candidate.lon]}
              icon={discoverDivIcon(selected, index * 60)}
              zIndexOffset={selected ? 700 : 400}
              eventHandlers={{
                click: () => onSelectDiscoverCandidate?.(candidate),
              }}
            />
          );
        })}

        {poiMarkers.map((marker) => (
          <Marker
            key={`${marker.poi.osm_type}-${marker.poi.osm_id}`}
            position={[marker.poi.lat, marker.poi.lon]}
            icon={poiDivIcon(marker.icon)}
            eventHandlers={{
              click: () => onSelectPoi({ kind: "poi", poi: marker.poi, zone: marker.zone }),
            }}
          >
            <Tooltip direction="top" offset={[0, -8]}>
              {marker.label}
            </Tooltip>
          </Marker>
        ))}

        {suggestedMarkers.map((marker) => {
          const zone = zonesById.get(marker.stop.zone_id);
          if (!zone) {
            return null;
          }
          const selected = selectedZoneId === marker.stop.zone_id;
          const verified = isSuggestedStopVerified(marker.verificationStatus);
          const fillColor = suggestedStopMarkerColor(marker.verificationStatus);
          return (
            <Marker
              key={`suggested-${marker.stop.osm_type}-${marker.stop.osm_id}`}
              position={[marker.stop.lat, marker.stop.lon]}
              icon={zoneMapDivIcon({
                fillColor,
                selected,
                dimmed: focusActive && selectedZoneId !== null && !selected,
                verified,
              })}
              zIndexOffset={selected ? 500 : verified ? 200 : 0}
              eventHandlers={{
                click: () => onSelectPoi({ kind: "poi", poi: marker.poi, zone }),
              }}
            >
              <Tooltip direction="top" offset={[0, -8]} opacity={0.95}>
                {marker.label}
                {" · "}
                {verificationStatusTooltipLabel(marker.verificationStatus)}
              </Tooltip>
            </Marker>
          );
        })}

        {zones.map((zone) => {
          const availability = zoneAvailability(zone, arrivalTimeWindow, timeMode);
          const verificationStatus = zoneVerificationStatus(zone.zone_id, verifiedStops);
          const isVerified = verificationStatus === "verified";
          const selected = selectedZoneId === zone.zone_id;
          const dimmed =
            availability?.status === "closed" ||
            (focusActive && selectedZoneId !== null && !selected);
          const statusPresentation = verificationStatusPresentation(verificationStatus);
          const fillColor =
            statusPresentation.markerColor ?? zoneMarkerColor(zone, overlay, timeMode, route);

          return (
            <Marker
              key={zone.zone_id}
              position={[zone.lat, zone.lon]}
              icon={zoneMapDivIcon({
                fillColor,
                selected,
                dimmed,
                verified: isVerified,
              })}
              zIndexOffset={selected ? 500 : isVerified ? 200 : 0}
              eventHandlers={{
                click: () => onSelectZone(zone.zone_id),
                mouseover: () => onHoverZone?.(zone.zone_id),
                mouseout: () => onHoverZone?.(null),
              }}
            >
              <Tooltip direction="top" offset={[0, -8]} opacity={0.95}>
                {zoneTooltip(zone)}
                {" · "}
                {verificationStatusTooltipLabel(verificationStatus)}
                {availability ? ` · ${availability.label}` : ""}
              </Tooltip>
            </Marker>
          );
        })}

        {activePoint && (
          <CircleMarker
            center={[activePoint.lat, activePoint.lon]}
            radius={8}
            pathOptions={{ color: "#1c1917", fillColor: "#ffffff", fillOpacity: 1, weight: 3 }}
          />
        )}
      </MapContainer>

      <OverlayLegend items={legend} className="pointer-events-none absolute bottom-3 left-3" />
    </div>
  );
}
