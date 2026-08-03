import { useState } from "react";
import type { ResupplyZone } from "../api";
import { usePlanning } from "../planning/PlanningContext";
import { usePlanningAssumptions } from "../planning/usePlanningAssumptions";
import { buildHubRecommendations, categoryEmoji } from "../planning/hubRecommendations";
import { formatHoursVisual } from "../planning/stopPresentation";
import { zoneAvailability } from "../planning/stopAvailability";
import { formatKm } from "./routeInsights";
import { formatOffRouteDistance, formatPoiName } from "./poiUi";
import HubRecommendationSection from "./HubRecommendationSection";
import VerificationStatusBadge, {
  VerificationStatusLabel,
} from "./verification/VerificationStatusBadge";

interface ResupplyZoneCardProps {
  zone: ResupplyZone;
  selected?: boolean;
  dimmed?: boolean;
  onSelect?: (zone: ResupplyZone) => void;
}

export default function ResupplyZoneCard({
  zone,
  selected = false,
  dimmed = false,
  onSelect,
}: ResupplyZoneCardProps) {
  const { timeMode } = usePlanning();
  const { arrivalTimeWindow } = usePlanningAssumptions();
  const [expanded, setExpanded] = useState(false);
  const summary = buildHubRecommendations(zone);
  const availability = zoneAvailability(zone, arrivalTimeWindow, timeMode);
  const bestHours = summary.best
    ? formatHoursVisual(
        summary.best.poi.opening_hours,
        timeMode,
        summary.best.poi.night_usability,
      )
    : null;

  return (
    <article
      className={`border-b border-line/40 border-l-2 last:border-b-0 transition ${
        selected ? "border-l-accent bg-accent/[0.03]" : "border-l-transparent"
      } ${dimmed ? "opacity-50" : ""}`}
    >
      <button
        type="button"
        onClick={() => onSelect?.(zone)}
        className="w-full px-5 py-5 text-left sm:px-6 sm:py-6"
      >
        <div className="flex items-start gap-4">
          <VerificationStatusBadge zoneId={zone.zone_id} showLabel={false} size="md" className="mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <VerificationStatusLabel zoneId={zone.zone_id} />
              <span className="text-xs text-muted">· Suggested stop</span>
            </div>
            <h3 className="mt-0.5 text-lg font-semibold text-ink">{zone.name}</h3>
            <p className="mt-1 text-xs tracking-tight text-muted">{summary.stopStarDisplay}</p>
          </div>
          <span className="shrink-0 text-xs tabular-nums text-muted">
            {formatKm(zone.distance_along_km, 1)}
          </span>
        </div>

        {summary.best && (
          <div className="mt-4">
            <p className="text-xs text-muted">Best option</p>
            <p className="mt-1 text-sm font-medium text-ink">
              <span className="mr-1" aria-hidden>
                {categoryEmoji(summary.best.categoryKey)}
              </span>
              {formatPoiName(summary.best.poi.name, summary.best.poi.brand, {
                poiCategory: summary.best.poi.poi_category,
                categoryKey: summary.best.categoryKey,
              })}
            </p>
            <p className="mt-0.5 text-xs text-muted">
              {formatOffRouteDistance(summary.best.poi.distance_off_route_m)} off route
              {bestHours && (
                <>
                  <span className="mx-1.5 text-line">·</span>
                  {bestHours.label}
                </>
              )}
            </p>
          </div>
        )}

        <div className="mt-4 space-y-1 text-xs text-muted">
          {summary.excellentAlternativeCount > 0 && (
            <p>
              {summary.excellentAlternativeCount} excellent alternative
              {summary.excellentAlternativeCount === 1 ? "" : "s"}
            </p>
          )}
          {summary.goodAlternativeCount > 0 && (
            <p>
              {summary.goodAlternativeCount} good alternative
              {summary.goodAlternativeCount === 1 ? "" : "s"}
            </p>
          )}
          {summary.additionalStopCount > 0 && (
            <p>
              {summary.additionalStopCount} additional stop
              {summary.additionalStopCount === 1 ? "" : "s"}
            </p>
          )}
        </div>

        {availability?.status === "closed" && (
          <p className="mt-2 text-xs text-red-700">{availability.label}</p>
        )}
      </button>

      <div className="px-5 pb-5 sm:px-6">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="text-xs font-medium text-accent hover:text-accent/80"
        >
          {expanded ? "Collapse" : "Expand →"}
        </button>

        {expanded && (
          <div className="mt-4 border-t border-line/50 pt-4">
            <HubRecommendationSection
              zone={zone}
              timeWindowId={arrivalTimeWindow}
              timeMode={timeMode}
              showAlternativeSummary={false}
            />
          </div>
        )}
      </div>
    </article>
  );
}
