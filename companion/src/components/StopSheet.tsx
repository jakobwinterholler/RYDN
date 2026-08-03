import { useMemo, useState } from "react";
import { useAuth } from "@shared/auth/AuthProvider";
import { resolveRenderedStop } from "@shared/race/bundlePois";
import { computeStopConfidence, stopConfidenceBadgeClass } from "@shared/race/stopConfidence";
import { haversineM } from "@shared/race/mapMatching";
import type { CompanionVerificationUpdates } from "@shared/types/verification";
import type { CompanionBundle, CompanionStop } from "../types";
import { formatKm, googleMapsUrl } from "../lib/utils";
import {
  canVerifyStop,
  canConfirmOnRoute,
  isVerifiedEverywhere,
  isVerifiedLocally,
  serviceLabels,
  stopStatusLabel,
} from "../lib/raceExecution";
import { normalizeWebsite } from "@shared/race/streetViewUrl";
import { useStreetViewLink } from "@shared/race/useStreetViewLink";
import { buildStopAlternatives, type StopAlternativeView } from "../lib/nearbyStopAlternatives";
import { useVerificationActions } from "../lib/useVerificationActions";
import { haptic } from "../lib/haptics";
import { useCompanion } from "../context/CompanionContext";
import StopDetailMap from "./StopDetailMap";
import BottomSheet from "./BottomSheet";

interface StopSheetProps {
  stop: CompanionStop | null;
  bundle: CompanionBundle;
  onClose: () => void;
  onSelectAlternative?: (stop: CompanionStop) => void;
  onVerified?: (stop: CompanionStop) => void;
  onSkipped?: (stop: CompanionStop) => void;
}

function statusBadgeClass(status: CompanionStop["verificationStatus"]): string {
  if (isVerifiedEverywhere(status)) {
    return "bg-emerald-500/15 text-emerald-200 ring-emerald-400/30";
  }
  if (isVerifiedLocally(status)) {
    return "bg-sky-500/15 text-sky-200 ring-sky-400/30";
  }
  if (status === "needs_review") {
    return "bg-amber-500/15 text-amber-200 ring-amber-400/30";
  }
  return "bg-white/8 text-white/60 ring-white/15";
}

function updatesForVerify(): CompanionVerificationUpdates {
  return { status: "verified" };
}

function updatesForSkip(): CompanionVerificationUpdates {
  return {
    status: "rejected",
    rejectReason: "could_not_verify",
  };
}

function alternativeToStop(anchor: CompanionStop, alternative: StopAlternativeView): CompanionStop {
  if (alternative.stop) {
    return alternative.stop;
  }
  const alt = alternative.alternative!;
  return {
    poiId: alt.poiId ?? anchor.poiId,
    zoneId: anchor.zoneId,
    osmId: alt.osmId,
    osmType: alt.osmType,
    km:
      alt.distanceAlongKm != null && Number.isFinite(alt.distanceAlongKm)
        ? alt.distanceAlongKm
        : anchor.km,
    lat: alt.lat,
    lon: alt.lon,
    name: alt.name,
    category: alt.category,
    categoryLabel: alt.categoryLabel,
    icon: alt.icon,
    distanceOffRouteM: alt.distanceOffRouteM,
    confidenceScore: alt.score,
    verificationStatus: alt.verificationStatus,
    openingHours: alt.openingHours,
    notes: null,
    phone: alt.phone,
    website: alt.website,
    placeId: alt.placeId,
    hasFood: alt.hasFood ?? anchor.hasFood,
    hasWater: alt.hasWater ?? anchor.hasWater,
    hasFuel: alt.hasFuel ?? anchor.hasFuel,
    hasCoffee: anchor.hasCoffee,
    verificationDate: null,
    resupplyReason: null,
    alternatives: [],
    nearbyAlternatives: [],
  };
}

function formatDetourM(distanceOffRouteM: number | undefined): string {
  if (distanceOffRouteM == null || !Number.isFinite(distanceOffRouteM) || distanceOffRouteM < 50) {
    return "On route";
  }
  return `${Math.round(distanceOffRouteM)} m off route`;
}

function formatSeparationM(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m apart`;
  }
  return `${(meters / 1000).toFixed(1)} km apart`;
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Back to list"
      className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full text-white/80 transition active:bg-white/10"
    >
      <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

export default function StopSheet({
  stop: stopProp,
  bundle,
  onClose,
  onSelectAlternative,
  onVerified,
  onSkipped,
}: StopSheetProps) {
  const { user } = useAuth();
  const { gps } = useCompanion();
  const stop = useMemo(
    () => (stopProp ? resolveRenderedStop(bundle, stopProp) : null),
    [bundle, stopProp],
  );
  const { submitVerification } = useVerificationActions(user?.id ?? null);
  const [actionError, setActionError] = useState<string | null>(null);
  const totalKm = bundle.race.distanceKm;
  const streetViewOptions = {
    routeCoordinates: bundle.route.coordinates,
    totalDistanceKm: totalKm,
  };
  const streetView = useStreetViewLink(
    stop
      ? {
          lat: stop.lat,
          lon: stop.lon,
          placeId: stop.placeId,
          routeKm: stop.km,
          name: stop.name,
        }
      : null,
    streetViewOptions,
  );
  const alternatives = useMemo(
    () => (stop ? buildStopAlternatives(stop, bundle.stops) : []),
    [bundle.stops, stop],
  );
  const alternativeStops = useMemo(
    () => alternatives.map((item) => alternativeToStop(stop!, item)),
    [alternatives, stop],
  );
  const showVerifyActions = stop ? canVerifyStop(stop.verificationStatus) : false;
  const showConfirmOnRoute = stop ? canConfirmOnRoute(stop.verificationStatus) : false;
  const confidence = stop
    ? computeStopConfidence({
        verificationStatus: stop.verificationStatus,
        verifiedAt: stop.verificationDate,
        poiScore: stop.confidenceScore,
        openingHours: stop.openingHours,
        website: stop.website,
        phone: stop.phone,
      })
    : null;

  async function handleVerify(target: CompanionStop) {
    setActionError(null);
    const result = await submitVerification(target, {
      ...updatesForVerify(),
      category: target.category,
    });
    if (!result.ok) {
      setActionError(result.error ?? "Could not verify this stop.");
      return;
    }
    haptic("success");
    if (onVerified) {
      onVerified(target);
    } else {
      onClose();
    }
  }

  async function handleSkip() {
    if (!stop) {
      return;
    }
    setActionError(null);
    const result = await submitVerification(stop, {
      ...updatesForSkip(),
      category: stop.category,
    });
    if (!result.ok) {
      setActionError(result.error ?? "Could not skip this stop.");
      return;
    }
    haptic("light");
    if (onSkipped) {
      onSkipped(stop);
    } else {
      onClose();
    }
  }

  return (
    <BottomSheet open={stop !== null} onClose={onClose}>
      {stop ? (
        <div className="space-y-5 pb-1">
          <div className="-mx-5 flex items-center gap-1 border-b border-white/8 px-3 pb-3">
            <BackButton onClick={onClose} />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white/75">
              Back to list
            </span>
          </div>

          <div>
            <div className="flex items-start gap-3">
              <span className="poi-sheet__icon text-4xl leading-none" aria-hidden>
                {stop.icon}
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="poi-sheet__title text-2xl font-bold leading-tight text-white">
                  {stop.name}
                </h2>
                <p className="mt-1 text-sm font-medium text-white/55">{stop.categoryLabel}</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 transition-colors duration-200 ${statusBadgeClass(stop.verificationStatus)}`}
              >
                {stopStatusLabel(stop.verificationStatus)}
              </span>
              {confidence ? (
                <span
                  className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${stopConfidenceBadgeClass(confidence.level, true)}`}
                >
                  {confidence.label} ({confidence.score})
                </span>
              ) : null}
            </div>
          </div>

          <dl className="poi-sheet__meta grid grid-cols-2 gap-x-4 gap-y-3 rounded-2xl border border-white/8 bg-white/[0.03] p-4 text-sm">
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-wide text-white/40">Route position</dt>
              <dd className="mt-0.5 tabular-nums text-white/85">
                {formatKm(stop.km)} · {formatKm(Math.max(0, totalKm - stop.km))} left
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-wide text-white/40">Detour</dt>
              <dd className="mt-0.5 text-white/85">{formatDetourM(stop.distanceOffRouteM)}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-[11px] font-medium uppercase tracking-wide text-white/40">Services</dt>
              <dd className="mt-0.5 text-white/85">{serviceLabels(stop)}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-wide text-white/40">Hours</dt>
              <dd className="mt-0.5 text-white/85">{stop.openingHours ?? "Unknown"}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-wide text-white/40">POI score</dt>
              <dd className="mt-0.5 tabular-nums text-white/85">
                {stop.confidenceScore != null ? `${Math.round(stop.confidenceScore)}` : "—"}
              </dd>
            </div>
          </dl>

          <div className="poi-sheet__map relative h-52 overflow-hidden rounded-2xl border border-violet-400/25 shadow-lg shadow-violet-500/10">
            <StopDetailMap
              stop={stop}
              bundle={bundle}
              alternatives={alternativeStops}
              riderLat={gps.lat}
              riderLon={gps.lon}
            />
          </div>

          <div className="poi-quick-actions">
            {showVerifyActions ? (
              <>
                <button
                  type="button"
                  className="poi-quick-actions__btn poi-quick-actions__btn--verify"
                  onClick={() => void handleVerify(stop)}
                >
                  ✓ Verify
                </button>
                <button
                  type="button"
                  className="poi-quick-actions__btn poi-quick-actions__btn--skip"
                  onClick={() => void handleSkip()}
                >
                  Skip
                </button>
              </>
            ) : showConfirmOnRoute ? (
              <button
                type="button"
                className="poi-quick-actions__btn poi-quick-actions__btn--verify col-span-2"
                onClick={() => void handleVerify(stop)}
              >
                Confirm on route
              </button>
            ) : (
              <>
                <span className="poi-quick-actions__btn poi-quick-actions__btn--disabled col-span-2 text-center">
                  {isVerifiedLocally(stop.verificationStatus)
                    ? "✓ Verified on this device — syncing"
                    : isVerifiedEverywhere(stop.verificationStatus)
                      ? "Verified everywhere"
                      : "Verification complete"}
                </span>
              </>
            )}
            <a
              href={googleMapsUrl(stop.lat, stop.lon, stop.placeId)}
              target="_blank"
              rel="noreferrer"
              className="poi-quick-actions__btn poi-quick-actions__btn--maps"
            >
              Google Maps
            </a>
            {streetView.available === false ? (
              <div className="flex min-h-[44px] flex-col justify-center px-1">
                <span className="text-xs text-white/45">{streetView.unavailableMessage}</span>
                <a
                  href={streetView.mapsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 text-xs font-medium text-sky-300 underline"
                >
                  Open in Google Maps
                </a>
              </div>
            ) : (
              <a
                href={streetView.streetViewUrl}
                target="_blank"
                rel="noreferrer"
                className="poi-quick-actions__btn poi-quick-actions__btn--streetview"
              >
                {streetView.loading ? "Street View…" : "Street View"}
              </a>
            )}
          </div>

          {actionError ? (
            <p className="rounded-xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-center text-sm font-medium text-red-200">
              {actionError}
            </p>
          ) : null}

          {alternatives.length > 0 ? (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/40">
                Nearby alternatives
              </p>
              <ul className="mt-2 space-y-2">
                {alternatives.map((alternative) => {
                  const altStop = alternativeToStop(stop, alternative);
                  const canVerifyAlt = canVerifyStop(alternative.verificationStatus);
                  const separationM = haversineM(stop.lat, stop.lon, alternative.lat, alternative.lon);
                  return (
                    <li key={alternative.key}>
                      <div className="flex min-h-[48px] items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 transition active:bg-white/8">
                        <button
                          type="button"
                          onClick={() => onSelectAlternative?.(altStop)}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        >
                          <span className="text-xl" aria-hidden>
                            {alternative.icon}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-white">
                              {alternative.name}
                            </p>
                            <p className="truncate text-xs text-white/45">
                              {alternative.categoryLabel} · {alternative.distanceLabel} ·{" "}
                              {formatSeparationM(separationM)}
                            </p>
                          </div>
                          <span
                            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                              alternative.verificationStatus === "verified"
                                ? "bg-emerald-500/20 text-emerald-200"
                                : alternative.verificationStatus === "pending"
                                  ? "bg-sky-500/20 text-sky-200"
                                  : "bg-white/10 text-white/50"
                            }`}
                          >
                            {alternative.verificationStatus === "verified"
                              ? "✓"
                              : alternative.verificationStatus === "pending"
                                ? "✓"
                                : "?"}
                          </span>
                        </button>
                        {canVerifyAlt ? (
                          <button
                            type="button"
                            onClick={() => void handleVerify(altStop)}
                            className="shrink-0 rounded-lg bg-emerald-500/15 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-200 ring-1 ring-emerald-400/25 transition active:scale-95"
                          >
                            Verify
                          </button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          <div className="grid grid-cols-3 gap-2">
            <a
              href={googleMapsUrl(stop.lat, stop.lon, stop.placeId)}
              target="_blank"
              rel="noreferrer"
              className="flex min-h-[44px] items-center justify-center rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-sm font-semibold text-white/90 transition active:bg-white/10"
            >
              Maps
            </a>
            {stop.website ? (
              <a
                href={normalizeWebsite(stop.website)}
                target="_blank"
                rel="noreferrer"
                className="flex min-h-[44px] items-center justify-center rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-sm font-semibold text-white/90 transition active:bg-white/10"
              >
                Website
              </a>
            ) : (
              <span className="flex min-h-[44px] items-center justify-center rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5 text-sm text-white/25">
                Website
              </span>
            )}
            {stop.phone ? (
              <a
                href={`tel:${stop.phone}`}
                className="flex min-h-[44px] items-center justify-center rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-sm font-semibold text-white/90 transition active:bg-white/10"
              >
                Call
              </a>
            ) : (
              <span className="flex min-h-[44px] items-center justify-center rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5 text-sm text-white/25">
                Call
              </span>
            )}
          </div>

          {stop.notes ? (
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4 text-sm">
              <p className="text-[11px] font-medium uppercase tracking-wide text-white/40">Notes</p>
              <p className="mt-1 text-white/85">{stop.notes}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </BottomSheet>
  );
}
