import { useCallback, useMemo, useState } from "react";
import { collectAllBundlePois } from "@shared/race/bundlePois";
import {
  DISCOVERY_MAX_RESULTS,
  discoverStopIcon,
  discoverStopsInBounds,
  poiOsmKey,
  type DiscoverCandidate,
  type DiscoverClimbRange,
  type MapBounds,
} from "@shared/race/discoverStops";
import type { CompanionBundle, CompanionStop } from "@shared/types/sync";
import {
  discoverPoisFromBundle,
  primaryPoiKeysFromBundle,
  trackPointsFromBundle,
} from "./discoverStopsAdapter";

interface UseDiscoverStopsOptions {
  bundle: CompanionBundle;
  onSelectStop: (stop: CompanionStop) => void;
}

function formatResultMessage(count: number): string {
  if (count === 0) {
    return "No promising stops in this area";
  }
  return `Found ${count} promising stop${count === 1 ? "" : "s"}`;
}

export function candidateToCompanionStop(
  bundle: CompanionBundle,
  candidate: DiscoverCandidate,
): CompanionStop | null {
  const match = collectAllBundlePois(bundle).find(
    (entry) =>
      entry.stop.osmId === candidate.osmId && entry.stop.osmType === candidate.osmType,
  );
  if (match) {
    return match.stop;
  }

  const zoneId = candidate.zoneId ?? bundle.stops[0]?.zoneId;
  if (zoneId == null) {
    return null;
  }

  return {
    poiId: `poi_${candidate.osmId}`,
    zoneId,
    osmId: candidate.osmId,
    osmType: candidate.osmType,
    km: candidate.distanceAlongKm,
    lat: candidate.lat,
    lon: candidate.lon,
    name: candidate.name?.trim() || candidate.brand?.trim() || "Resupply",
    category: candidate.category,
    categoryLabel: candidate.category,
    icon: candidate.icon || discoverStopIcon(candidate.category),
    distanceOffRouteM: candidate.distanceOffRouteM,
    confidenceScore: candidate.score,
    verificationStatus: "unverified",
    openingHours: candidate.openingHours ?? null,
    notes: null,
    hasFood: candidate.services.includes("Food"),
    hasWater: candidate.services.includes("Water"),
    hasFuel: candidate.services.includes("Fuel"),
    hasCoffee: candidate.category === "Café" || candidate.category === "Restaurant",
  };
}

export function useDiscoverStops({ bundle, onSelectStop }: UseDiscoverStopsOptions) {
  const [loading, setLoading] = useState(false);
  const [bounds, setBounds] = useState<MapBounds | null>(null);
  const [candidates, setCandidates] = useState<DiscoverCandidate[]>([]);
  const [selectedCandidateKey, setSelectedCandidateKey] = useState<string | null>(null);
  const [verifiedKeys, setVerifiedKeys] = useState<Set<string>>(() => new Set());
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  const discoverInputs = useMemo(() => discoverPoisFromBundle(bundle), [bundle]);
  const trackInputs = useMemo(() => trackPointsFromBundle(bundle), [bundle]);
  const existingStopKms = useMemo(() => bundle.stops.map((stop) => stop.km), [bundle.stops]);
  const primaryKeys = useMemo(() => primaryPoiKeysFromBundle(bundle), [bundle]);
  const climbRanges = useMemo<DiscoverClimbRange[]>(
    () =>
      (bundle.climbs ?? []).map((climb) => ({
        startKm: climb.startKm,
        endKm: climb.endKm,
      })),
    [bundle.climbs],
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

  const openCandidate = useCallback(
    (candidate: DiscoverCandidate) => {
      const stop = candidateToCompanionStop(bundle, candidate);
      if (stop) {
        onSelectStop(stop);
      }
    },
    [bundle, onSelectStop],
  );

  const handleStopVerified = useCallback(
    (stop: CompanionStop) => {
      if (stop.osmId == null || !stop.osmType) {
        return;
      }
      const key = poiOsmKey(stop.osmType, stop.osmId);
      setVerifiedKeys((current) => new Set([...current, key]));
      setCandidates((current) =>
        current.filter((item) => poiOsmKey(item.osmType, item.osmId) !== key),
      );
      setSelectedCandidateKey((current) => (current === key ? null : current));
    },
    [],
  );

  const handleStopSkipped = useCallback(
    (stop: CompanionStop) => {
      if (stop.osmId == null || !stop.osmType) {
        return;
      }
      const key = poiOsmKey(stop.osmType, stop.osmId);
      if (!candidates.some((item) => poiOsmKey(item.osmType, item.osmId) === key)) {
        return;
      }
      setCandidates((current) =>
        current.filter((item) => poiOsmKey(item.osmType, item.osmId) !== key),
      );
      setSelectedCandidateKey((current) => (current === key ? null : current));
    },
    [candidates],
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
    hasResults: candidates.length > 0,
    findStops,
    handleBoundsChange,
    selectCandidate: setSelectedCandidateKey,
    openCandidate,
    skipCandidate,
    handleStopVerified,
    handleStopSkipped,
    isDiscoveryCandidate,
  };
}
