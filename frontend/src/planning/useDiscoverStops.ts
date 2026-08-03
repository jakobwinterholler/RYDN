import { useCallback, useMemo, useState } from "react";
import type { ClimbRow, PoiRow, ResupplyZone, TrackPoint } from "../api";
import {
  DISCOVERY_MAX_RESULTS,
  discoverStopsInBounds,
  poiOsmKey,
  type DiscoverCandidate,
  type DiscoverClimbRange,
  type MapBounds,
} from "@shared/race/discoverStops";
import { findZoneForPoi, poiKey, type StopSelection } from "./stopSelection";
import { nearestZoneAtKm } from "../components/routeInsights";
import {
  poiRowToDiscoverInput,
  primaryPoiKeysFromZones,
  trackPointToDiscoverInput,
} from "./discoverStopsAdapter";
import type { VerifiedStopRecord } from "./stopVerification/types";

interface UseDiscoverStopsOptions {
  pois: PoiRow[];
  trackPoints: TrackPoint[];
  presentedZones: ResupplyZone[];
  climbs?: ClimbRow[];
  onSelectPoi: (selection: StopSelection) => void;
  onPromoteVerified?: (zoneId: number, poi: PoiRow) => Promise<void>;
}

function formatResultMessage(count: number): string {
  if (count === 0) {
    return "No promising stops in this area";
  }
  return `Found ${count} promising stop${count === 1 ? "" : "s"}`;
}

function resolveZoneForDiscovery(
  candidate: DiscoverCandidate,
  poiRow: PoiRow,
  presentedZones: ResupplyZone[],
): ResupplyZone | null {
  return (
    findZoneForPoi(presentedZones, poiRow) ??
    (poiRow.zone_id != null
      ? presentedZones.find((entry) => entry.zone_id === poiRow.zone_id) ?? null
      : null) ??
    (candidate.zoneId != null
      ? presentedZones.find((entry) => entry.zone_id === candidate.zoneId) ?? null
      : null) ??
    nearestZoneAtKm(presentedZones, candidate.distanceAlongKm)
  );
}

export function useDiscoverStops({
  pois,
  trackPoints,
  presentedZones,
  climbs = [],
  onSelectPoi,
  onPromoteVerified,
}: UseDiscoverStopsOptions) {
  const [loading, setLoading] = useState(false);
  const [bounds, setBounds] = useState<MapBounds | null>(null);
  const [candidates, setCandidates] = useState<DiscoverCandidate[]>([]);
  const [selectedCandidateKey, setSelectedCandidateKey] = useState<string | null>(null);
  const [verifiedKeys, setVerifiedKeys] = useState<Set<string>>(() => new Set());
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [promoting, setPromoting] = useState(false);

  const discoverInputs = useMemo(() => pois.map(poiRowToDiscoverInput), [pois]);
  const trackInputs = useMemo(
    () => trackPoints.map(trackPointToDiscoverInput),
    [trackPoints],
  );
  const existingStopKms = useMemo(
    () => presentedZones.map((zone) => zone.distance_along_km),
    [presentedZones],
  );
  const primaryKeys = useMemo(
    () => primaryPoiKeysFromZones(presentedZones),
    [presentedZones],
  );
  const climbRanges = useMemo<DiscoverClimbRange[]>(
    () => climbs.map((climb) => ({ startKm: climb.start_km, endKm: climb.end_km })),
    [climbs],
  );

  const findStops = useCallback(() => {
    if (!bounds) {
      return;
    }
    setLoading(true);
    setCandidates([]);
    setSelectedCandidateKey(null);
    setResultMessage(null);

    const result = discoverStopsInBounds({
      pois: discoverInputs,
      bounds,
      trackPoints: trackInputs,
      existingStopKms,
      primaryPoiKeys: primaryKeys,
      dismissedPoiKeys: new Set(),
      verifiedPoiKeys: verifiedKeys,
      climbRanges,
      limit: DISCOVERY_MAX_RESULTS,
    });

    setCandidates(result.candidates);
    setResultMessage(formatResultMessage(result.candidates.length));
    setLoading(false);
  }, [
    bounds,
    climbRanges,
    discoverInputs,
    existingStopKms,
    primaryKeys,
    trackInputs,
    verifiedKeys,
  ]);

  const handleBoundsChange = useCallback((nextBounds: MapBounds) => {
    setBounds(nextBounds);
  }, []);

  const selectedCandidate = useMemo(
    () =>
      candidates.find(
        (candidate) => poiOsmKey(candidate.osmType, candidate.osmId) === selectedCandidateKey,
      ) ?? null,
    [candidates, selectedCandidateKey],
  );

  const skipCandidate = useCallback((candidate: DiscoverCandidate) => {
    const key = poiOsmKey(candidate.osmType, candidate.osmId);
    setCandidates((current) =>
      current.filter((item) => poiOsmKey(item.osmType, item.osmId) !== key),
    );
    setSelectedCandidateKey((current) => (current === key ? null : current));
  }, []);

  const verifyCandidate = useCallback(
    async (candidate: DiscoverCandidate) => {
      setPromoting(true);
      try {
        const poiRow = pois.find(
          (poi) => poi.osm_id === candidate.osmId && poi.osm_type === candidate.osmType,
        );
        if (!poiRow) {
          return;
        }
        const key = poiOsmKey(candidate.osmType, candidate.osmId);
        const zone = resolveZoneForDiscovery(candidate, poiRow, presentedZones);
        const zoneId = poiRow.zone_id ?? candidate.zoneId ?? zone?.zone_id;
        if (zoneId == null) {
          return;
        }

        const zoneForSelection =
          zone ??
          presentedZones.find((entry) => entry.zone_id === zoneId) ??
          null;
        onSelectPoi({ kind: "poi", poi: poiRow, zone: zoneForSelection });

        if (onPromoteVerified) {
          await onPromoteVerified(zoneId, poiRow);
        }

        setVerifiedKeys((current) => new Set([...current, key]));
        setCandidates((current) =>
          current.filter((item) => poiOsmKey(item.osmType, item.osmId) !== key),
        );
        setSelectedCandidateKey((current) => (current === key ? null : current));
      } finally {
        setPromoting(false);
      }
    },
    [onPromoteVerified, onSelectPoi, pois, presentedZones],
  );

  const isDiscoveryCandidate = useCallback(
    (osmId: number | undefined, osmType: string | undefined): boolean => {
      if (osmId == null || !osmType) {
        return false;
      }
      const key = poiOsmKey(osmType, osmId);
      return candidates.some((item) => poiOsmKey(item.osmType, item.osmId) === key);
    },
    [candidates],
  );

  return {
    loading,
    candidates,
    selectedCandidate,
    selectedCandidateKey,
    resultMessage,
    promoting,
    hasResults: candidates.length > 0,
    findStops,
    handleBoundsChange,
    selectCandidate: setSelectedCandidateKey,
    skipCandidate,
    verifyCandidate,
    isDiscoveryCandidate,
  };
}

export function buildPromoteRecord(poi: PoiRow): VerifiedStopRecord {
  return {
    status: "verified",
    poiKey: poiKey(poi),
    updatedAt: new Date().toISOString(),
  };
}
