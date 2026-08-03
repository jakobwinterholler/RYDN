import { useMemo, useEffect, useCallback, useState } from "react";
import type { RoadbookResult } from "../../api";
import { poiOsmKey } from "@shared/race/discoverStops";
import { useRenderTrace } from "../../debug/raceOpenTrace";
import { usePlanning } from "../../planning/PlanningContext";
import { buildRouteHighlights } from "../../planning/routeHighlights";
import type { RouteHighlight } from "../../planning/routeHighlights";
import { applyBriefingHighlight } from "../../planning/briefingActions";
import { buildResupplySegmentSummary,
  kmRangeFromSegment,
  resolveResupplySegmentEndingAtZone,
} from "../../planning/resupplySegments";
import { useRouteWorkspaceSelection } from "../../planning/useRouteWorkspaceSelection";
import { presentSuggestedStops, suggestedStopCount } from "../../planning/suggestedStops";
import { verificationProgress } from "../../planning/stopVerification/priority";
import RouteSummaryStrip from "../RouteSummaryStrip";
import { useSettings } from "../../settings/SettingsContext";
import { useRace } from "../../races/RaceContext";
import { findNearestTrackIndex } from "../routeUtils";
import ElevationProfile from "../ElevationProfile";
import MultiLayerTimeline from "../MultiLayerTimeline";
import RouteInspector from "../RouteInspector";
import RouteMap from "../RouteMap";
import CandidateContextSummary from "./CandidateContextSummary";
import PlanningDetailSheet from "../planning/PlanningDetailSheet";
import PoiDebugPanel from "../planning/PoiDebugPanel";
import ClimbDebugPanel from "../planning/ClimbDebugPanel";
import ResupplyHubDetailContent from "../resupply/ResupplyHubDetailContent";
import { nearbyPoiDebugEntries } from "../../planning/poiDebug";
import { buildClimbDebugContext } from "../../planning/climbDebug";
import { significantClimbs } from "@shared/race/significantClimbs";
import { activePoint, computeRouteInsights } from "../routeInsights";
import { usePlanningAssumptions } from "../../planning/usePlanningAssumptions";
import ResupplySegmentSummary from "./ResupplySegmentSummary";
import SuggestedStopsReviewPanel from "./SuggestedStopsReviewPanel";
import DiscoverStopsControls from "../discovery/DiscoverStopsControls";
import DiscoverCandidateDetail from "../discovery/DiscoverCandidateDetail";
import { buildPromoteRecord, useDiscoverStops } from "../../planning/useDiscoverStops";
import { poiRowToDiscoverInput } from "../../planning/discoverStopsAdapter";
import { buildPromotedSuggestedStop } from "@shared/race/promoteDiscoverStop";
import { promoteDiscoveredStop } from "../../races/api";

interface RouteWorkspaceProps {
  result: RoadbookResult;
}

export default function RouteWorkspace({ result }: RouteWorkspaceProps) {
  useRenderTrace("render.route.start", "render.route.done");
  const {
    overlay,
    setOverlay,
    timeMode,
    timelineLayers,
    selectedSurfaceType,
    setSelectedSurfaceType,
    planningIntent,
    consumePlanningIntent,
  } = usePlanning();
  const { settings } = useSettings();
  const developerMode = settings?.planning.developer_mode_enabled ?? false;
  const { stageSettings, arrivalTimeWindow } = usePlanningAssumptions();
  const { verifiedStops, saveVerifiedStop, setRoadbook, activeRaceId } = useRace();
  const [poiDebugMode, setPoiDebugMode] = useState(false);
  const [climbDebugMode, setClimbDebugMode] = useState(false);
  const [poiDebugClick, setPoiDebugClick] = useState<{ lat: number; lon: number } | null>(null);
  const [poiDebugSelection, setPoiDebugSelection] = useState<import("../../api").PoiDebugRow | null>(
    null,
  );
  const [climbDebugClick, setClimbDebugClick] = useState<{ lat: number; lon: number } | null>(null);

  const presentedZones = useMemo(
    () => presentSuggestedStops(result, timeMode),
    [result, timeMode],
  );

  const verifyProgress = useMemo(
    () => verificationProgress(presentedZones, verifiedStops),
    [presentedZones, verifiedStops],
  );

  const sortedClimbs = useMemo(
    () => significantClimbs([...result.climbs]).sort((left, right) => left.start_km - right.start_km),
    [result.climbs],
  );

  const poiDebugNearby = useMemo(() => {
    if (!poiDebugClick) {
      return [];
    }
    return nearbyPoiDebugEntries(result.poi_debug ?? [], poiDebugClick.lat, poiDebugClick.lon);
  }, [poiDebugClick, result.poi_debug]);

  const climbDebugContext = useMemo(() => {
    if (!climbDebugClick) {
      return null;
    }
    return buildClimbDebugContext(
      result.route.track_points,
      result.climbs,
      result.climb_candidates ?? [],
      climbDebugClick.lat,
      climbDebugClick.lon,
    );
  }, [climbDebugClick, result.climb_candidates, result.climbs, result.route.track_points]);

  const selection = useRouteWorkspaceSelection(result, presentedZones, verifiedStops);

  const handlePromoteVerified = useCallback(
    async (zoneId: number, poi: import("../../api").PoiRow) => {
      const promoted = buildPromotedSuggestedStop(poiRowToDiscoverInput(poi));
      const record = buildPromoteRecord(poi);

      if (activeRaceId) {
        const roadbook = await promoteDiscoveredStop(activeRaceId, {
          suggestedStop: promoted,
          verifiedStop: { zoneId, record },
        });
        setRoadbook(roadbook);
        await saveVerifiedStop(zoneId, record);
      } else {
        setRoadbook((current) =>
          current
            ? {
                ...current,
                suggested_stops: [
                  ...(current.suggested_stops ?? []).filter(
                    (stop) =>
                      !(
                        stop.osm_id === promoted.osm_id && stop.osm_type === promoted.osm_type
                      ) && stop.zone_id !== promoted.zone_id,
                  ),
                  promoted,
                ].sort((left, right) => left.distance_along_km - right.distance_along_km),
              }
            : current,
        );
        await saveVerifiedStop(zoneId, record);
      }
    },
    [activeRaceId, saveVerifiedStop, setRoadbook],
  );

  const discovery = useDiscoverStops({
    pois: result.pois,
    trackPoints: result.route.track_points,
    presentedZones,
    climbs: result.climbs,
    onSelectPoi: selection.handleSelectPoi,
    onPromoteVerified: handlePromoteVerified,
  });

  const hoverHighlightKmRange = useMemo(() => {
    if (selection.hoveredZoneId === null) {
      return null;
    }
    const zone = presentedZones.find((item) => item.zone_id === selection.hoveredZoneId);
    if (!zone) {
      return null;
    }
    return kmRangeFromSegment(
      resolveResupplySegmentEndingAtZone(zone, presentedZones, verifiedStops),
    );
  }, [selection.hoveredZoneId, presentedZones, verifiedStops]);

  const highlightKmRange = selection.kmRange ?? hoverHighlightKmRange;

  const activeSegmentSummary = useMemo(() => {
    if (!selection.kmRange) {
      return null;
    }
    const endZone =
      presentedZones.find((zone) => Math.abs(zone.distance_along_km - selection.kmRange!.endKm) < 0.05) ??
      presentedZones.find((zone) => zone.zone_id === selection.selectedZoneId) ??
      null;
    const segment = endZone
      ? resolveResupplySegmentEndingAtZone(endZone, presentedZones, verifiedStops)
      : {
          startKm: selection.kmRange.startKm,
          endKm: selection.kmRange.endKm,
          label: selection.kmRange.label,
          endZoneId: -1,
          endZoneName: selection.kmRange.label,
          startZoneName: null,
        };
    return buildResupplySegmentSummary(segment, result.route, result.resupply_zones, verifiedStops);
  }, [
    selection.kmRange,
    selection.selectedZoneId,
    presentedZones,
    verifiedStops,
    result.route,
    result.resupply_zones,
  ]);

  const effectiveLayers = useMemo(
    () => ({
      climbs: true,
      rejectedClimbs: developerMode && timelineLayers.rejectedClimbs,
      surface: false,
      food: false,
      water: false,
      resupply: false,
      dangerous: false,
    }),
    [developerMode, timelineLayers.rejectedClimbs],
  );

  const insights = useMemo(
    () => computeRouteInsights(presentedZones, result.route, result.summary.distance_km),
    [presentedZones, result.route, result.summary.distance_km],
  );

  const briefingHighlights = useMemo(
    () => buildRouteHighlights(result.climbs, presentedZones, result.route, result.summary.distance_km),
    [result.climbs, presentedZones, result.route, result.summary.distance_km],
  );

  const inspectorPoint = activePoint(result.route.track_points, selection.activeIndex);

  const applyHighlight = useCallback(
    (highlight: RouteHighlight) => {
      applyBriefingHighlight(highlight, result, presentedZones, result.summary.distance_km, {
        onSelectClimb: selection.handleSelectClimb,
        onSelectKmRange: selection.handleSelectKmRange,
        onSelectSurface: setSelectedSurfaceType,
        onClearEntitySelection: selection.handleClearEntitySelection,
        setActiveIndex: selection.setActiveIndex,
      });
    },
    [presentedZones, result, selection, setSelectedSurfaceType],
  );

  useEffect(() => {
    if (!planningIntent) {
      return;
    }

    if (planningIntent.type === "briefing-highlight") {
      const highlight = briefingHighlights.find((item) => item.id === planningIntent.highlightId);
      if (highlight) {
        applyHighlight(highlight);
      }
      consumePlanningIntent();
      return;
    }

    if (planningIntent.type === "select-climb") {
      selection.handleSelectClimb(planningIntent.climbId);
      consumePlanningIntent();
      return;
    }

    if (planningIntent.type === "select-km-range") {
      selection.handleSelectKmRange({
        startKm: planningIntent.startKm,
        endKm: planningIntent.endKm,
        label: planningIntent.label,
      });
      if (planningIntent.surfaceCategory) {
        setSelectedSurfaceType(planningIntent.surfaceCategory);
      }
      consumePlanningIntent();
      return;
    }

    if (planningIntent.type === "surface-explore") {
      setOverlay("surface");
      if (planningIntent.surfaceCategory) {
        setSelectedSurfaceType(planningIntent.surfaceCategory);
      } else {
        setSelectedSurfaceType(null);
      }
      if (planningIntent.startKm !== undefined && planningIntent.endKm !== undefined) {
        selection.handleSelectKmRange({
          startKm: planningIntent.startKm,
          endKm: planningIntent.endKm,
          label: planningIntent.label ?? "Surface section",
        });
      } else {
        selection.handleClearEntitySelection();
      }
      consumePlanningIntent();
      return;
    }

    if (planningIntent.type === "jump-km") {
      selection.handleClearEntitySelection();
      selection.setActiveIndex(findNearestTrackIndex(result.route.track_points, planningIntent.km));
      consumePlanningIntent();
    }
  }, [
    planningIntent,
    briefingHighlights,
    applyHighlight,
    consumePlanningIntent,
    selection,
    setSelectedSurfaceType,
    setOverlay,
    result.route.track_points,
  ]);

  const selectedCandidate =
    selection.selectedCandidateId !== null
      ? (result.climb_candidates ?? []).find(
          (candidate) => candidate.candidate_id === selection.selectedCandidateId,
        ) ?? null
      : null;

  const hubSheetTitle =
    selection.detailSelection?.kind === "zone"
      ? selection.detailSelection.zone.name
      : selection.detailSelection?.kind === "poi"
        ? selection.detailSelection.poi.name ??
          selection.detailSelection.poi.brand ??
          "Stop detail"
        : "Stop detail";

  function handleSelectPoiFromSheet(poi: import("../../api").ZonePoiOption) {
    const zone =
      selection.detailSelection?.kind === "zone"
        ? selection.detailSelection.zone
        : selection.detailSelection?.zone ?? null;
    selection.handleSelectPoi({ kind: "poi", poi, zone });
  }

  function handleBackToZoneFromSheet() {
    if (selection.detailSelection?.kind === "poi" && selection.detailSelection.zone) {
      selection.handleSelectZone(selection.detailSelection.zone.zone_id);
    }
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-7.5rem)] max-w-[1600px] flex-col lg:flex-row lg:px-0">
      <SuggestedStopsReviewPanel
        zones={presentedZones}
        result={result}
        selectedZoneId={selection.selectedZoneId}
        onSelectZone={selection.handleSelectZone}
        onFocusOnMap={selection.handleFocusZoneOnMap}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-5 py-4 lg:px-6">
        <header className="relative shrink-0 space-y-3 pb-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-xl font-semibold tracking-tight text-ink">Plan route</h2>
            <p className="text-sm text-muted">{result.summary.route_name}</p>
          </div>

          <RouteSummaryStrip
            distanceKm={result.summary.distance_km}
            elevationGainM={result.summary.elevation_gain_m}
            climbCount={result.summary.climb_count}
            suggestedStopCount={suggestedStopCount(result)}
            verifiedPercent={verifyProgress.verifiedPercent}
            insights={insights}
          />

          {developerMode && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setPoiDebugMode((current) => !current);
                  setClimbDebugMode(false);
                  setPoiDebugClick(null);
                  setPoiDebugSelection(null);
                  setClimbDebugClick(null);
                }}
                className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                  poiDebugMode
                    ? "bg-accent/10 text-accent"
                    : "bg-canvas text-muted hover:text-ink"
                }`}
              >
                {poiDebugMode ? "POI debug on" : "POI debug"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setClimbDebugMode((current) => !current);
                  setPoiDebugMode(false);
                  setPoiDebugClick(null);
                  setPoiDebugSelection(null);
                  setClimbDebugClick(null);
                }}
                className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                  climbDebugMode
                    ? "bg-accent/10 text-accent"
                    : "bg-canvas text-muted hover:text-ink"
                }`}
              >
                {climbDebugMode ? "Climb debug on" : "Climb debug"}
              </button>
            </div>
          )}
        </header>

        <>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
              <div className="relative min-h-[280px] flex-1">
              <RouteMap
                route={result.route}
                zones={presentedZones}
                climbs={sortedClimbs}
                rejectedClimbs={result.climb_candidates ?? []}
                showRejectedClimbs={developerMode && timelineLayers.rejectedClimbs}
                zoneDensity="planning"
                overlay={overlay}
                timeMode={timeMode}
                arrivalTimeWindow={arrivalTimeWindow}
                selectedSurfaceType={selectedSurfaceType}
                activeIndex={selection.activeIndex}
                selectedZoneId={selection.selectedZoneId}
                selectedClimbId={selection.selectedClimbId}
                selectedCandidateId={selection.selectedCandidateId}
                highlightKmRange={highlightKmRange}
                focusKmRange={selection.mapFocusKmRange}
                fillHeight
                onActiveIndexChange={selection.setActiveIndex}
                onSelectZone={selection.handleSelectZone}
                onHoverZone={selection.handleHoverZone}
                onSelectClimb={selection.handleSelectClimb}
                onSelectCandidate={selection.handleSelectCandidate}
                onSelectPoi={selection.handleSelectPoi}
                poiDebugMode={poiDebugMode}
                climbDebugMode={climbDebugMode}
                onPoiDebugClick={(lat, lon) => {
                  setPoiDebugClick({ lat, lon });
                  const nearby = nearbyPoiDebugEntries(result.poi_debug ?? [], lat, lon);
                  setPoiDebugSelection(nearby[0]?.entry ?? null);
                }}
                onClimbDebugClick={(lat, lon) => {
                  setClimbDebugClick({ lat, lon });
                }}
                discoverCandidates={discovery.candidates}
                selectedDiscoverKey={discovery.selectedCandidateKey}
                onDiscoverBoundsChange={discovery.handleBoundsChange}
                onSelectDiscoverCandidate={(candidate) =>
                  discovery.selectCandidate(poiOsmKey(candidate.osmType, candidate.osmId))
                }
                roadbookResult={result}
              />
              <div className="pointer-events-none absolute bottom-4 right-4 z-[1000]">
                <DiscoverStopsControls
                  loading={discovery.loading}
                  resultMessage={discovery.resultMessage}
                  onFindStops={discovery.findStops}
                />
              </div>
              {discovery.selectedCandidate && (
                <DiscoverCandidateDetail
                  candidate={discovery.selectedCandidate}
                  verifying={discovery.promoting}
                  onVerify={() => discovery.verifyCandidate(discovery.selectedCandidate!)}
                  onSkip={() => discovery.skipCandidate(discovery.selectedCandidate!)}
                />
              )}
              {poiDebugMode && (
                <PoiDebugPanel
                  entries={poiDebugNearby}
                  selectedEntry={poiDebugSelection}
                  clickLatLng={poiDebugClick}
                  onSelectEntry={setPoiDebugSelection}
                  onClose={() => {
                    setPoiDebugClick(null);
                    setPoiDebugSelection(null);
                  }}
                />
              )}
              {climbDebugMode && (
                <ClimbDebugPanel
                  context={climbDebugContext}
                  onClose={() => {
                    setClimbDebugClick(null);
                  }}
                />
              )}
            </div>

              <ElevationProfile
                route={result.route}
                points={result.route.track_points}
                zones={presentedZones}
                climbs={sortedClimbs}
                rejectedClimbs={result.climb_candidates ?? []}
                layers={effectiveLayers}
                totalKm={result.summary.distance_km}
                overlay={overlay}
                timeMode={timeMode}
                selectedSurfaceType={selectedSurfaceType}
                maxGapThresholdKm={stageSettings.maxGapWithoutResupplyKm}
                activeIndex={selection.activeIndex}
                selectedZoneId={selection.selectedZoneId}
                selectedClimbId={selection.selectedClimbId}
                selectedCandidateId={selection.selectedCandidateId}
                highlightKmRange={highlightKmRange}
                onHoverIndex={selection.setActiveIndex}
                onSelectZone={selection.handleSelectZone}
                onHoverZone={selection.handleHoverZone}
                onSelectClimb={selection.handleSelectClimb}
                onSelectCandidate={selection.handleSelectCandidate}
                onSelectSurfaceType={setSelectedSurfaceType}
              />

              {activeSegmentSummary && (
                <ResupplySegmentSummary
                  summary={activeSegmentSummary}
                  compact
                  onFocusOnMap={selection.handleFocusKmRangeOnMap}
                  onClear={
                    selection.kmRange ? selection.handleClearEntitySelection : undefined
                  }
                />
              )}

              {developerMode && (
                <>
                  <RouteInspector
                    point={inspectorPoint}
                    zones={presentedZones}
                    overlay={overlay}
                    timeMode={timeMode}
                    route={result.route}
                  />

                  <MultiLayerTimeline
                    totalKm={result.summary.distance_km}
                    route={result.route}
                    trackPoints={result.route.track_points}
                    zones={presentedZones}
                    climbs={sortedClimbs}
                    rejectedClimbs={result.climb_candidates ?? []}
                    layers={effectiveLayers}
                    selectedZoneId={selection.selectedZoneId}
                    selectedClimbId={selection.selectedClimbId}
                    selectedSurfaceType={selectedSurfaceType}
                    activeIndex={selection.activeIndex}
                    highlightKmRange={highlightKmRange}
                    maxGapThresholdKm={stageSettings.maxGapWithoutResupplyKm}
                    onHoverIndex={selection.setActiveIndex}
                    onSelectZone={selection.handleSelectZone}
                    onHoverZone={selection.handleHoverZone}
                    onSelectClimb={selection.handleSelectClimb}
                    onSelectSurfaceType={setSelectedSurfaceType}
                    onSelectKmRange={selection.handleSelectKmRange}
                    onSelectCandidate={selection.handleSelectCandidate}
                  />
                </>
              )}
            </div>

          <PlanningDetailSheet
            open={selection.detailSelection !== null}
            title={hubSheetTitle}
            subtitle="Resupply stop"
            onClose={selection.handleCloseDetail}
          >
            {selection.detailSelection && activeSegmentSummary && (
              <div className="mb-5">
                <ResupplySegmentSummary summary={activeSegmentSummary} compact />
              </div>
            )}
            {selection.detailSelection && (
              <ResupplyHubDetailContent
                selection={selection.detailSelection}
                route={result.route}
                timeWindowId={arrivalTimeWindow}
                timeMode={timeMode}
                onSelectPoi={handleSelectPoiFromSheet}
                onBackToZone={
                  selection.detailSelection.kind === "poi" && selection.detailSelection.zone
                    ? handleBackToZoneFromSheet
                    : undefined
                }
              />
            )}
          </PlanningDetailSheet>

          <PlanningDetailSheet
            open={selectedCandidate !== null}
            title={selectedCandidate?.rejection_label ?? "Rejected climb"}
            subtitle="Climb candidate"
            onClose={selection.handleClearEntitySelection}
          >
            {selectedCandidate && (
              <CandidateContextSummary
                candidate={selectedCandidate}
                onClose={selection.handleClearEntitySelection}
              />
            )}
          </PlanningDetailSheet>
        </>
      </div>
    </div>
  );
}
