import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIBRARY_SORT,
  sortLibraryRides,
  type LibrarySortId,
} from "./sort";
import type { RideSummary } from "../types";

function ride(partial: Partial<RideSummary> & { id: string }): RideSummary {
  return {
    savedAt: 0,
    name: partial.name || partial.id,
    kind: "training",
    date: null,
    distanceKm: 0,
    elevationGainM: 0,
    durationS: 0,
    movingTimeS: 0,
    rideType: "Training Ride",
    ...partial,
  };
}

describe("sortLibraryRides", () => {
  it("defaults to date newest first", () => {
    expect(DEFAULT_LIBRARY_SORT).toBe("date-desc");
  });

  it("sorts distance numerically (longest first), not alphabetically", () => {
    const rides = [
      ride({ id: "a", distanceKm: 90, name: "90" }),
      ride({ id: "b", distanceKm: 200, name: "200" }),
      ride({ id: "c", distanceKm: 45, name: "45" }),
      ride({ id: "d", distanceKm: 1000, name: "1000" }),
    ];
    const sorted = sortLibraryRides(rides, "distance-desc");
    expect(sorted.map((r) => r.distanceKm)).toEqual([1000, 200, 90, 45]);
  });

  it("sorts distance shortest first", () => {
    const rides = [
      ride({ id: "a", distanceKm: 90 }),
      ride({ id: "b", distanceKm: 200 }),
      ride({ id: "c", distanceKm: 45 }),
    ];
    const sorted = sortLibraryRides(rides, "distance-asc");
    expect(sorted.map((r) => r.distanceKm)).toEqual([45, 90, 200]);
  });

  it("sorts by date newest / oldest", () => {
    const rides = [
      ride({ id: "a", date: "2024-01-01T10:00:00Z" }),
      ride({ id: "b", date: "2025-06-15T08:00:00Z" }),
      ride({ id: "c", date: "2023-12-01T12:00:00Z" }),
    ];
    expect(sortLibraryRides(rides, "date-desc").map((r) => r.id)).toEqual(["b", "a", "c"]);
    expect(sortLibraryRides(rides, "date-asc").map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  it("accepts every registered sort id", () => {
    const rides = [ride({ id: "a", distanceKm: 10, date: "2024-01-01T00:00:00Z" })];
    const ids: LibrarySortId[] = ["date-desc", "date-asc", "distance-desc", "distance-asc"];
    for (const id of ids) {
      expect(sortLibraryRides(rides, id)).toHaveLength(1);
    }
  });
});
