/**
 * Ride mode — consume the verified plan: glance metrics, sticky elev profile,
 * and a scroll timeline of verified stops. Plan search chrome stays in Plan.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { downloadRouteGpx } from "../../api";
import type { RecommendedStop } from "../../types";
import { RydnPlanIcon, iconForCategory } from "./icons";
import {
  elevationAtKm,
  hasUsableElevation,
  profileMarkerT,
  type ElevProfile,
} from "./rideElevation";
import {
  fmtRideElev,
  fmtRideKm,
  nextRideGlance,
  verifiedLegs,
} from "./rideStops";

const PROFILE_W = 320;
const PROFILE_H = 72;
const PAD = 4;

type Props = {
  routeId: string;
  routeName?: string;
  verified: RecommendedStop[];
  profile: ElevProfile | null | undefined;
  rideKm: number;
  routeDistanceKm: number;
  selectedId: string | null;
  onRideKmChange: (km: number) => void;
  onSelectStop: (id: string) => void;
  onProRequired?: () => void;
};

function ElevProfileChart({
  profile,
  markerKm,
  available,
}: {
  profile: ElevProfile;
  markerKm: number;
  available: boolean;
}) {
  const pts = useMemo(() => {
    const out: { d: number; e: number }[] = [];
    for (const p of profile) {
      const d = Number(p[0]);
      const e = Number(p[1]);
      if (Number.isFinite(d) && Number.isFinite(e)) out.push({ d, e });
    }
    return out;
  }, [profile]);

  if (!available || pts.length < 2) {
    return (
      <div className="ride-elev ride-elev--empty" role="img" aria-label="Elevation unavailable">
        <p className="ride-elev__note">Elevation unavailable</p>
      </div>
    );
  }

  let minE = Infinity;
  let maxE = -Infinity;
  const minD = pts[0].d;
  const maxD = pts[pts.length - 1].d;
  for (const p of pts) {
    if (p.e < minE) minE = p.e;
    if (p.e > maxE) maxE = p.e;
  }
  if (minE === maxE) {
    minE -= 1;
    maxE += 1;
  }

  const sx = (d: number) => PAD + ((d - minD) / (maxD - minD || 1)) * (PROFILE_W - 2 * PAD);
  const sy = (e: number) => PAD + (1 - (e - minE) / (maxE - minE || 1)) * (PROFILE_H - 2 * PAD);

  let line = "";
  pts.forEach((p, i) => {
    line += `${i ? "L" : "M"}${sx(p.d).toFixed(1)} ${sy(p.e).toFixed(1)} `;
  });
  const area = `${line.trim()} L${sx(maxD).toFixed(1)} ${(PROFILE_H - PAD).toFixed(1)} L${sx(minD).toFixed(1)} ${(PROFILE_H - PAD).toFixed(1)} Z`;
  const pairProfile = pts.map((p) => [p.d, p.e] as [number, number]);
  const t = profileMarkerT(pairProfile, markerKm);
  const mx = PAD + t * (PROFILE_W - 2 * PAD);
  const elev = elevationAtKm(pairProfile, markerKm) ?? pts[pts.length - 1].e;

  const markLeft = (mx / PROFILE_W) * 100;
  const markTop = (sy(elev) / PROFILE_H) * 100;

  return (
    <div className="ride-elev" role="img" aria-label={`Elevation at km ${markerKm.toFixed(0)}`}>
      <div className="ride-elev__frame">
        {/*
          Paths stretch with preserveAspectRatio=none; the progress mark is HTML so
          it stays a perfect circle under that non-uniform scale.
        */}
        <svg
          className="ride-elev__svg"
          viewBox={`0 0 ${PROFILE_W} ${PROFILE_H}`}
          preserveAspectRatio="none"
        >
          <path d={area} className="ride-elev__fill" />
          <path d={line.trim()} className="ride-elev__line" fill="none" />
          <line
            x1={mx}
            y1={PAD}
            x2={mx}
            y2={PROFILE_H - PAD}
            className="ride-elev__marker"
          />
        </svg>
        <div className="ride-elev__marks" aria-hidden>
          <span
            className="ride-elev__dot-mark"
            style={{ left: `${markLeft}%`, top: `${markTop}%` }}
          />
        </div>
      </div>
      <div className="ride-elev__scale" aria-hidden>
        <span>0</span>
        <span>{Math.round(maxD)} km</span>
      </div>
    </div>
  );
}

export default function RidePanel({
  routeId,
  routeName,
  verified,
  profile,
  rideKm,
  routeDistanceKm,
  selectedId,
  onRideKmChange,
  onSelectStop,
  onProRequired,
}: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Map<string, HTMLElement>>(new Map());
  const onKmRef = useRef(onRideKmChange);
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

  const legs = useMemo(() => verifiedLegs(verified, profile), [verified, profile]);
  const glance = useMemo(
    () => nextRideGlance(verified, rideKm, profile),
    [verified, rideKm, profile],
  );

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
        </div>

        <p className="ride-panel__meta">
          Km {rideKm.toFixed(0)}
          <span aria-hidden> · </span>
          {verified.length} verified
          {!elevOk ? <span className="ride-panel__meta-warn"> · elev unavailable</span> : null}
          <span aria-hidden> · </span>
          {Math.round(routeDistanceKm)} km total
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
            GPX with your route plus verified water, shops, and hotels
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
