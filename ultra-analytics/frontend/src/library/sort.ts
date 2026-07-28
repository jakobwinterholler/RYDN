/** Ride Library sorting — registry of options, compare helpers, session persistence.

Add a new option by appending to LIBRARY_SORT_OPTIONS with an id, label, and
numeric compare. Persistence and the Sort by control pick it up automatically.
*/

import type { RideSummary } from "../types";

export type LibrarySortId =
  | "date-desc"
  | "date-asc"
  | "distance-desc"
  | "distance-asc";
// Future: "elevation-desc" | "elevation-asc" | "moving-desc" | "elapsed-desc" | "avg-speed-desc" | …

export interface LibrarySortOption {
  id: LibrarySortId;
  label: string;
  compare: (a: RideSummary, b: RideSummary) => number;
}

const STORAGE_KEY = "rydn.library.sort";

export const DEFAULT_LIBRARY_SORT: LibrarySortId = "date-desc";

function dateMs(ride: RideSummary): number {
  if (!ride.date) return Number.NaN;
  const t = Date.parse(ride.date);
  return Number.isFinite(t) ? t : Number.NaN;
}

function num(n: number | null | undefined): number {
  return Number.isFinite(n) ? (n as number) : 0;
}

/** Descending numeric: higher first. NaN / missing sinks to the end. */
function cmpNumDesc(a: number, b: number): number {
  const aOk = Number.isFinite(a);
  const bOk = Number.isFinite(b);
  if (!aOk && !bOk) return 0;
  if (!aOk) return 1;
  if (!bOk) return -1;
  return b - a;
}

function cmpNumAsc(a: number, b: number): number {
  return cmpNumDesc(b, a);
}

function tieBreak(a: RideSummary, b: RideSummary): number {
  return String(a.id).localeCompare(String(b.id));
}

/**
 * Registry — order here is the order in the Sort by menu.
 * Prefer numeric compares for distance, elevation, times, speed (never string).
 */
export const LIBRARY_SORT_OPTIONS: LibrarySortOption[] = [
  {
    id: "date-desc",
    label: "Date (newest first)",
    compare: (a, b) => cmpNumDesc(dateMs(a), dateMs(b)) || tieBreak(a, b),
  },
  {
    id: "date-asc",
    label: "Date (oldest first)",
    compare: (a, b) => cmpNumAsc(dateMs(a), dateMs(b)) || tieBreak(a, b),
  },
  {
    id: "distance-desc",
    label: "Distance (longest first)",
    compare: (a, b) => cmpNumDesc(num(a.distanceKm), num(b.distanceKm)) || tieBreak(a, b),
  },
  {
    id: "distance-asc",
    label: "Distance (shortest first)",
    compare: (a, b) => cmpNumAsc(num(a.distanceKm), num(b.distanceKm)) || tieBreak(a, b),
  },
];

const BY_ID = new Map(LIBRARY_SORT_OPTIONS.map((o) => [o.id, o]));

export function isLibrarySortId(value: string): value is LibrarySortId {
  return BY_ID.has(value as LibrarySortId);
}

export function librarySortOption(id: LibrarySortId): LibrarySortOption {
  return BY_ID.get(id) ?? BY_ID.get(DEFAULT_LIBRARY_SORT)!;
}

export function sortLibraryRides(rides: RideSummary[], sortId: LibrarySortId): RideSummary[] {
  const { compare } = librarySortOption(sortId);
  return [...rides].sort(compare);
}

export function loadLibrarySort(): LibrarySortId {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && isLibrarySortId(raw)) return raw;
  } catch {
    /* private mode / denied */
  }
  return DEFAULT_LIBRARY_SORT;
}

export function saveLibrarySort(id: LibrarySortId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}
