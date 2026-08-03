import type { CurvePoint } from "../../types";

/** Canonical duration anchors riders care about (matches backend DURATIONS). */
export const CURVE_ANCHORS = [5, 15, 30, 60, 300, 1200, 3600, 7200, 14400, 28800] as const;

/** Prefer these when picking a default selected duration (training → ultra). */
const DEFAULT_PREFER = [1200, 3600, 300, 7200, 14400, 60, 30, 15, 5];

export function fmtDur(s: number): string {
  const sec = Math.max(0, Math.round(s));
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) {
    const m = Math.floor(sec / 60);
    const r = sec % 60;
    // Timeline scrub readout: show mm:ss when not on a whole minute.
    if (r === 0) return `${m}m`;
    return `${m}:${String(r).padStart(2, "0")}`;
  }
  const h = sec / 3600;
  if (Number.isInteger(h)) return `${h}h`;
  const wholeH = Math.floor(h);
  const remM = Math.round((sec % 3600) / 60);
  if (remM === 0) return `${wholeH}h`;
  if (remM === 60) return `${wholeH + 1}h`;
  return `${wholeH}h ${remM}m`;
}

/** Nearest sample on a series — never require an exact duration match. */
export function nearestPoint(points: CurvePoint[], d: number): CurvePoint | null {
  if (!points.length) return null;
  let best = points[0];
  let bestDist = Math.abs(points[0].d - d);
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    const dist = Math.abs(p.d - d);
    if (dist < bestDist) {
      best = p;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * Value on the curve at any duration — linear in log-time between samples
 * so the playhead rides the polyline smoothly while scrubbing.
 */
export function interpolateAt(points: CurvePoint[], d: number): CurvePoint | null {
  const pts = points.filter((p) => p.d >= 5).slice().sort((a, b) => a.d - b.d);
  if (!pts.length) return null;
  if (d <= pts[0].d) return { d: pts[0].d, v: pts[0].v };
  const last = pts[pts.length - 1];
  if (d >= last.d) return { d: last.d, v: last.v };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (d > b.d) continue;
    const la = Math.log10(Math.max(1, a.d));
    const lb = Math.log10(Math.max(1, b.d));
    const lt = Math.log10(Math.max(1, d));
    const t = (lt - la) / (lb - la || 1);
    return { d, v: a.v + t * (b.v - a.v) };
  }
  return { d: last.d, v: last.v };
}

export function valueAt(points: CurvePoint[], d: number): number | null {
  return interpolateAt(points, d)?.v ?? null;
}

/** Durations present on at least one series (≥ 5s). */
export function unionDurations(seriesPoints: CurvePoint[][]): number[] {
  const set = new Set<number>();
  for (const pts of seriesPoints) {
    for (const p of pts) {
      if (p.d >= 5) set.add(p.d);
    }
  }
  return Array.from(set).sort((a, b) => a - b);
}

/** Default selected duration: 20m when possible, else 1h, else best available. */
export function defaultDuration(
  allD: number[],
  prefer: readonly number[] = DEFAULT_PREFER,
): number | null {
  if (allD.length === 0) return null;
  for (const d of prefer) {
    if (allD.includes(d)) return d;
  }
  const long = allD.filter((d) => d >= 60);
  if (long.length) return long[Math.min(long.length - 1, Math.floor(long.length / 2))];
  return allD[Math.floor(allD.length / 2)];
}

/** Highlight chips from anchors that exist on the curve. */
export function anchorDurations(points: CurvePoint[], anchors: readonly number[] = CURVE_ANCHORS): number[] {
  const have = new Set(points.map((p) => p.d));
  return anchors.filter((d) => have.has(d));
}

/** Elevation gain (m) → climbing rate (m/h) for each window. */
export function toClimbingRate(points: CurvePoint[]): CurvePoint[] {
  return points
    .filter((p) => p.d > 0)
    .map((p) => ({ d: p.d, v: Math.round((p.v / p.d) * 3600) }));
}

/** Nice axis ceiling for positive metrics. */
export function niceCeil(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 1;
  const exp = Math.floor(Math.log10(v));
  const f = v / 10 ** exp;
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nf * 10 ** exp;
}

export function yTicks(vLo: number, vHi: number, count = 4): number[] {
  if (vHi <= vLo) return [vLo];
  const step = (vHi - vLo) / (count - 1);
  return Array.from({ length: count }, (_, i) => vLo + step * i).reverse();
}

/** Duration nearest to a chart x position (viewBox coords) — discrete snap. */
export function durationNearX(
  allD: number[],
  px: number,
  sx: (d: number) => number,
): number | null {
  if (allD.length === 0) return null;
  let best = allD[0];
  let bestDist = Infinity;
  for (const d of allD) {
    const dist = Math.abs(sx(d) - px);
    if (dist < bestDist) {
      bestDist = dist;
      best = d;
    }
  }
  return best;
}

/**
 * Continuous duration from chart x (viewBox coords) on the log-time axis.
 * Clamped to [dLo, dHi] — video-timeline scrubbing.
 */
export function durationFromX(
  px: number,
  dLo: number,
  dHi: number,
  padL: number,
  innerW: number,
): number {
  const t = Math.max(0, Math.min(1, (px - padL) / (innerW || 1)));
  const lx = (d: number) => Math.log10(Math.max(1, d));
  const logD = lx(dLo) + t * (lx(dHi) - lx(dLo));
  return Math.max(dLo, Math.min(dHi, 10 ** logD));
}

/** Nearest duration in a list (for chip highlight while scrubbing freely). */
export function nearestDuration(durations: number[], d: number): number | null {
  if (!durations.length) return null;
  let best = durations[0];
  let bestDist = Math.abs(durations[0] - d);
  for (let i = 1; i < durations.length; i++) {
    const dist = Math.abs(durations[i] - d);
    if (dist < bestDist) {
      best = durations[i];
      bestDist = dist;
    }
  }
  return best;
}
