/** Trips shelf sort — Year / Distance / Newest. */

import type { Ultra } from "../types";

export type TripsSortId = "year" | "distance" | "newest";

export const TRIPS_SORT_OPTIONS: { id: TripsSortId; label: string }[] = [
  { id: "year", label: "Year" },
  { id: "distance", label: "Distance" },
  { id: "newest", label: "Newest" },
];

export const DEFAULT_TRIPS_SORT: TripsSortId = "year";

const STORAGE_KEY = "rydn.trips.sort";

function num(n: number | null | undefined): number {
  return Number.isFinite(n) ? (n as number) : 0;
}

function tieBreak(a: Ultra, b: Ultra): number {
  return String(a.id).localeCompare(String(b.id));
}

export function sortTrips(ultras: Ultra[], sortId: TripsSortId): Ultra[] {
  const list = [...ultras];
  if (sortId === "distance") {
    return list.sort(
      (a, b) => num(b.distanceKm) - num(a.distanceKm) || num(b.year) - num(a.year) || tieBreak(a, b),
    );
  }
  if (sortId === "newest") {
    return list.sort(
      (a, b) =>
        num(b.createdAt) - num(a.createdAt) || num(b.year) - num(a.year) || tieBreak(a, b),
    );
  }
  // year (default): year desc, then date/created
  return list.sort(
    (a, b) =>
      num(b.year) - num(a.year) ||
      String(b.dateEnd || b.date || "").localeCompare(String(a.dateEnd || a.date || "")) ||
      num(b.createdAt) - num(a.createdAt) ||
      tieBreak(a, b),
  );
}

/** Soft year groups when sorted by year — empty years sink to "Other". */
export function groupTripsByYear(ultras: Ultra[]): { year: number | null; items: Ultra[] }[] {
  const map = new Map<number | null, Ultra[]>();
  for (const u of ultras) {
    const y = u.year != null && Number.isFinite(u.year) ? u.year : null;
    const bucket = map.get(y);
    if (bucket) bucket.push(u);
    else map.set(y, [u]);
  }
  const years = [...map.keys()].sort((a, b) => {
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    return b - a;
  });
  return years.map((year) => ({ year, items: map.get(year)! }));
}

export function isTripsSortId(value: string): value is TripsSortId {
  return TRIPS_SORT_OPTIONS.some((o) => o.id === value);
}

export function loadTripsSort(): TripsSortId {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && isTripsSortId(raw)) return raw;
  } catch {
    /* private mode */
  }
  return DEFAULT_TRIPS_SORT;
}

export function saveTripsSort(id: TripsSortId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}
