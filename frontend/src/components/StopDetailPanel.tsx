import { useState } from "react";
import type { PoiRow, ZonePoiOption } from "../api";
import type { TimeMode } from "../planning/types";
import type { TimeWindowId } from "../planning/timeWindows";
import { getStopAvailability, zoneAvailability } from "../planning/stopAvailability";
import { buildHubRecommendations } from "../planning/hubRecommendations";
import {
  computeUltraStopScore,
  formatHoursVisual,
  poiReliabilityPresentation,
} from "../planning/stopPresentation";
import type { StopSelection } from "../planning/stopSelection";
import AvailabilityBadge from "./AvailabilityBadge";
import HubRecommendationSection from "./HubRecommendationSection";
import {
  copyCoordinates,
  googleMapsUrl,
  normalizeWebsite,
} from "./stopQuickActions";
import { formatPoiName } from "./poiUi";
import { formatKm } from "./routeInsights";
import { formatOffRouteDistance } from "./poiUi";
import VerificationStatusBadge from "./verification/VerificationStatusBadge";

interface StopDetailPanelProps {
  selection: StopSelection;
  timeWindowId: TimeWindowId | null;
  timeMode: TimeMode;
  showOsmTags: boolean;
  embedded?: boolean;
  onClose: () => void;
  onSelectPoi?: (poi: ZonePoiOption) => void;
  onBackToZone?: () => void;
}

function isPoiRow(poi: ZonePoiOption | PoiRow): poi is PoiRow {
  return "category" in poi;
}

function poiCategory(poi: ZonePoiOption | PoiRow): string {
  return isPoiRow(poi) ? poi.category : poi.poi_category;
}

function PanelShell({
  title,
  onClose,
  backAction,
  children,
}: {
  title: string;
  onClose: () => void;
  backAction?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 border-b border-line/60 pb-3">
        <div className="flex items-center gap-2">
          {backAction}
          <p className="text-sm font-medium text-ink">{title}</p>
        </div>
        <button type="button" onClick={onClose} className="text-sm text-muted hover:text-ink">
          Close
        </button>
      </div>
      <div className="pt-4">{children}</div>
    </div>
  );
}

function PoiDetailBody({
  poi,
  categoryLabel,
  timeWindowId,
  timeMode,
  showOsmTags,
}: {
  poi: ZonePoiOption | PoiRow;
  categoryLabel?: string;
  timeWindowId: TimeWindowId | null;
  timeMode: TimeMode;
  showOsmTags: boolean;
}) {
  const availability = getStopAvailability(
    {
      category: isPoiRow(poi) ? poi.category : undefined,
      poi_category: isPoiRow(poi) ? undefined : poi.poi_category,
      opening_hours: poi.opening_hours,
      night_usability: poi.night_usability,
    },
    timeWindowId,
    timeMode,
  );
  const reliability = poiReliabilityPresentation(poi.score);
  const hours = formatHoursVisual(poi.opening_hours, timeMode, poi.night_usability);
  const tags = isPoiRow(poi) ? poi.tags : poi.tags;
  const website = poi.website;

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-lg font-semibold text-ink">
          {formatPoiName(poi.name, poi.brand, {
            poiCategory: isPoiRow(poi) ? poi.category : poi.poi_category,
          })}
        </h4>
        <p className="mt-1 text-sm text-muted">{categoryLabel ?? poiCategory(poi)}</p>
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-muted">Off route</dt>
          <dd className="font-medium tabular-nums text-ink">
            {formatOffRouteDistance(poi.distance_off_route_m)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Along route</dt>
          <dd className="font-medium tabular-nums text-ink">{formatKm(poi.distance_along_km, 1)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Reliability</dt>
          <dd className="font-medium text-ink">{reliability.label}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Hours</dt>
          <dd className="font-medium text-ink">{hours.label}</dd>
        </div>
      </dl>

      {availability && <AvailabilityBadge availability={availability} />}

      {poi.phone && (
        <p className="text-sm text-muted">
          Phone <span className="text-ink">{poi.phone}</span>
        </p>
      )}

      {website && (
        <a
          href={normalizeWebsite(website)}
          target="_blank"
          rel="noreferrer"
          className="block text-sm text-accent hover:underline"
        >
          {website}
        </a>
      )}

      <QuickActions lat={poi.lat} lon={poi.lon} />

      {showOsmTags && Object.keys(tags).length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs text-muted">OSM tags</summary>
          <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-canvas/80 p-3 text-xs text-muted">
            {JSON.stringify(tags, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

function QuickActions({ lat, lon }: { lat: number; lon: number }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await copyCoordinates(lat, lon);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex flex-wrap gap-3">
      <a
        href={googleMapsUrl(lat, lon)}
        target="_blank"
        rel="noreferrer"
        className="text-sm font-medium text-accent hover:text-accent/80"
      >
        Google Maps
      </a>
      <button
        type="button"
        onClick={handleCopy}
        className="text-sm font-medium text-muted hover:text-ink"
      >
        {copied ? "Copied" : "Copy coordinates"}
      </button>
    </div>
  );
}

export default function StopDetailPanel({
  selection,
  timeWindowId,
  timeMode,
  showOsmTags,
  embedded = false,
  onClose,
  onSelectPoi,
  onBackToZone,
}: StopDetailPanelProps) {
  if (!selection) {
    return null;
  }

  if (selection.kind === "poi") {
    const zone = selection.zone;
    const categoryLabel = zone?.categories.find((group) =>
      [group.primary, ...group.alternatives].some(
        (option) =>
          option &&
          option.osm_id === selection.poi.osm_id &&
          option.osm_type === selection.poi.osm_type,
      ),
    )?.label;

    const body = (
      <PoiDetailBody
        poi={selection.poi}
        categoryLabel={categoryLabel}
        timeWindowId={timeWindowId}
        timeMode={timeMode}
        showOsmTags={showOsmTags}
      />
    );

    if (embedded) {
      return body;
    }

    return (
      <PanelShell
        title={formatPoiName(selection.poi.name, selection.poi.brand, {
          poiCategory: isPoiRow(selection.poi) ? selection.poi.category : selection.poi.poi_category,
        })}
        onClose={onClose}
        backAction={
          zone && onBackToZone ? (
            <button type="button" onClick={onBackToZone} className="text-sm font-medium text-accent">
              ← Hub
            </button>
          ) : undefined
        }
      >
        {body}
      </PanelShell>
    );
  }

  const zone = selection.zone;
  const availability = zoneAvailability(zone, timeWindowId, timeMode);
  const ultraScore = computeUltraStopScore(zone, timeWindowId, timeMode);
  const hubSummary = buildHubRecommendations(zone);

  const body = (
    <div className="space-y-5">
      <VerificationStatusBadge zoneId={zone.zone_id} size="md" />
      <div>
        <p className="text-xs text-muted">Resupply stop</p>
        <p className="mt-1 text-xs tracking-tight text-muted">{hubSummary.stopStarDisplay}</p>
        <p className="mt-2 text-sm text-muted">
          {formatKm(zone.distance_along_km, 1)}
          <span className="mx-2 text-line">·</span>
          {ultraScore.label}
        </p>
        {availability && availability.status === "closed" && (
          <p className="mt-1 text-xs text-red-700">{availability.label}</p>
        )}
      </div>

      <HubRecommendationSection
        zone={zone}
        timeWindowId={timeWindowId}
        timeMode={timeMode}
        onSelectPoi={onSelectPoi}
      />

      <QuickActions lat={zone.lat} lon={zone.lon} />
    </div>
  );

  if (embedded) {
    return body;
  }

  return (
    <PanelShell title={zone.name} onClose={onClose}>
      {body}
    </PanelShell>
  );
}
