import { useEffect, useMemo, useState } from "react";
import type { RouteVisualization } from "../../api";
import type { TimeMode } from "../../planning/types";
import type { TimeWindowId } from "../../planning/timeWindows";
import type { StopSelection } from "../../planning/stopSelection";
import { buildHubMapMarkers, hubZoneForSelection } from "../../planning/hubMapMarkers";
import { useRace } from "../../races/RaceContext";
import StopDetailPanel from "../StopDetailPanel";
import RouteContextMiniMap from "../planning/RouteContextMiniMap";

interface ResupplyHubDetailContentProps {
  selection: StopSelection;
  route: RouteVisualization;
  timeWindowId: TimeWindowId | null;
  timeMode: TimeMode;
  showOsmTags?: boolean;
  onSelectPoi?: (poi: import("../../api").ZonePoiOption) => void;
  onBackToZone?: () => void;
}

export default function ResupplyHubDetailContent({
  selection,
  route,
  timeWindowId,
  timeMode,
  showOsmTags = false,
  onSelectPoi,
  onBackToZone,
}: ResupplyHubDetailContentProps) {
  const { verifiedStops } = useRace();
  const [showAllMarkers, setShowAllMarkers] = useState(false);

  const hubZone = useMemo(() => (selection ? hubZoneForSelection(selection) : null), [selection]);

  useEffect(() => {
    setShowAllMarkers(false);
  }, [hubZone?.zone_id]);

  const highlightRange = useMemo(() => {
    if (!hubZone) {
      return null;
    }
    const km = hubZone.distance_along_km;
    return { startKm: Math.max(0, km - 1.5), endKm: km + 1.5 };
  }, [hubZone]);

  const mapResult = useMemo(() => {
    if (!hubZone) {
      return { markers: [], totalCount: 0, hiddenCount: 0 };
    }
    const activePoi = selection?.kind === "poi" ? selection.poi : null;
    return buildHubMapMarkers(hubZone, {
      activePoi,
      verifiedStops,
      showAll: showAllMarkers,
    });
  }, [hubZone, selection, verifiedStops, showAllMarkers]);

  if (!selection || !hubZone) {
    return null;
  }

  const showBackToHub =
    selection.kind === "poi" && selection.zone && onBackToZone !== undefined;

  return (
    <div className="space-y-5">
      {showBackToHub && (
        <button
          type="button"
          onClick={onBackToZone}
          className="text-sm font-medium text-accent hover:text-accent/80"
        >
          ← Back to stop
        </button>
      )}

      <div>
        <RouteContextMiniMap
          route={route}
          highlightRange={highlightRange}
          markers={mapResult.markers}
          fitToHighlight
        />
        {mapResult.hiddenCount > 0 && (
          <div className="border-t border-line/40 bg-canvas/40 px-3 py-2 text-center">
            <button
              type="button"
              onClick={() => setShowAllMarkers((current) => !current)}
              className="text-xs font-medium text-accent hover:text-accent/80"
            >
              {showAllMarkers
                ? "Show fewer"
                : `+${mapResult.hiddenCount} more nearby · Show all ${mapResult.totalCount}`}
            </button>
          </div>
        )}
      </div>

      <StopDetailPanel
        selection={selection}
        timeWindowId={timeWindowId}
        timeMode={timeMode}
        showOsmTags={showOsmTags}
        embedded
        onClose={() => undefined}
        onSelectPoi={onSelectPoi}
        onBackToZone={onBackToZone}
      />
    </div>
  );
}
