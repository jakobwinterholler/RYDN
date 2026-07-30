/** Editorial elevation ribbon for Ultra Overview — ink on paper, not chart chrome. */

import { useMemo } from "react";
import type { UltraSleepMarker } from "../../types";

const W = 640;
const H = 88;
const PAD_X = 10;
const PAD_Y = 12;

interface Props {
  axisKm: number[];
  elevationM: (number | null)[];
  sleep?: UltraSleepMarker[];
  className?: string;
}

function extent(values: (number | null)[]): [number, number] {
  const nums = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (nums.length === 0) return [0, 1];
  let lo = Math.min(...nums);
  let hi = Math.max(...nums);
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const pad = (hi - lo) * 0.08;
  return [lo - pad, hi + pad];
}

export default function UltraElevProfile({
  axisKm,
  elevationM,
  sleep = [],
  className = "",
}: Props) {
  const drawn = useMemo(() => {
    const pts: { km: number; elev: number }[] = [];
    for (let i = 0; i < axisKm.length; i++) {
      const km = axisKm[i];
      const elev = elevationM[i];
      if (!Number.isFinite(km) || elev == null || !Number.isFinite(elev)) continue;
      pts.push({ km, elev });
    }
    if (pts.length < 2) return null;

    const minKm = pts[0].km;
    const maxKm = pts[pts.length - 1].km;
    const [lo, hi] = extent(pts.map((p) => p.elev));
    const sx = (km: number) => PAD_X + ((km - minKm) / (maxKm - minKm || 1)) * (W - 2 * PAD_X);
    const sy = (e: number) => PAD_Y + (1 - (e - lo) / (hi - lo || 1)) * (H - 2 * PAD_Y);

    let line = "";
    pts.forEach((p, i) => {
      line += `${i ? "L" : "M"}${sx(p.km).toFixed(1)} ${sy(p.elev).toFixed(1)} `;
    });
    const lineD = line.trim();
    const areaD = `${lineD} L${sx(maxKm).toFixed(1)} ${(H - PAD_Y).toFixed(1)} L${sx(minKm).toFixed(1)} ${(H - PAD_Y).toFixed(1)} Z`;

    const elevAt = (km: number): number => {
      let best = pts[0];
      let bestD = Math.abs(pts[0].km - km);
      for (const p of pts) {
        const d = Math.abs(p.km - km);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      return best.elev;
    };

    const dots = sleep
      .filter((s) => Number.isFinite(s.distanceKm) && s.distanceKm > minKm && s.distanceKm < maxKm)
      .map((s) => {
        const elev = s.elevationM != null && Number.isFinite(s.elevationM) ? s.elevationM : elevAt(s.distanceKm);
        return {
          dayIndex: s.dayIndex,
          x: sx(s.distanceKm),
          y: sy(elev),
        };
      });

    return { lineD, areaD, dots, maxKm: Math.round(maxKm) };
  }, [axisKm, elevationM, sleep]);

  if (!drawn) return null;

  const nightCount = drawn.dots.length;

  return (
    <div
      className={`ultra-elev ${className}`.trim()}
      role="img"
      aria-label={
        nightCount > 0
          ? `Elevation profile with ${nightCount} overnight stop${nightCount === 1 ? "" : "s"}`
          : "Elevation profile"
      }
    >
      <svg className="ultra-elev__svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <path d={drawn.areaD} className="ultra-elev__fill" />
        <path d={drawn.lineD} className="ultra-elev__line" fill="none" />
        {drawn.dots.map((d) => (
          <g key={`sleep-${d.dayIndex}`}>
            <circle cx={d.x} cy={d.y} r="4.2" className="ultra-elev__sleep-halo" />
            <circle cx={d.x} cy={d.y} r="2.4" className="ultra-elev__sleep" />
          </g>
        ))}
      </svg>
      <div className="ultra-elev__scale" aria-hidden>
        <span>0</span>
        {nightCount > 0 && (
          <span className="ultra-elev__nights">
            {nightCount} night{nightCount === 1 ? "" : "s"}
          </span>
        )}
        <span>{drawn.maxKm} km</span>
      </div>
    </div>
  );
}
