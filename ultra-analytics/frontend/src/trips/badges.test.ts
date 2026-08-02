import { describe, expect, it } from "vitest";
import type { Ultra } from "../types";
import { candidateTripBadges, selectTripBadges } from "./badges";

function ultra(partial: Partial<Ultra>): Ultra {
  return {
    id: "u1",
    createdAt: 1,
    updatedAt: 1,
    name: "Test",
    year: 2024,
    kind: "ultra",
    status: "reviewed",
    activityIds: ["a", "b", "c"],
    distanceKm: 500,
    elevationGainM: 4000,
    durationS: 100000,
    dayCount: 3,
    ...partial,
  };
}

describe("selectTripBadges", () => {
  it("caps at 3", () => {
    const badges = selectTripBadges(
      ultra({
        kind: "bikepacking",
        countryCodes: ["ES", "FR", "IT"],
        dayCount: 8,
        elevationGainM: 12000,
        distanceKm: 1500,
      }),
    );
    expect(badges.length).toBeLessThanOrEqual(3);
  });

  it("does not emit kind or race-result chips", () => {
    const badges = candidateTripBadges(
      ultra({ result: "Winner", kind: "bikepacking", dayCount: 5 }),
    );
    expect(badges.every((b) => !["dnf", "dns", "podium", "finisher", "bikepacking"].includes(b.id))).toBe(
      true,
    );
  });

  it("awards alpine from elev/km", () => {
    const badges = candidateTripBadges(
      ultra({ distanceKm: 400, elevationGainM: 6000, dayCount: 2 }),
    );
    expect(badges.some((b) => b.id === "alpine")).toBe(true);
  });

  it("awards multi-country", () => {
    const badges = candidateTripBadges(ultra({ countryCodes: ["ES", "FR"] }));
    expect(badges.some((b) => b.id === "multiCountry")).toBe(true);
  });

  it("awards multi-day", () => {
    const badges = candidateTripBadges(ultra({ dayCount: 5 }));
    expect(badges.some((b) => b.id === "multiDay")).toBe(true);
  });
});
