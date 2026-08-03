import { useMemo } from "react";
import type { RouteVisualization } from "../../api";
import { buildHubRecommendations } from "../../planning/hubRecommendations";
import { estimateArrivalClock } from "../../planning/stopVerification/arrivalEstimate";
import {
  bikeAccessLabel,
  buildWhyRecommended,
  formatStarRow,
  practicalityStars,
} from "../../planning/stopVerification/recommendations";
import { stopTypeFromCategory } from "../../planning/stopVerification/stopTypePresentation";
import { assessFuelShopFromTags, fuelShopBadgeClass } from "../../planning/stopVerification/fuelShopPresentation";
import type { VerifiedStopContext } from "../../planning/stopVerification/verifiedStopContext";
import VerificationStatusBadge from "../verification/VerificationStatusBadge";
import type { StopVerificationStatus } from "../../planning/stopVerification/types";
import type { PrioritizedStop } from "../../planning/stopVerification/priority";
import {
  computeUltraStopScore,
  formatHoursVisual,
  poiReliabilityPresentation,
  zoneReliabilityPresentation,
} from "../../planning/stopPresentation";
import { zoneAvailability } from "../../planning/stopAvailability";
import type { TimeMode } from "../../planning/types";
import type { TimeWindowId } from "../../planning/timeWindows";
import { formatPoiName } from "../poiUi";
import { googleMapsUrl, placeIdFromTags } from "../stopQuickActions";
import { useStreetViewLink } from "@shared/race/useStreetViewLink";
import StopVerificationMap from "./StopVerificationMap";
import StopVerificationPhotos from "./StopVerificationPhotos";
import { stopMapStory, mapContextWindowKm } from "../../planning/stopVerification/stopMapContext";

export interface AlternativeCardContext {
  anchorName: string;
  positionLabel: string;
  index: number;
  total: number;
}

interface StopVerificationCardProps {
  item: PrioritizedStop;
  route: RouteVisualization;
  totalKm: number;
  timeWindowId: TimeWindowId | null;
  timeMode: TimeMode;
  decisionStatus?: StopVerificationStatus;
  verifiedContext: VerifiedStopContext;
  alternativeContext?: AlternativeCardContext;
}

export default function StopVerificationCard({
  item,
  route,
  totalKm,
  timeWindowId,
  timeMode,
  decisionStatus,
  verifiedContext,
  alternativeContext,
}: StopVerificationCardProps) {
  const { zone, context } = item;
  const summary = buildHubRecommendations(zone);
  const best = summary.best;
  const reliability = best
    ? poiReliabilityPresentation(best.poi.score)
    : zoneReliabilityPresentation(zone);
  const ultra = computeUltraStopScore(zone, timeWindowId, timeMode);
  const availability = zoneAvailability(zone, timeWindowId, timeMode);
  const whyRecommended = buildWhyRecommended(zone, context, timeMode);
  const arrival = estimateArrivalClock(totalKm, zone.distance_along_km);
  const stopType = stopTypeFromCategory(best?.poi.poi_category, best?.categoryKey);
  const detourM = best?.poi.distance_off_route_m ?? zone.categories
    .flatMap((group) => [group.primary, ...group.alternatives])
    .filter(Boolean)
    .reduce((min, poi) => Math.min(min, poi!.distance_off_route_m), Infinity);

  const hoursVisual = best
    ? formatHoursVisual(best.poi.opening_hours, timeMode, best.poi.night_usability)
    : null;

  const stopTitle = best
    ? formatPoiName(best.poi.name, best.poi.brand, {
        poiCategory: best.poi.poi_category,
        categoryKey: best.categoryKey,
      })
    : zone.name;

  const mapsLat = best?.poi.lat ?? zone.lat;
  const mapsLon = best?.poi.lon ?? zone.lon;
  const routeCoordinates = useMemo(
    () => route.track_points.map((point) => [point.lon, point.lat] as [number, number]),
    [route.track_points],
  );
  const streetView = useStreetViewLink(
    {
      lat: mapsLat,
      lon: mapsLon,
      routeKm: zone.distance_along_km,
      name: stopTitle,
      placeId: best
        ? placeIdFromTags(best.poi.tags, (best.poi as { place_id?: string }).place_id)
        : null,
    },
    { routeCoordinates, totalDistanceKm: totalKm },
  );
  const routeKm = Math.round(zone.distance_along_km);
  const segmentKm = mapContextWindowKm(zone.distance_along_km, Number.isFinite(detourM) ? detourM : 0) * 2;
  const mapStory = stopMapStory(Number.isFinite(detourM) ? detourM : 0, segmentKm);

  const fuelShop = best
    ? assessFuelShopFromTags({
        poiCategory: best.poi.poi_category,
        tags: best.poi.tags,
        name: best.poi.name,
        brand: best.poi.brand,
        fuelShopConfidence: best.poi.fuel_shop_confidence,
        fuelShopLabel: best.poi.fuel_shop_label,
      })
    : null;

  const mapProps = useMemo(
    () => ({
      stopKm: zone.distance_along_km,
      stopLat: mapsLat,
      stopLon: mapsLon,
    }),
    [zone.distance_along_km, mapsLat, mapsLon],
  );

  return (
    <article className="rounded-2xl border border-line bg-card shadow-card">
      {alternativeContext && (
        <div className="border-b border-indigo-200/60 bg-indigo-50/80 px-5 py-3 sm:px-6">
          <p className="text-xs font-medium uppercase tracking-wide text-indigo-900/70">
            Nearby alternative {alternativeContext.index} of {alternativeContext.total}
          </p>
          <p className="mt-0.5 text-sm text-indigo-950">
            {alternativeContext.positionLabel} · compared to {alternativeContext.anchorName}
          </p>
        </div>
      )}
      <div className="border-b border-line/60 px-5 py-5 sm:px-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <VerificationStatusBadge
                zoneId={zone.zone_id}
                status={decisionStatus ?? "not_reviewed"}
                size="md"
              />
            </div>
            <p className="mt-3 text-xs font-medium uppercase tracking-wide text-muted">
              Would I confidently stop here during my race?
            </p>
          </div>
        </div>

        <p className="mt-3 text-base font-medium text-ink">
          <span aria-hidden>{stopType.emoji}</span>
          <span className="ml-2">{stopType.label}</span>
          {fuelShop && (
            <span
              className={`ml-2 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${fuelShopBadgeClass(fuelShop.confidence)}`}
            >
              {fuelShop.label}
            </span>
          )}
        </p>

        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-2xl font-semibold tracking-tight text-ink">{stopTitle}</h2>
          <p className="text-lg font-medium tabular-nums text-accent">{routeKm} km</p>
        </div>
        <p className="mt-0.5 text-xs text-muted">{routeKm} km from the start</p>
        {best && stopTitle !== zone.name && (
          <p className="mt-0.5 text-sm text-muted">{zone.name}</p>
        )}

        <div className="mt-3 grid grid-cols-2 gap-3 rounded-xl bg-canvas/70 px-3 py-2.5 text-xs">
          <div>
            <p className="text-muted">Previous verified stop</p>
            <p className="mt-0.5 font-medium tabular-nums text-ink">
              {verifiedContext.previous
                ? `${verifiedContext.previous.gapKm} km`
                : "—"}
            </p>
          </div>
          <div>
            <p className="text-muted">Next verified stop</p>
            <p className="mt-0.5 font-medium tabular-nums text-ink">
              {verifiedContext.next ? `${verifiedContext.next.gapKm} km` : "—"}
            </p>
          </div>
        </div>
      </div>

      <div className="border-b border-line/60 px-5 py-4 sm:px-6">
        <StopVerificationMap
          route={route}
          stopKm={mapProps.stopKm}
          stopLat={mapProps.stopLat}
          stopLon={mapProps.stopLon}
          detourM={Number.isFinite(detourM) ? detourM : 0}
        />
        <p className="mt-2 text-xs leading-relaxed text-muted">{mapStory}</p>
        {best && (
          <StopVerificationPhotos
            tags={best.poi.tags}
            lat={mapsLat}
            lon={mapsLon}
            alt={stopTitle}
          />
        )}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted">
            Purple = race route · In/Out = where route enters and leaves · Green = stop
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {streetView.available === false ? (
              <span className="text-xs text-muted">
                {streetView.unavailableMessage}{" "}
                <a
                  href={streetView.mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-accent underline"
                >
                  Google Maps
                </a>
              </span>
            ) : (
              <a
                href={streetView.streetViewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink transition hover:border-accent/40 hover:bg-accent/[0.03]"
              >
                <span aria-hidden>📍</span>
                {streetView.loading ? "Street View…" : "Open in Google Street View"}
              </a>
            )}
            <a
              href={googleMapsUrl(mapsLat, mapsLon)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink transition hover:border-accent/40 hover:bg-accent/[0.03]"
            >
              Open in Google Maps
            </a>
          </div>
        </div>
      </div>

      <div className="px-5 py-5 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-sm tracking-tight text-amber-600">{reliability.shortLabel}</span>
          <span className="text-sm text-muted">{reliability.label}</span>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl bg-canvas/80 px-3 py-2.5">
            <p className="text-xs text-muted">Open</p>
            <p className="mt-0.5 text-sm font-medium text-ink">
              {hoursVisual?.label ?? "Hours unknown"}
            </p>
            {availability && (
              <p className="mt-0.5 text-xs text-muted">{availability.label}</p>
            )}
          </div>
          <div className="rounded-xl bg-canvas/80 px-3 py-2.5">
            <p className="text-xs text-muted">Expected arrival</p>
            <p className="mt-0.5 text-sm font-medium tabular-nums text-ink">{arrival}</p>
          </div>
          <div className="rounded-xl bg-canvas/80 px-3 py-2.5">
            <p className="text-xs text-muted">Detour</p>
            <p className="mt-0.5 text-sm font-medium tabular-nums text-ink">
              {Number.isFinite(detourM) ? `${Math.round(detourM)} m` : "—"}
            </p>
          </div>
          <div className="rounded-xl bg-canvas/80 px-3 py-2.5">
            <p className="text-xs text-muted">Bike access</p>
            <p className="mt-0.5 text-sm font-medium text-ink">{bikeAccessLabel(zone)}</p>
          </div>
        </div>

        <div className="mt-4">
          <p className="text-xs text-muted">Race practicality</p>
          <p className="mt-0.5 text-sm tracking-tight text-emerald-700">
            {formatStarRow(practicalityStars(ultra.score))}
          </p>
        </div>

        <div className="mt-4">
          <p className="text-xs font-medium text-muted">Why recommended</p>
          <ul className="mt-2 space-y-1">
            {whyRecommended.map((reason) => (
              <li key={reason} className="flex items-start gap-2 text-sm text-ink">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent" aria-hidden />
                {reason}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </article>
  );
}
