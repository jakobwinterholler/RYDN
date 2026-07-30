/** Elevation helpers for Ride mode — profile is [[km, elevM], ...]. */

export type ElevProfile = ReadonlyArray<readonly [number, number] | number[]>;

export function hasUsableElevation(profile: ElevProfile | null | undefined): boolean {
  if (!profile || profile.length < 2) return false;
  let n = 0;
  for (const p of profile) {
    const e = p[1];
    if (typeof e === "number" && Number.isFinite(e)) n += 1;
    if (n >= 2) return true;
  }
  return false;
}

/** Interpolate elevation at route km (linear between samples). */
export function elevationAtKm(profile: ElevProfile, km: number): number | null {
  if (!profile.length) return null;
  const k = Number(km);
  if (!Number.isFinite(k)) return null;

  let prev: { d: number; e: number } | null = null;
  for (const p of profile) {
    const d = Number(p[0]);
    const e = Number(p[1]);
    if (!Number.isFinite(d) || !Number.isFinite(e)) continue;
    if (d >= k) {
      if (!prev) return e;
      const span = d - prev.d;
      if (span <= 0) return e;
      const t = (k - prev.d) / span;
      return prev.e + t * (e - prev.e);
    }
    prev = { d, e };
  }
  return prev?.e ?? null;
}

/**
 * Positive elevation gain (ascent only) between two distances along the route.
 * Tiny wiggles below `noiseM` are ignored so flat stretches don't accumulate.
 * Returns null when the profile is missing or unusable.
 */
export function elevationGainBetweenKm(
  profile: ElevProfile | null | undefined,
  fromKm: number,
  toKm: number,
  noiseM = 0.7,
): number | null {
  if (!hasUsableElevation(profile)) return null;
  const a = Number(fromKm);
  const b = Number(toKm);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;

  const samples: number[] = [];
  const startE = elevationAtKm(profile!, a);
  if (startE != null) samples.push(startE);

  for (const p of profile!) {
    const d = Number(p[0]);
    const e = Number(p[1]);
    if (!Number.isFinite(d) || !Number.isFinite(e)) continue;
    if (d <= a || d >= b) continue;
    samples.push(e);
  }

  const endE = elevationAtKm(profile!, b);
  if (endE != null) samples.push(endE);

  if (samples.length < 2) return 0;

  let gain = 0;
  let last = samples[0];
  for (let i = 1; i < samples.length; i++) {
    const e = samples[i];
    const delta = e - last;
    if (delta >= noiseM) {
      gain += delta;
      last = e;
    } else if (delta <= -noiseM) {
      last = e;
    }
  }
  return Math.round(gain);
}

/** X position 0–1 along the profile for a route km (for SVG marker). */
export function profileMarkerT(profile: ElevProfile, km: number): number {
  if (!profile.length) return 0;
  let minD = Infinity;
  let maxD = -Infinity;
  for (const p of profile) {
    const d = Number(p[0]);
    if (!Number.isFinite(d)) continue;
    if (d < minD) minD = d;
    if (d > maxD) maxD = d;
  }
  if (!Number.isFinite(minD) || !Number.isFinite(maxD) || maxD <= minD) return 0;
  const t = (Number(km) - minD) / (maxD - minD);
  return Math.max(0, Math.min(1, t));
}
