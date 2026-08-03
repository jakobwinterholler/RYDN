import { useCallback, useMemo, useState } from "react";
import type { ResupplyZone, RoadbookResult } from "../../api";
import { formatKm } from "../routeInsights";
import { usePlanning } from "../../planning/PlanningContext";
import { usePlanningAssumptions } from "../../planning/usePlanningAssumptions";
import { buildHubRecommendations, categoryEmoji } from "../../planning/hubRecommendations";
import { buildRejectFeedbackContext } from "../../planning/stopVerification/buildRejectFeedback";
import { buildWhyRecommended } from "../../planning/stopVerification/recommendations";
import {
  buildResupplySegmentSummary,
} from "../../planning/resupplySegments";
import { isStopPending } from "../../planning/stopVerification/priority";
import type { VerifiedStopRecord } from "../../planning/stopVerification/types";
import { verifiedStopKey } from "../../planning/stopVerification/types";
import { zoneAvailability } from "../../planning/stopAvailability";
import { updateRacePreparation } from "../../races/api";
import { useRace } from "../../races/RaceContext";
import VerificationStatusBadge from "../verification/VerificationStatusBadge";

interface SuggestedStopsReviewPanelProps {
  zones: ResupplyZone[];
  result: RoadbookResult;
  selectedZoneId: number | null;
  onSelectZone: (zoneId: number) => void;
  onFocusOnMap: (zoneId: number) => void;
}

function poiKeyFromZone(osmType: string, osmId: number): string {
  return `${osmType}-${osmId}`;
}

function nextVerifiedZone(
  zones: ResupplyZone[],
  fromIndex: number,
  verifiedStops: Record<string, VerifiedStopRecord>,
): ResupplyZone | null {
  for (let index = fromIndex + 1; index < zones.length; index += 1) {
    const zone = zones[index];
    if (verifiedStops[verifiedStopKey(zone.zone_id)]?.status === "verified") {
      return zone;
    }
  }
  return null;
}

export default function SuggestedStopsReviewPanel({
  zones,
  result,
  selectedZoneId,
  onSelectZone,
  onFocusOnMap,
}: SuggestedStopsReviewPanelProps) {
  const { timeMode } = usePlanning();
  const { arrivalTimeWindow } = usePlanningAssumptions();
  const { activeRaceId, verifiedStops, saveVerifiedStop } = useRace();
  const [saving, setSaving] = useState(false);
  const [lastUndo, setLastUndo] = useState<{
    zoneId: number;
    previous: VerifiedStopRecord | null;
  } | null>(null);

  const sortedZones = useMemo(
    () => [...zones].sort((left, right) => left.distance_along_km - right.distance_along_km),
    [zones],
  );

  const persistDecision = useCallback(
    async (zoneId: number, status: "verified" | "rejected" | "deferred") => {
      setSaving(true);
      try {
        const previous = verifiedStops[verifiedStopKey(zoneId)] ?? null;
        setLastUndo({ zoneId, previous });
        const zone = sortedZones.find((entry) => entry.zone_id === zoneId);
        const best = zone ? buildHubRecommendations(zone).best : null;
        await saveVerifiedStop(zoneId, {
          status,
          feedbackContext:
            status === "rejected" && zone && best
              ? buildRejectFeedbackContext(zone, best, "not_practical")
              : undefined,
          poiKey: best ? poiKeyFromZone(best.poi.osm_type, best.poi.osm_id) : undefined,
          updatedAt: new Date().toISOString(),
        });
      } finally {
        setSaving(false);
      }
    },
    [saveVerifiedStop, sortedZones, verifiedStops],
  );

  const handleUndo = useCallback(async () => {
    if (!lastUndo || !activeRaceId || saving) {
      return;
    }
    setSaving(true);
    try {
      const key = verifiedStopKey(lastUndo.zoneId);
      if (lastUndo.previous) {
        await saveVerifiedStop(lastUndo.zoneId, lastUndo.previous);
      } else {
        await updateRacePreparation(activeRaceId, {
          verifiedStops: { [key]: { _delete: true } },
        });
      }
      setLastUndo(null);
    } finally {
      setSaving(false);
    }
  }, [activeRaceId, lastUndo, saveVerifiedStop, saving]);

  const verifiedCount = useMemo(
    () =>
      sortedZones.filter(
        (zone) => verifiedStops[verifiedStopKey(zone.zone_id)]?.status === "verified",
      ).length,
    [sortedZones, verifiedStops],
  );

  return (
    <aside className="flex h-full min-h-0 w-full flex-col border-r border-line/60 bg-card lg:w-[380px] lg:shrink-0">
      <div className="shrink-0 border-b border-line/60 px-4 py-4">
        <h3 className="text-sm font-semibold text-ink">Suggested stops</h3>
        <p className="mt-0.5 text-xs text-muted">
          {verifiedCount} verified · {sortedZones.length} suggested
        </p>
        {lastUndo && (
          <button
            type="button"
            onClick={() => void handleUndo()}
            disabled={saving}
            className="mt-2 text-xs font-semibold text-accent transition hover:text-accent/80 disabled:opacity-50"
          >
            ↩ Undo last decision
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {sortedZones.map((zone, index) => {
          const summary = buildHubRecommendations(zone);
          const best = summary.best;
          const categoryKey = best?.categoryKey ?? "food";
          const pending = isStopPending(zone.zone_id, verifiedStops);
          const reasons = buildWhyRecommended(
            zone,
            { isLastBeforeRemote: false, isOnlyStopInArea: false },
            timeMode,
          );
          const availability = zoneAvailability(zone, arrivalTimeWindow, timeMode);
          const nextVerified = nextVerifiedZone(sortedZones, index, verifiedStops);
          const gapSummary = nextVerified
            ? buildResupplySegmentSummary(
                {
                  startKm: zone.distance_along_km,
                  endKm: nextVerified.distance_along_km,
                  label: `${zone.name} → ${nextVerified.name}`,
                  endZoneId: nextVerified.zone_id,
                  endZoneName: nextVerified.name,
                  startZoneName: zone.name,
                },
                result.route,
                result.resupply_zones,
                verifiedStops,
              )
            : null;

          return (
            <div
              key={zone.zone_id}
              className={`border-b border-line/40 px-4 py-3 transition ${
                selectedZoneId === zone.zone_id ? "bg-accent/[0.04]" : "hover:bg-canvas/50"
              }`}
            >
              <button
                type="button"
                onClick={() => onSelectZone(zone.zone_id)}
                className="w-full text-left"
              >
                <div className="flex items-start gap-2.5">
                  <span className="text-xl leading-none" aria-hidden>
                    {categoryEmoji(categoryKey)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <VerificationStatusBadge zoneId={zone.zone_id} showLabel={false} size="sm" />
                      <span className="truncate text-sm font-medium text-ink">{zone.name}</span>
                    </div>
                    <p className="mt-0.5 text-xs tabular-nums text-muted">
                      {formatKm(zone.distance_along_km, 1)}
                    </p>
                    <p className="mt-1 line-clamp-2 text-xs text-muted">{reasons[0]}</p>
                    {availability && (
                      <p
                        className={`mt-0.5 text-xs ${
                          availability.status === "closed" ? "text-red-700" : "text-muted"
                        }`}
                      >
                        {availability.label}
                      </p>
                    )}
                    {gapSummary && (
                      <p className="mt-1 text-xs tabular-nums text-muted">
                        → {formatKm(gapSummary.distanceKm, 0)} · +{gapSummary.elevationGainM} m
                      </p>
                    )}
                  </div>
                </div>
              </button>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                {pending ? (
                  <>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void persistDecision(zone.zone_id, "verified")}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                    >
                      Verify
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void persistDecision(zone.zone_id, "rejected")}
                      className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-muted transition hover:border-red-200 hover:text-red-800 disabled:opacity-50"
                    >
                      Skip
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  onClick={() => onFocusOnMap(zone.zone_id)}
                  className="rounded-lg px-2 py-1.5 text-xs font-semibold text-accent transition hover:text-accent/80"
                >
                  Focus on map
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
