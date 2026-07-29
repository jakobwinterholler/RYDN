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
 */
export function resolvePlanSearchChip(opts: {
  mode: "plan" | "ride";
  searching: boolean;
  /** User moved the map since the last finished search (success). */
  prompted: boolean;
  bbox: PlanSearchBBox | null;
}): PlanSearchChip {
  if (opts.mode !== "plan") return "hidden";
  if (opts.searching) return "searching";
  if (!opts.prompted) return "hidden";
  if (bboxSpanTooLarge(opts.bbox)) return "zoomIn";
  return "ready";
}

export function isZoomInSearchError(message: string | null | undefined): boolean {
  if (!message) return false;
  return /zoom in/i.test(message);
}
