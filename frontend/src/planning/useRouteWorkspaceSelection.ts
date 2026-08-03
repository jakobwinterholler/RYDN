import { useCallback, useMemo, useState } from "react";
import type { RoadbookResult, ResupplyZone, TrackPoint } from "../api";
import type { DecisionPanelView } from "./decisionPanel";
import { analyzeClimbs, selectKeyClimbs } from "./climbAnalysis";
import type { StopSelection } from "./stopSelection";
import {
  kmRangeFromSegment,
  resolveResupplySegmentEndingAtZone,
} from "./resupplySegments";
import type { VerifiedStopRecord } from "./stopVerification/types";
import { findNearestTrackIndex } from "../components/routeUtils";

export interface KmRangeSelection {
  startKm: number;
  endKm: number;
  label: string;
}

export interface RouteWorkspaceSelection {
  activeIndex: number | null;
  selectedZoneId: number | null;
  selectedClimbId: string | null;
  selectedCandidateId: string | null;
  detailSelection: StopSelection;
  kmRange: KmRangeSelection | null;
  hoveredZoneId: number | null;
  decisionPanelView: DecisionPanelView;
  hasEntitySelection: boolean;
  handleSelectZone: (zoneId: number) => void;
  handleHoverZone: (zoneId: number | null) => void;
  handleSelectClimb: (climbId: string) => void;
  handleSelectCandidate: (candidateId: string) => void;
  handleSelectPoi: (selection: StopSelection) => void;
  handleSelectKmRange: (range: KmRangeSelection) => void;
  handleFocusKmRangeOnMap: () => void;
  handleFocusZoneOnMap: (zoneId: number) => void;
  mapFocusKmRange: KmRangeSelection | null;
  handleCloseDetail: () => void;
  handleClearEntitySelection: () => void;
  setActiveIndex: (index: number | null) => void;
}

function clearEntityState() {
  return {
    selectedZoneId: null as number | null,
    selectedClimbId: null as string | null,
    selectedCandidateId: null as string | null,
    detailSelection: null as StopSelection,
    kmRange: null as KmRangeSelection | null,
  };
}

export function useRouteWorkspaceSelection(
  result: RoadbookResult,
  presentedZones: ResupplyZone[],
  verifiedStops: Record<string, VerifiedStopRecord>,
): RouteWorkspaceSelection {
  const trackPoints = result.route.track_points;

  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [selectedZoneId, setSelectedZoneId] = useState<number | null>(null);
  const [selectedClimbId, setSelectedClimbId] = useState<string | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [detailSelection, setDetailSelection] = useState<StopSelection>(null);
  const [kmRange, setKmRange] = useState<KmRangeSelection | null>(null);
  const [mapFocusKmRange, setMapFocusKmRange] = useState<KmRangeSelection | null>(null);
  const [hoveredZoneId, setHoveredZoneId] = useState<number | null>(null);

  const jumpToKm = useCallback(
    (km: number) => {
      setActiveIndex(findNearestTrackIndex(trackPoints, km));
    },
    [trackPoints],
  );

  const handleClearEntitySelection = useCallback(() => {
    const cleared = clearEntityState();
    setSelectedZoneId(cleared.selectedZoneId);
    setSelectedClimbId(cleared.selectedClimbId);
    setSelectedCandidateId(cleared.selectedCandidateId);
    setDetailSelection(cleared.detailSelection);
    setKmRange(cleared.kmRange);
    setHoveredZoneId(null);
  }, []);

  const handleHoverZone = useCallback((zoneId: number | null) => {
    setHoveredZoneId(zoneId);
  }, []);

  const handleSelectZone = useCallback(
    (zoneId: number) => {
      const zone = presentedZones.find((item) => item.zone_id === zoneId);
      if (!zone) {
        return;
      }
      setSelectedClimbId(null);
      setSelectedCandidateId(null);
      const segment = resolveResupplySegmentEndingAtZone(zone, presentedZones, verifiedStops);
      setKmRange(kmRangeFromSegment(segment));
      setSelectedZoneId(zoneId);
      setDetailSelection({ kind: "zone", zone });
      setHoveredZoneId(null);
      jumpToKm(zone.distance_along_km);
    },
    [presentedZones, verifiedStops, jumpToKm],
  );

  const handleSelectClimb = useCallback(
    (climbId: string) => {
      const climb = result.climbs.find((item) => item.id === climbId);
      if (!climb) {
        return;
      }
      setSelectedZoneId(null);
      setDetailSelection(null);
      setSelectedCandidateId(null);
      setKmRange(null);
      setSelectedClimbId(climbId);
      jumpToKm((climb.start_km + climb.end_km) / 2);
    },
    [result.climbs, jumpToKm],
  );

  const handleSelectCandidate = useCallback(
    (candidateId: string) => {
      const candidate = result.climb_candidates?.find((item) => item.candidate_id === candidateId);
      if (!candidate) {
        return;
      }
      setSelectedZoneId(null);
      setDetailSelection(null);
      setSelectedClimbId(null);
      setKmRange(null);
      setSelectedCandidateId(candidateId);
      jumpToKm((candidate.start_km + candidate.end_km) / 2);
    },
    [result.climb_candidates, jumpToKm],
  );

  const handleSelectPoi = useCallback(
    (selection: StopSelection) => {
      if (selection?.kind !== "poi") {
        return;
      }
      setSelectedClimbId(null);
      setSelectedCandidateId(null);
      setKmRange(null);
      setDetailSelection(selection);
      setSelectedZoneId(selection.zone?.zone_id ?? null);
      jumpToKm(selection.poi.distance_along_km);
    },
    [jumpToKm],
  );

  const handleSelectKmRange = useCallback(
    (range: KmRangeSelection) => {
      setSelectedZoneId(null);
      setDetailSelection(null);
      setSelectedClimbId(null);
      setSelectedCandidateId(null);
      setHoveredZoneId(null);
      setKmRange(range);
    },
    [],
  );

  const handleFocusKmRangeOnMap = useCallback(() => {
    if (kmRange) {
      setMapFocusKmRange({ ...kmRange });
    }
  }, [kmRange]);

  const handleFocusZoneOnMap = useCallback(
    (zoneId: number) => {
      const zone = presentedZones.find((item) => item.zone_id === zoneId);
      if (!zone) {
        return;
      }
      const segment = resolveResupplySegmentEndingAtZone(zone, presentedZones, verifiedStops);
      const range = kmRangeFromSegment(segment);
      setSelectedClimbId(null);
      setSelectedCandidateId(null);
      setKmRange(range);
      setSelectedZoneId(zoneId);
      setDetailSelection({ kind: "zone", zone });
      setHoveredZoneId(null);
      setMapFocusKmRange({ ...range });
      jumpToKm(zone.distance_along_km);
    },
    [presentedZones, verifiedStops, jumpToKm],
  );

  const handleCloseDetail = useCallback(() => {
    setDetailSelection(null);
    setSelectedZoneId(null);
    setKmRange(null);
  }, []);

  const decisionPanelView: DecisionPanelView = useMemo(() => {
    if (detailSelection?.kind === "poi" || detailSelection?.kind === "zone") {
      return { type: "stop", selection: detailSelection };
    }
    if (selectedClimbId) {
      return { type: "climb", climbId: selectedClimbId };
    }
    if (selectedCandidateId) {
      return { type: "candidate", candidateId: selectedCandidateId };
    }
    if (kmRange) {
      return {
        type: "section",
        startKm: kmRange.startKm,
        endKm: kmRange.endKm,
        label: kmRange.label,
      };
    }
    return { type: "idle" };
  }, [detailSelection, selectedClimbId, selectedCandidateId, kmRange]);

  const hasEntitySelection = decisionPanelView.type !== "idle";

  return {
    activeIndex,
    selectedZoneId,
    selectedClimbId,
    selectedCandidateId,
    detailSelection,
    kmRange,
    hoveredZoneId,
    mapFocusKmRange,
    decisionPanelView,
    hasEntitySelection,
    handleSelectZone,
    handleHoverZone,
    handleSelectClimb,
    handleSelectCandidate,
    handleSelectPoi,
    handleSelectKmRange,
    handleFocusKmRangeOnMap,
    handleFocusZoneOnMap,
    handleCloseDetail,
    handleClearEntitySelection,
    setActiveIndex,
  };
}

export function resolveBriefingHighlight(
  highlightId: string,
  result: RoadbookResult,
  zones: RoadbookResult["resupply_zones"],
  totalKm: number,
): {
  onSelectClimb?: string;
  onSelectKmRange?: KmRangeSelection;
  onSelectSurface?: string;
  onJumpKm?: number;
} | null {
  const analyzed = analyzeClimbs(result.climbs);
  const keyClimbs = selectKeyClimbs(analyzed);

  if (highlightId === "hardest-climb" && keyClimbs[0]) {
    return { onSelectClimb: keyClimbs[0].id };
  }

  if (highlightId === "longest-climb") {
    const longest = [...analyzed].sort((left, right) => right.length_km - left.length_km)[0];
    if (longest) {
      return { onSelectClimb: longest.id };
    }
  }

  if (highlightId === "food-gap" || highlightId === "water-gap") {
    const category = highlightId === "food-gap" ? "food" : "water";
    const sorted = zones
      .filter((zone) => zone.categories.some((item) => item.key === category && item.primary))
      .sort((left, right) => left.distance_along_km - right.distance_along_km);

    const gaps: KmRangeSelection[] = [];
    if (sorted.length === 0 && totalKm > 0) {
      gaps.push({ startKm: 0, endKm: totalKm, label: `Longest ${category} gap` });
    } else {
      if (sorted[0]) {
        gaps.push({
          startKm: 0,
          endKm: sorted[0].distance_along_km,
          label: `Longest ${category} gap`,
        });
      }
      for (let index = 0; index < sorted.length - 1; index += 1) {
        gaps.push({
          startKm: sorted[index].distance_along_km,
          endKm: sorted[index + 1].distance_along_km,
          label: `Longest ${category} gap`,
        });
      }
      const last = sorted[sorted.length - 1];
      if (last) {
        gaps.push({
          startKm: last.distance_along_km,
          endKm: totalKm,
          label: `Longest ${category} gap`,
        });
      }
    }

    const longest = gaps.reduce((best, gap) =>
      gap.endKm - gap.startKm > best.endKm - best.startKm ? gap : best,
    );
    return { onSelectKmRange: longest };
  }

  if (highlightId === "gravel-section") {
    const gravelSegments = result.route.surface_segments.filter(
      (segment) => (segment.rider_category ?? segment.surface) === "Gravel",
    );
    const longest = gravelSegments.reduce(
      (best, segment) => {
        const lengthKm = segment.end_km - segment.start_km;
        return lengthKm > best.endKm - best.startKm
          ? { startKm: segment.start_km, endKm: segment.end_km, label: "Longest gravel section" }
          : best;
      },
      { startKm: 0, endKm: 0, label: "Longest gravel section" },
    );
    if (longest.endKm > longest.startKm) {
      return { onSelectKmRange: longest, onSelectSurface: "Gravel" };
    }
  }

  if (highlightId === "highest-point") {
    let best: TrackPoint | null = null;
    for (const point of result.route.track_points) {
      if (point.ele_m === null) {
        continue;
      }
      if (!best || (best.ele_m ?? 0) < point.ele_m) {
        best = point;
      }
    }
    if (best) {
      return { onJumpKm: best.km };
    }
  }

  return null;
}
