import { useEffect, useMemo, useRef, useState } from "react";
import { useCompanion } from "../context/CompanionContext";
import type { CompanionClimb, CompanionStop } from "@shared/types/sync";
import ClimbSheet from "../components/ClimbSheet";
import DiscoverStopsControls from "../components/discovery/DiscoverStopsControls";
import MapControls from "../components/MapControls";
import NextVerifiedStopCard from "../components/NextVerifiedStopCard";
import ResupplyElevationProfile from "../components/ResupplyElevationProfile";
import RouteMapView, { type RouteMapHandle } from "../components/RouteMapView";
import StopSheet from "../components/StopSheet";
import { nextResupplyStop } from "../lib/raceExecution";
import { useDiscoverStops } from "../planning/useDiscoverStops";

interface RaceScreenProps {
  /**
   * Whether the Map tab is the one currently shown. The map itself stays mounted
   * across tab switches (kept alive), but the stop/climb sheets are driven by the
   * shared selected-stop context — which Resupply also renders a sheet for — so we
   * only render them here while Map is active to avoid a duplicate (hidden) sheet
   * and its mini-map/Street View work.
   */
  active?: boolean;
}

export default function RaceScreen({ active = true }: RaceScreenProps) {
  const {
    bundle,
    currentKm,
    selectedStop,
    selectStop,
    showUnverified,
    setShowUnverified,
    followGps,
    setFollowGps,
    gps,
  } = useCompanion();
  const mapRef = useRef<RouteMapHandle | null>(null);
  const [selectedClimb, setSelectedClimb] = useState<CompanionClimb | null>(null);
  const discovery = useDiscoverStops({
    bundle,
    onSelectStop: selectStop,
  });

  const nextStop = useMemo(
    () => nextResupplyStop(bundle, currentKm, false),
    [bundle, currentKm],
  );

  const gpsActive = gps.lat != null && gps.lon != null;
  const showClimbs = (bundle.climbs?.length ?? 0) > 0;

  useEffect(() => {
    if (selectedStop) {
      setFollowGps(false);
    }
  }, [selectedStop, setFollowGps]);

  function handleStopSheetClose() {
    selectStop(null);
  }

  function handleStopVerified(stop: CompanionStop) {
    if (discovery.isDiscoveryCandidate(stop.osmId, stop.osmType)) {
      discovery.handleStopVerified(stop);
    }
    handleStopSheetClose();
  }

  function handleStopSkipped(stop: CompanionStop) {
    if (discovery.isDiscoveryCandidate(stop.osmId, stop.osmType)) {
      discovery.handleStopSkipped(stop);
    }
    handleStopSheetClose();
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-2 border-b border-white/8 px-4 pb-3">
        <NextVerifiedStopCard bundle={bundle} currentKm={currentKm} compact />
        <ResupplyElevationProfile
          bundle={bundle}
          riderKm={currentKm}
          nextStopKm={nextStop?.km ?? null}
          viewportStartKm={Math.max(0, currentKm - 8)}
          viewportEndKm={Math.min(bundle.race.distanceKm, (nextStop?.km ?? currentKm + 12) + 2)}
        />
      </div>

      <div className="relative min-h-0 flex-1">
        <RouteMapView
          ref={mapRef}
          visible={active}
          showClimbs={showClimbs}
          focusStop={selectedStop}
          onClimbSelect={(climbId) => {
            const climb = bundle.climbs?.find((item) => item.id === climbId) ?? null;
            setSelectedClimb(climb);
          }}
          discoverCandidates={discovery.candidates}
          selectedDiscoverKey={discovery.selectedCandidateKey}
          onDiscoverBoundsChange={discovery.handleBoundsChange}
          onSelectDiscoverCandidate={(candidate) => discovery.openCandidate(candidate)}
        />

        {!selectedStop ? (
          <>
            <div className="pointer-events-none absolute left-3 top-3 z-10">
              <button
                type="button"
                onClick={() => setShowUnverified(!showUnverified)}
                aria-pressed={showUnverified}
                className={`pointer-events-auto flex min-h-[44px] items-center gap-2 rounded-full border px-3.5 text-xs font-medium backdrop-blur-xl transition-colors duration-200 ${
                  showUnverified
                    ? "border-violet-400/40 bg-violet-500/20 text-white"
                    : "border-white/10 bg-black/55 text-white/60"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full transition-colors duration-200 ${
                    showUnverified ? "bg-violet-300" : "bg-white/30"
                  }`}
                  aria-hidden
                />
                Suggested stops
              </button>
            </div>

            <MapControls
              followGps={followGps}
              gpsActive={gpsActive}
              onRecenter={() => mapRef.current?.recenter()}
              onZoomIn={() => mapRef.current?.zoomIn()}
              onZoomOut={() => mapRef.current?.zoomOut()}
              onResetNorth={() => mapRef.current?.resetNorth()}
            />

            <div className="pointer-events-none absolute bottom-[max(1rem,env(safe-area-inset-bottom,0px))] right-4 z-20">
              <DiscoverStopsControls
                loading={discovery.loading}
                resultMessage={discovery.resultMessage}
                onFindStops={discovery.findStops}
              />
            </div>
          </>
        ) : null}
      </div>

      {active ? (
        <>
          <StopSheet
            stop={selectedStop}
            bundle={bundle}
            onClose={handleStopSheetClose}
            onSelectAlternative={selectStop}
            onVerified={handleStopVerified}
            onSkipped={handleStopSkipped}
          />

          <ClimbSheet
            climb={selectedClimb}
            totalKm={bundle.race.distanceKm}
            currentKm={currentKm}
            onClose={() => setSelectedClimb(null)}
          />
        </>
      ) : null}
    </div>
  );
}
