/** Trip kind taxonomy — Race | Long ride | Bikepacking. */

export type UltraKind = "race" | "bikepacking" | "ultra";

export type TripsFilterId = "all" | UltraKind;

/** UI choices for create/edit — Tour removed; legacy tour maps to Long ride. */
export const ULTRA_KIND_OPTIONS: { id: UltraKind; label: string }[] = [
  { id: "race", label: "Race" },
  { id: "ultra", label: "Long ride" },
  { id: "bikepacking", label: "Bikepacking" },
];

export const TRIPS_FILTER_OPTIONS: { id: TripsFilterId; label: string }[] = [
  { id: "all", label: "All" },
  { id: "race", label: "Races" },
  { id: "bikepacking", label: "Bikepacking" },
  { id: "ultra", label: "Long rides" },
];

/** Map API / legacy values onto the three UI kinds. Legacy `tour` → Long ride. */
export function normalizeUltraKind(raw: string | null | undefined): UltraKind {
  const k = (raw || "").trim().toLowerCase();
  if (k === "race") return "race";
  if (k === "bikepacking" || k === "bikepack") return "bikepacking";
  // Tour and training-style labels fold into Long ride for filters/display.
  if (
    k === "tour" ||
    k === "tours" ||
    k === "training" ||
    k === "long" ||
    k === "longride" ||
    k === "long_ride" ||
    k === "ultra"
  ) {
    return "ultra";
  }
  return "ultra";
}

export function ultraKindLabel(kind: string | null | undefined): string {
  const id = normalizeUltraKind(kind);
  return ULTRA_KIND_OPTIONS.find((o) => o.id === id)?.label ?? "Long ride";
}

export function filterUltrasByKind<T extends { kind?: string | null }>(
  ultras: T[],
  filter: TripsFilterId,
): T[] {
  if (filter === "all") return ultras;
  return ultras.filter((u) => normalizeUltraKind(u.kind) === filter);
}

export function countUltrasByKind(ultras: { kind?: string | null }[]): Record<TripsFilterId, number> {
  const counts: Record<TripsFilterId, number> = {
    all: ultras.length,
    race: 0,
    bikepacking: 0,
    ultra: 0,
  };
  for (const u of ultras) {
    counts[normalizeUltraKind(u.kind)] += 1;
  }
  return counts;
}
