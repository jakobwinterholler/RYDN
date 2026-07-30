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

export function bboxSpanTooLarge(
  bbox: PlanSearchBBox | null | undefined,
  maxSpan = SEARCH_MAX_SPAN_DEG,
): boolean {
  if (!bbox) return false;
  const lat = bbox.north - bbox.south;
  const lon = Math.abs(bbox.east - bbox.west);
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
  /** Quick Action category selected (Water / Markets / 24h / Sleep). */
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
