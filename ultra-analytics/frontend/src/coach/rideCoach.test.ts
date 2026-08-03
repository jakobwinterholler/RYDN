import { describe, expect, it } from "vitest";
import { coachFromLibrary, coachFromReport } from "./rideCoach";
import type { RideSummary } from "../types";

function ride(partial: Partial<RideSummary> & { id: string; date: string }): RideSummary {
  return {
    savedAt: 1,
    name: partial.name || partial.id,
    kind: "training",
    distanceKm: 40,
    elevationGainM: 400,
    durationS: 7200,
    movingTimeS: 6500,
    rideType: "Ride",
    ...partial,
  };
}

describe("coachFromLibrary", () => {
  it("flags stacked hard days", () => {
    const tips = coachFromLibrary(
      [
        ride({
          id: "a",
          date: "2026-08-03T10:00:00Z",
          distanceKm: 120,
          elevationGainM: 2200,
          movingTimeS: 6 * 3600,
        }),
        ride({
          id: "b",
          date: "2026-08-02T10:00:00Z",
          distanceKm: 100,
          elevationGainM: 1800,
          movingTimeS: 5 * 3600,
        }),
        ride({
          id: "c",
          date: "2026-07-20T10:00:00Z",
          distanceKm: 40,
          elevationGainM: 200,
          movingTimeS: 5400,
        }),
      ],
      Date.parse("2026-08-03T18:00:00Z"),
    );
    expect(tips.some((t) => t.id.startsWith("recovery"))).toBe(true);
  });

  it("returns empty when not enough data", () => {
    expect(coachFromLibrary([])).toEqual([]);
  });
});

describe("coachFromReport", () => {
  it("flags low moving percent on long days", () => {
    const tips = coachFromReport({
      distanceKm: 140,
      elevationGainM: 2000,
      movingPct: 62,
    });
    expect(tips[0]?.id).toBe("moving");
  });
});
