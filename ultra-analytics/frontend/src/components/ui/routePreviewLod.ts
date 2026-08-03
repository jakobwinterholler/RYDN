/**
 * RoutePreview map LOD — driven by geographic view span (bbox), not route length.
 *
 * A 600 km loop and a 230 km one-way with the same footprint share detail.
 * Munich→Oviedo (~2300 km path, ~1450 km bbox diagonal) anchors outline density.
 *
 * Trips thumbs stay quieter atlas plates. Certificate / share (detail) with a
 * compact footprint uses a local basemap (lakes/roads/places) — country polygons
 * alone leave inland rides on blank land.
 */

export type ThumbLodTier = "fine" | "standard" | "outline";

export type LodProfile = "thumb" | "detail";

export type ThumbLodStyle = {
  fill: number;
  routePts: number;
  borderW: number;
  routeW: number;
  digits: number;
  simplify: number;
  useFineAtlas: boolean;
  tier: ThumbLodTier;
};

/** Below this bbox diagonal (km): max coast fidelity (Trips thumbs). */
export const LOD_FINE_SPAN_KM = 380;
/**
 * Munich→Oviedo corridor bbox diagonal (~1450 km). At/above this span, density
 * matches the current outline plate (continental reference look).
 */
export const LOD_OUTLINE_SPAN_KM = 1450;
/** Prefer countriesFine while the viewport is still zoomed in enough for coasts. */
export const LOD_FINE_ATLAS_SPAN_KM = 720;

/**
 * Certificate / share detail: peak fidelity extends further than tiny thumbs
 * so short–medium day rides resolve coasts without waiting for thumb-scale zoom.
 */
export const DETAIL_FINE_SPAN_KM = 520;
/**
 * Keep the fine atlas on share plates through medium regional spans
 * (thumbs drop earlier for paint cost on the shelf).
 */
export const DETAIL_FINE_ATLAS_SPAN_KM = 960;
/** Same quiet Munich→Oviedo end-anchor as thumbs. */
export const DETAIL_OUTLINE_SPAN_KM = LOD_OUTLINE_SPAN_KM;

/**
 * Detail / share: below this bbox diagonal (km), prefer MapLibre local geography
 * over country-only atlas. Inland Bavaria-class rides (~40–200 km span) need
 * lakes + roads; wide multi-country certificates stay atlas-quiet.
 */
export const DETAIL_LOCAL_BASEMAP_SPAN_KM = 720;

const ANCHOR_FINE = { fill: 0.62, routePts: 96, borderW: 1.45, routeW: 2.1, simplify: 0 };
/** Visual density locked to today’s Munich→Oviedo outline card. */
const ANCHOR_OUTLINE = { fill: 0.88, routePts: 36, borderW: 1.05, routeW: 1.7, simplify: 2.4 };

function clamp01(t: number): number {
  return t <= 0 ? 0 : t >= 1 ? 1 : t;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

function thresholdsFor(profile: LodProfile) {
  if (profile === "detail") {
    return {
      fineSpan: DETAIL_FINE_SPAN_KM,
      outlineSpan: DETAIL_OUTLINE_SPAN_KM,
      fineAtlas: DETAIL_FINE_ATLAS_SPAN_KM,
    };
  }
  return {
    fineSpan: LOD_FINE_SPAN_KM,
    outlineSpan: LOD_OUTLINE_SPAN_KM,
    fineAtlas: LOD_FINE_ATLAS_SPAN_KM,
  };
}

/**
 * Continuous LOD from bbox diagonal km.
 * countryCount is secondary only (slight coarser nudge when many borders crowd a mid-span view).
 * `profile: "detail"` is slightly more aggressive on fine atlas / peak fidelity than thumbs.
 */
/**
 * Compact detail plates need lakes/roads/places — country polygons fill the
 * frame with solid land when no border/coast is in view.
 * Thumbs always stay atlas (paint cost + quieter Trips shelf).
 */
export function preferLocalBasemap(
  spanKm: number,
  profile: LodProfile = "detail",
): boolean {
  if (profile !== "detail") return false;
  return Math.max(0, spanKm) < DETAIL_LOCAL_BASEMAP_SPAN_KM;
}

export function lodStyleFromViewSpan(
  spanKm: number,
  countryCount = 1,
  profile: LodProfile = "thumb",
): ThumbLodStyle {
  const { fineSpan, outlineSpan, fineAtlas } = thresholdsFor(profile);
  let s = Math.max(0, spanKm);
  if (countryCount >= 5) s *= 1.1;
  else if (countryCount >= 3) s *= 1.05;

  const t = smoothstep((s - fineSpan) / (outlineSpan - fineSpan));
  const fill = lerp(ANCHOR_FINE.fill, ANCHOR_OUTLINE.fill, t);
  const routePts = Math.round(lerp(ANCHOR_FINE.routePts, ANCHOR_OUTLINE.routePts, t));
  const borderW = lerp(ANCHOR_FINE.borderW, ANCHOR_OUTLINE.borderW, t);
  const routeW = lerp(ANCHOR_FINE.routeW, ANCHOR_OUTLINE.routeW, t);
  const simplify = lerp(ANCHOR_FINE.simplify, ANCHOR_OUTLINE.simplify, t);
  const digits = t < 0.35 ? 2 : 1;
  const useFineAtlas = s < fineAtlas;
  const tier: ThumbLodTier = t < 0.28 ? "fine" : t < 0.62 ? "standard" : "outline";
  return { fill, routePts, borderW, routeW, digits, simplify, useFineAtlas, tier };
}
