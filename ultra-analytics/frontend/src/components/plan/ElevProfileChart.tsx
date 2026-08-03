/**
 * Ride-mode elevation profile SVG — extracted from RidePanel (behavior unchanged).
 */

import { useMemo } from "react";
import {
  elevationAtKm,
  profileMarkerT,
  type ElevProfile,
} from "./rideElevation";

const PROFILE_W = 320;
const PROFILE_H = 72;
const PAD = 4;

export function ElevProfileChart({
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
