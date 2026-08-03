import { useCallback, useEffect, useRef, useState } from "react";
import { computeStopConfidence, stopConfidenceBadgeClass } from "@shared/race/stopConfidence";
import { formatStopDistanceM } from "@shared/race/sortVerificationQueue";
import { haversineM } from "@shared/race/mapMatching";
import type { CompanionStop } from "../types";
import { formatKm, googleMapsUrl } from "../lib/utils";
import { serviceLabels, stopStatusLabel } from "../lib/raceExecution";
import { normalizeWebsite } from "@shared/race/streetViewUrl";
import { useStreetViewLink } from "@shared/race/useStreetViewLink";
import { haptic } from "../lib/haptics";

export type VerificationAction = "verified" | "skip";

type ExitDirection = "left" | "right";

interface VerificationSwipeStackProps {
  stops: CompanionStop[];
  totalKm: number;
  gpsLat: number | null;
  gpsLon: number | null;
  routeCoordinates?: [number, number][];
  onAction: (stop: CompanionStop, action: VerificationAction) => Promise<boolean>;
  onOpenDetails?: (stop: CompanionStop) => void;
}

const SWIPE_THRESHOLD = 90;
const MAX_ROTATION = 10;
const EXIT_MS = 280;

function stopDistanceLabel(
  stop: CompanionStop,
  gpsLat: number | null,
  gpsLon: number | null,
): string | null {
  if (gpsLat == null || gpsLon == null) {
    return null;
  }
  return formatStopDistanceM(haversineM(gpsLat, gpsLon, stop.lat, stop.lon));
}

function formatVerifiedDate(value: string | null | undefined): string {
  if (!value) {
    return "Never verified";
  }
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function exitTransform(direction: ExitDirection): string {
  if (direction === "right") {
    return `translate3d(${window.innerWidth * 1.2}px, -24px, 0) rotate(12deg)`;
  }
  return `translate3d(${-window.innerWidth * 1.2}px, -24px, 0) rotate(-12deg)`;
}

function SwipeCard({
  stop,
  totalKm,
  gpsLat,
  gpsLon,
  routeCoordinates,
  style,
  isTop,
  onAction,
  onOpenDetails,
}: {
  stop: CompanionStop;
  totalKm: number;
  gpsLat: number | null;
  gpsLon: number | null;
  routeCoordinates?: [number, number][];
  style: React.CSSProperties;
  isTop: boolean;
  onAction: (action: VerificationAction) => Promise<boolean>;
  onOpenDetails?: (stop: CompanionStop) => void;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const startRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const offsetRef = useRef(0);
  const [offset, setOffset] = useState(0);
  const [exiting, setExiting] = useState<ExitDirection | null>(null);

  const applyOffset = useCallback((value: number) => {
    offsetRef.current = value;
    setOffset(value);
  }, []);

  useEffect(() => {
    applyOffset(0);
    setExiting(null);
  }, [applyOffset, stop.poiId, stop.zoneId]);

  const streetViewOptions = {
    routeCoordinates,
    totalDistanceKm: totalKm,
  };
  const streetView = useStreetViewLink(
    {
      lat: stop.lat,
      lon: stop.lon,
      placeId: stop.placeId,
      routeKm: stop.km,
      name: stop.name,
    },
    streetViewOptions,
  );

  const finishExit = useCallback(
    (direction: ExitDirection, action: VerificationAction) => {
      void (async () => {
        const ok = await onAction(action);
        if (!ok) {
          applyOffset(0);
          setExiting(null);
          return;
        }
        haptic(action === "verified" ? "success" : "light");
        setExiting(direction);
      })();
    },
    [applyOffset, onAction],
  );

  const finishSwipe = useCallback(
    (direction: "left" | "right") => {
      const action = direction === "right" ? "verified" : "skip";
      void (async () => {
        const ok = await onAction(action);
        if (!ok) {
          applyOffset(0);
          setExiting(null);
          return;
        }
        haptic(action === "verified" ? "success" : "light");
        setExiting(direction);
        const exitX = direction === "right" ? window.innerWidth * 1.2 : -window.innerWidth * 1.2;
        applyOffset(exitX);
      })();
    },
    [applyOffset, onAction],
  );

  function onPointerDown(event: React.PointerEvent) {
    if (!isTop || exiting) {
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest("a, button, summary, details")) {
      return;
    }
    startRef.current = { x: event.clientX, y: event.clientY, time: Date.now() };
    cardRef.current?.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent) {
    if (!isTop || !startRef.current || exiting) {
      return;
    }
    applyOffset(event.clientX - startRef.current.x);
  }

  function onPointerUp(event: React.PointerEvent) {
    if (!isTop || !startRef.current || exiting) {
      return;
    }
    const delta = event.clientX - startRef.current.x;
    startRef.current = null;

    if (Math.abs(delta) >= SWIPE_THRESHOLD) {
      finishSwipe(delta > 0 ? "right" : "left");
    } else {
      applyOffset(0);
    }

    try {
      cardRef.current?.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
  }

  const rotation = Math.max(-MAX_ROTATION, Math.min(MAX_ROTATION, offset / 24));
  const verifyOpacity = Math.min(1, Math.max(0, offset / SWIPE_THRESHOLD));
  const skipOpacity = Math.min(1, Math.max(0, -offset / SWIPE_THRESHOLD));
  const confidence = computeStopConfidence({
    verificationStatus: stop.verificationStatus,
    verifiedAt: stop.verificationDate,
    poiScore: stop.confidenceScore,
    openingHours: stop.openingHours,
    website: stop.website,
    phone: stop.phone,
  });
  const distanceLabel = stopDistanceLabel(stop, gpsLat, gpsLon);
  const mapsHref = googleMapsUrl(stop.lat, stop.lon, stop.placeId);

  const transform = exiting
    ? exitTransform(exiting)
    : `translate3d(${offset}px, 0, 0) rotate(${rotation}deg)`;

  return (
    <div
      ref={cardRef}
      className={`verification-swipe-card ${isTop ? "verification-swipe-card--top" : "verification-swipe-card--behind"}`}
      style={{
        zIndex: style.zIndex,
        transform,
        opacity: exiting ? 0 : 1,
        transition:
          exiting || offset === 0
            ? `transform ${EXIT_MS}ms cubic-bezier(0.22, 1, 0.36, 1), opacity ${EXIT_MS}ms ease`
            : "none",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div
        className="verification-swipe-card__stamp verification-swipe-card__stamp--verify"
        style={{ opacity: verifyOpacity }}
      >
        Verified
      </div>
      <div
        className="verification-swipe-card__stamp verification-swipe-card__stamp--reject"
        style={{ opacity: skipOpacity }}
      >
        Skip
      </div>

      <div className="verification-swipe-card__icon-block" aria-hidden>
        <span className="verification-swipe-card__icon">{stop.icon}</span>
        <span className="verification-swipe-card__icon-category">{stop.categoryLabel}</span>
      </div>

      <div className="verification-swipe-card__body">
        <div className="verification-swipe-card__title-block">
          <h3 className="verification-swipe-card__name">{stop.name}</h3>
          <p className="verification-swipe-card__meta">
            {formatKm(stop.km)}
            {distanceLabel ? ` · ${distanceLabel}` : ""}
          </p>
        </div>

        {streetView.available === false ? (
          <div className="verification-street-view-btn verification-street-view-btn--unavailable">
            <span>{streetView.unavailableMessage}</span>
            <a href={streetView.mapsUrl} target="_blank" rel="noreferrer">
              Google Maps
            </a>
          </div>
        ) : (
          <a
            href={streetView.streetViewUrl}
            target="_blank"
            rel="noreferrer"
            className="verification-street-view-btn"
            onClick={(event) => event.stopPropagation()}
          >
            {streetView.loading ? "Street View…" : "👁 Open Street View"}
          </a>
        )}

        <div className="verification-primary-actions">
          <button
            type="button"
            className="verification-primary-btn verification-primary-btn--verify"
            onClick={(event) => {
              event.stopPropagation();
              finishExit("right", "verified");
            }}
          >
            ✓ Verify
          </button>
          <button
            type="button"
            className="verification-primary-btn verification-primary-btn--skip"
            onClick={(event) => {
              event.stopPropagation();
              finishExit("left", "skip");
            }}
          >
            Skip
          </button>
        </div>

        <details className="verification-card-details">
          <summary>Details</summary>
          <dl className="verification-card-details__list">
            <div>
              <dt>Remaining</dt>
              <dd>{formatKm(Math.max(0, totalKm - stop.km))}</dd>
            </div>
            <div>
              <dt>Confidence</dt>
              <dd>
                <span
                  className={`verification-card-stats__badge ${stopConfidenceBadgeClass(confidence.level, true)}`}
                >
                  {confidence.label}
                </span>
              </dd>
            </div>
            <div>
              <dt>Last verified</dt>
              <dd>{formatVerifiedDate(stop.verificationDate)}</dd>
            </div>
            <div>
              <dt>Hours</dt>
              <dd>{stop.openingHours ?? "Unknown"}</dd>
            </div>
            <div>
              <dt>Services</dt>
              <dd>{serviceLabels(stop)}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{stopStatusLabel(stop.verificationStatus)}</dd>
            </div>
            {stop.notes ? (
              <div className="verification-card-details__full">
                <dt>Notes</dt>
                <dd>{stop.notes}</dd>
              </div>
            ) : null}
          </dl>
          <div className="verification-secondary-links px-3 pb-3">
            <a
              href={mapsHref}
              target="_blank"
              rel="noreferrer"
              className="verification-secondary-link"
              onClick={(event) => event.stopPropagation()}
            >
              Google Maps
            </a>
            {stop.website ? (
              <a
                href={normalizeWebsite(stop.website)}
                target="_blank"
                rel="noreferrer"
                className="verification-secondary-link"
                onClick={(event) => event.stopPropagation()}
              >
                Website
              </a>
            ) : null}
            {stop.phone ? (
              <a
                href={`tel:${stop.phone}`}
                className="verification-secondary-link"
                onClick={(event) => event.stopPropagation()}
              >
                Call
              </a>
            ) : null}
            {onOpenDetails ? (
              <button
                type="button"
                className="verification-secondary-link"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenDetails(stop);
                }}
              >
                Full detail sheet
              </button>
            ) : null}
          </div>
        </details>
      </div>
    </div>
  );
}

export default function VerificationSwipeStack({
  stops,
  totalKm,
  gpsLat,
  gpsLon,
  routeCoordinates,
  onAction,
  onOpenDetails,
}: VerificationSwipeStackProps) {
  const [index, setIndex] = useState(0);
  const prevLengthRef = useRef(stops.length);
  const current = stops[index] ?? null;
  const next = stops[index + 1] ?? null;

  useEffect(() => {
    const prevLength = prevLengthRef.current;
    prevLengthRef.current = stops.length;
    if (stops.length === 0) {
      setIndex(0);
      return;
    }
    if (stops.length < prevLength) {
      setIndex((value) => Math.min(value, stops.length - 1));
    }
  }, [stops.length]);

  const handleAction = useCallback(
    async (action: VerificationAction) => {
      if (!current) {
        return false;
      }
      return onAction(current, action);
    },
    [current, onAction],
  );

  if (!current) {
    return (
      <div className="verification-swipe-stack verification-swipe-stack--empty">
        <p className="text-lg font-medium text-white">All caught up!</p>
        <p className="mt-1 max-w-xs text-sm text-white/50">
          No stops need verification right now. Check back as you ride or open Desktop to review
          pending submissions.
        </p>
      </div>
    );
  }

  return (
    <div className="verification-swipe-stack">
      <div className="verification-swipe-stack__header">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/45">
          {index + 1} of {stops.length}
        </p>
        <p className="text-xs text-white/35">Street View → Verify or Skip</p>
      </div>

      <div className="verification-swipe-stack__deck">
        {next ? (
          <SwipeCard
            key={`${next.poiId ?? next.zoneId}-behind`}
            stop={next}
            totalKm={totalKm}
            gpsLat={gpsLat}
            gpsLon={gpsLon}
            routeCoordinates={routeCoordinates}
            isTop={false}
            style={{ zIndex: 1 }}
            onAction={() => Promise.resolve(false)}
          />
        ) : null}
        <SwipeCard
          key={`${current.poiId ?? current.zoneId}-${index}`}
          stop={current}
          totalKm={totalKm}
          gpsLat={gpsLat}
          gpsLon={gpsLon}
          routeCoordinates={routeCoordinates}
          isTop
          style={{ zIndex: 2 }}
          onAction={handleAction}
          onOpenDetails={onOpenDetails}
        />
      </div>
    </div>
  );
}
