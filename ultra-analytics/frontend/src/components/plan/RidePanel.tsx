/**
 * Ride mode — consume the verified plan: glance metrics, sticky elev profile,
 * and a scroll timeline of verified stops. Plan search chrome stays in Plan.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { downloadRouteGpx } from "../../api";
import type { RecommendedStop } from "../../types";
import { ElevProfileChart } from "./ElevProfileChart";
import { RydnPlanIcon, iconForCategory } from "./icons";
import {
  elevationGainBetweenKm,
  hasUsableElevation,
  type ElevProfile,
} from "./rideElevation";
import {
  fmtRideElev,
  fmtRideKm,
  nextRideGlance,
  verifiedLegs,
} from "./rideStops";
import type { RideLocationStatus } from "./useRideLocation";

type Props = {
  routeId: string;
  routeName?: string;
  verified: RecommendedStop[];
  profile: ElevProfile | null | undefined;
  rideKm: number;
  routeDistanceKm: number;
  selectedId: string | null;
  liveStatus?: RideLocationStatus;
  liveOffRouteM?: number | null;
  /** When true, scroll timeline does not override GPS-driven km. */
  gpsDrivesKm?: boolean;
  onRideKmChange: (km: number) => void;
  onSelectStop: (id: string) => void;
  onProRequired?: () => void;
};

function liveStatusLabel(status: RideLocationStatus | undefined): string | null {
  if (!status || status === "idle") return null;
  if (status === "requesting") return "Locating…";
  if (status === "tracking") return "Live";
  if (status === "off_route") return "Off route";
  if (status === "denied") return "Location denied";
  if (status === "unavailable") return "Location unavailable";
  return null;
}

export default function RidePanel({
  routeId,
  routeName,
  verified,
  profile,
  rideKm,
  routeDistanceKm,
  selectedId,
  liveStatus = "idle",
  liveOffRouteM = null,
  gpsDrivesKm = false,
  onRideKmChange,
  onSelectStop,
  onProRequired,
}: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Map<string, HTMLElement>>(new Map());
  const onKmRef = useRef(onRideKmChange);
  const gpsDrivesRef = useRef(gpsDrivesKm);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const onExportGpx = async () => {
    if (exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      const fallback = `${(routeName || "route").replace(/[^\w\-]+/g, "_") || "route"}.gpx`;
      await downloadRouteGpx(routeId, fallback);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not export GPX.";
      if (/pro|race pass|upgrade|forbidden|403/i.test(msg) && onProRequired) {
        onProRequired();
        setExportError(null);
      } else {
        setExportError(msg);
      }
    } finally {
      setExporting(false);
    }
  };
  const rideKmRef = useRef(rideKm);
  const [activeId, setActiveId] = useState<string | null>(null);
  const elevOk = hasUsableElevation(profile);

  useEffect(() => {
    onKmRef.current = onRideKmChange;
  }, [onRideKmChange]);
  useEffect(() => {
    rideKmRef.current = rideKm;
  }, [rideKm]);
  useEffect(() => {
    gpsDrivesRef.current = gpsDrivesKm;
  }, [gpsDrivesKm]);

  const legs = useMemo(() => verifiedLegs(verified, profile), [verified, profile]);
  const glance = useMemo(
    () => nextRideGlance(verified, rideKm, profile),
    [verified, rideKm, profile],
  );
  const remainingKm = Math.max(0, routeDistanceKm - rideKm);
  const remainingElev = elevationGainBetweenKm(profile, rideKm, routeDistanceKm);
  const liveLabel = liveStatusLabel(liveStatus);

  // Sync elevation marker to the topmost visible verified card.
  useEffect(() => {
    const root = listRef.current;
    if (!root || !verified.length) return;

    const sync = () => {
      const rootTop = root.getBoundingClientRect().top;
      let bestId: string | null = null;
      let bestTop = -Infinity;
      let fallbackId: string | null = null;
      let fallbackTop = Infinity;
      for (const s of verified) {
        const el = cardRefs.current.get(s.id);
        if (!el) continue;
        const top = el.getBoundingClientRect().top - rootTop;
        if (top < fallbackTop) {
          fallbackTop = top;
          fallbackId = s.id;
        }
        // Topmost card that has reached/passed the pin line at the list top.
        if (top <= 14 && top >= bestTop) {
          bestTop = top;
          bestId = s.id;
        }
      }
      if (!bestId) bestId = fallbackId ?? verified[0]?.id ?? null;
      if (!bestId) return;
      setActiveId(bestId);
      // When GPS drives progress, scroll only highlights — don't jump the marker.
      if (gpsDrivesRef.current) return;
      const stop = verified.find((s) => s.id === bestId);
      if (stop && Math.abs(stop.distanceAlongKm - rideKmRef.current) > 0.05) {
        onKmRef.current(stop.distanceAlongKm);
      }
    };

    sync();
    root.addEventListener("scroll", sync, { passive: true });
    return () => root.removeEventListener("scroll", sync);
  }, [verified]);

  const focusStop = (id: string) => {
    onSelectStop(id);
    const stop = verified.find((s) => s.id === id);
    if (!stop) return;
    onRideKmChange(stop.distanceAlongKm);
    setActiveId(id);
    const el = cardRefs.current.get(id);
    const root = listRef.current;
    if (el && root) {
      const delta = el.getBoundingClientRect().top - root.getBoundingClientRect().top;
      root.scrollBy({ top: delta - 8, behavior: "smooth" });
    }
  };

  return (
    <aside className="ride-panel" aria-label="Ride mode">
      <div className="ride-panel__sticky">
        <ElevProfileChart
          profile={profile || []}
          markerKm={rideKm}
          available={elevOk}
        />

        <div className="ride-glance-bar" aria-label="Next verified resupply">
          <button
            type="button"
            className="ride-glance-bar__cell"
            disabled={!glance.water}
            onClick={() => glance.water && focusStop(glance.water.stop.id)}
          >
            <span className="ride-glance-bar__label">Next water</span>
            {glance.water ? (
              <>
                <span className="ride-glance-bar__num">
                  {fmtRideKm(glance.water.distanceKm)}
                </span>
                <span className="ride-glance-bar__sub">
                  {elevOk ? fmtRideElev(glance.water.elevGainM, true) : "elev n/a"}
                </span>
              </>
            ) : (
              <span className="ride-glance-bar__num ride-glance-bar__num--empty">—</span>
            )}
          </button>
          <button
            type="button"
            className="ride-glance-bar__cell"
            disabled={!glance.shop}
            onClick={() => glance.shop && focusStop(glance.shop.stop.id)}
          >
            <span className="ride-glance-bar__label">Next shop</span>
            {glance.shop ? (
              <>
                <span className="ride-glance-bar__num">
                  {fmtRideKm(glance.shop.distanceKm)}
                </span>
                <span className="ride-glance-bar__sub">
                  {elevOk ? fmtRideElev(glance.shop.elevGainM, true) : "elev n/a"}
                </span>
              </>
            ) : (
              <span className="ride-glance-bar__num ride-glance-bar__num--empty">—</span>
            )}
          </button>
          <div className="ride-glance-bar__cell ride-glance-bar__cell--remain" aria-label="Remaining">
            <span className="ride-glance-bar__label">Remaining</span>
            <span className="ride-glance-bar__num">{fmtRideKm(remainingKm)}</span>
            <span className="ride-glance-bar__sub">
              {elevOk ? fmtRideElev(remainingElev, true) : "elev n/a"}
            </span>
          </div>
        </div>

        <p className="ride-panel__meta">
          {liveLabel ? (
            <>
              <span
                className={`ride-panel__live${
                  liveStatus === "tracking"
                    ? " ride-panel__live--on"
                    : liveStatus === "off_route"
                      ? " ride-panel__live--warn"
                      : ""
                }`}
              >
                {liveLabel}
                {liveStatus === "off_route" && liveOffRouteM != null
                  ? ` · ${Math.round(liveOffRouteM)} m`
                  : ""}
              </span>
              <span aria-hidden> · </span>
            </>
          ) : null}
          Km {rideKm.toFixed(0)}
          <span aria-hidden> · </span>
          {verified.length} verified
          {!elevOk ? <span className="ride-panel__meta-warn"> · elev unavailable</span> : null}
          {liveStatus === "denied" ? (
            <span className="ride-panel__meta-warn">
              {" "}
              · Enable location for live progress
            </span>
          ) : null}
        </p>
      </div>

      <div className="ride-panel__list" ref={listRef} data-testid="ride-stop-list">
        {legs.length === 0 ? (
          <p className="ride-panel__empty">
            No verified stops yet. Switch to Plan and verify water and shops along the route.
          </p>
        ) : (
          legs.map((leg) => {
            const s = leg.stop;
            const active = s.id === activeId || s.id === selectedId;
            return (
              <div key={s.id} className="ride-stop-block">
                <div className="ride-leg-gap" aria-label="Distance from previous">
                  <span>
                    {leg.isFirst ? "From start" : "From last"}
                    <span aria-hidden> · </span>
                    {fmtRideKm(leg.distanceKm)}
                  </span>
                  <span>{fmtRideElev(leg.elevGainM, elevOk)}</span>
                </div>
                <button
                  type="button"
                  className={`ride-stop-card${active ? " is-active" : ""}`}
                  data-ride-stop={s.id}
                  data-km={s.distanceAlongKm}
                  ref={(el) => {
                    if (el) cardRefs.current.set(s.id, el);
                    else cardRefs.current.delete(s.id);
                  }}
                  onClick={() => focusStop(s.id)}
                >
                  <span className="ride-stop-card__icon" aria-hidden>
                    <RydnPlanIcon id={iconForCategory(s.category, s.group)} size={24} />
                  </span>
                  <span className="ride-stop-card__body">
                    <span className="ride-stop-card__cat">{s.category}</span>
                    <span className="ride-stop-card__name">
                      {s.name || s.category || "Stop"}
                    </span>
                    <span className="ride-stop-card__km">
                      km {s.distanceAlongKm.toFixed(0)}
                      {s.is24h ? " · 24h" : ""}
                    </span>
                  </span>
                </button>
              </div>
            );
          })
        )}
        <div className="ride-panel__export">
          <button
            type="button"
            className="btn btn--secondary ride-panel__export-btn"
            data-testid="ride-export-gpx"
            disabled={exporting}
            aria-busy={exporting || undefined}
            onClick={() => void onExportGpx()}
          >
            {exporting ? "Exporting…" : "Export for GPS"}
          </button>
          <p className="ride-panel__export-hint">
            GPX with your route plus verified water, shops, hotels, cafes, and checkpoints
          </p>
          {exportError ? (
            <p className="ride-panel__export-error" role="alert">
              {exportError}
            </p>
          ) : null}
        </div>
        <div className="ride-panel__list-end" aria-hidden />
      </div>
    </aside>
  );
}
