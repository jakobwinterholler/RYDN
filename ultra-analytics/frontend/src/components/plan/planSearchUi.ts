/** Exclusive Planning search-chip state machine (Google Maps pattern). */

export type PlanSearchChip = "hidden" | "ready" | "searching" | "zoomIn";

/** Match backend viewport clamp — no Search API when span exceeds this. */
export const SEARCH_MAX_SPAN_DEG = 2.5;

export interface PlanSearchBBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** Wrap longitude into (-180, 180]. MapLibre can leave ±360·k after world-copy pans. */
export function wrapLongitude(lon: number): number {
  if (!Number.isFinite(lon)) return lon;
  const x = ((((lon + 180) % 360) + 360) % 360) - 180;
  return x === -180 ? 180 : x;
}

/**
 * Snap a MapLibre viewport bbox into the principal lon range while preserving span.
 * Unwrapped desktop bounds (e.g. west=361.8) otherwise miss corridor POIs at lon≈2.
 */
export function normalizePlanSearchBBox(bbox: PlanSearchBBox): PlanSearchBBox {
  let south = bbox.south;
  let north = bbox.north;
  if (south > north) {
    const t = south;
    south = north;
    north = t;
  }
  let west = bbox.west;
  let east = bbox.east;
  let spanLon = east - west;
  if (spanLon < 0) {
    // Inverted / dateline — try independent wrap into a principal box.
    const w2 = wrapLongitude(west);
    const e2 = wrapLongitude(east);
    if (w2 < e2) {
      west = w2;
      east = e2;
      spanLon = east - west;
    } else {
      // Keep mid±half on the absolute span so callers can still reject via span checks.
      const mid = wrapLongitude((bbox.west + bbox.east) / 2);
      const half = Math.abs(bbox.east - bbox.west) / 2;
      return { south, west: mid - half, north, east: mid + half };
    }
  }
  const mid = wrapLongitude((west + east) / 2);
  const half = spanLon / 2;
  return {
    south,
    west: mid - half,
    north,
    east: mid + half,
  };
}

/** True when the map has not laid out yet (0×0) or bounds are unusable. */
export function isDegeneratePlanSearchBBox(bbox: PlanSearchBBox | null | undefined): boolean {
  if (!bbox) return true;
  const n = normalizePlanSearchBBox(bbox);
  if (![n.south, n.west, n.north, n.east].every(Number.isFinite)) return true;
  return n.north - n.south < 1e-9 || n.east - n.west < 1e-9 || n.west >= n.east;
}

export function bboxSpanTooLarge(
  bbox: PlanSearchBBox | null | undefined,
  maxSpan = SEARCH_MAX_SPAN_DEG,
): boolean {
  if (!bbox || isDegeneratePlanSearchBBox(bbox)) return false;
  const n = normalizePlanSearchBBox(bbox);
  const lat = n.north - n.south;
  const lon = Math.abs(n.east - n.west);
  return lat > maxSpan || lon > maxSpan;
}

/**
 * Resolve the single search UI state.
 * Only one of: hidden | ready | searching | zoomIn.
 *
 * "Search this area" appears only after map move AND a category is selected.
 */
export function resolvePlanSearchChip(opts: {
  mode: "plan" | "ride";
  searching: boolean;
  /** User moved the map since the last finished search. */
  prompted: boolean;
  /** Quick Action category selected (Water / Shops / Sleep). */
  hasCategory: boolean;
  bbox: PlanSearchBBox | null;
}): PlanSearchChip {
  if (opts.mode !== "plan") return "hidden";
  if (opts.searching) return "searching";
  if (!opts.prompted || !opts.hasCategory) return "hidden";
  if (bboxSpanTooLarge(opts.bbox)) return "zoomIn";
  return "ready";
}

export function isZoomInSearchError(message: string | null | undefined): boolean {
  if (!message) return false;
  return /zoom in/i.test(message);
}

/** Cap temporary search results by viewport span — quality over quantity (3–15). */
export function searchResultLimitForBbox(bbox: PlanSearchBBox): number {
  const span = Math.max(bbox.north - bbox.south, Math.abs(bbox.east - bbox.west));
  if (span > 1.2) return 3;
  if (span > 0.55) return 6;
  if (span > 0.22) return 10;
  return 15;
}
