import { describe, expect, it } from "vitest";
import type { RecommendedStop } from "../../types";
import {
  isVerifiedShop,
  isVerifiedWater,
  mergeVerifiedStops,
  nextRideGlance,
  verifiedLegs,
} from "./rideStops";

function stop(partial: Partial<RecommendedStop> & Pick<RecommendedStop, "id" | "distanceAlongKm">): RecommendedStop {
  return {
    osmId: 1,
    osmType: "node",
    name: partial.name ?? "Stop",
    category: partial.category ?? "Supermarket",
    group: partial.group ?? "resupply",
    lat: 0,
    lon: 0,
    distanceOffRouteM: 0,
    qualityStars: 3,
    qualityLabel: "ok",
    reviewStatus: "verified",
    ...partial,
  };
}

const profile: [number, number][] = [
  [0, 100],
  [10, 200],
  [20, 200],
  [40, 400],
];

describe("ride stop predicates", () => {
  it("detects water and shops", () => {
    expect(isVerifiedWater(stop({ id: "w", distanceAlongKm: 1, group: "water", category: "Fountain" }))).toBe(
      true,
    );
    expect(isVerifiedShop(stop({ id: "s", distanceAlongKm: 1, category: "Supermarket" }))).toBe(true);
    expect(isVerifiedShop(stop({ id: "g", distanceAlongKm: 1, category: "Gas station" }))).toBe(false);
  });
});

describe("mergeVerifiedStops", () => {
  it("unions recommended + saved and sorts by km", () => {
    const merged = mergeVerifiedStops(
      [stop({ id: "b", distanceAlongKm: 20, reviewStatus: "verified" })],
      [stop({ id: "a", distanceAlongKm: 5 }), stop({ id: "c", distanceAlongKm: 30 })],
    );
    expect(merged.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });
});

describe("nextRideGlance", () => {
  it("returns next water and shop with elev gain", () => {
    const verified = [
      stop({ id: "w1", distanceAlongKm: 10, group: "water", category: "Fountain" }),
      stop({ id: "s1", distanceAlongKm: 20, category: "Supermarket" }),
      stop({ id: "w2", distanceAlongKm: 40, group: "water", category: "Fountain" }),
    ];
    const g = nextRideGlance(verified, 0, profile);
    expect(g.water?.stop.id).toBe("w1");
    expect(g.water?.distanceKm).toBe(10);
    expect(g.water?.elevGainM).toBe(100);
    expect(g.shop?.stop.id).toBe("s1");
    expect(g.shop?.elevGainM).toBe(100);
  });
});

describe("verifiedLegs", () => {
  it("builds from-start / from-last metrics", () => {
    const verified = [
      stop({ id: "a", distanceAlongKm: 10, group: "water", category: "Fountain" }),
      stop({ id: "b", distanceAlongKm: 40, category: "Supermarket" }),
    ];
    const legs = verifiedLegs(verified, profile);
    expect(legs[0].isFirst).toBe(true);
    expect(legs[0].distanceKm).toBe(10);
    expect(legs[0].elevGainM).toBe(100);
    expect(legs[1].distanceKm).toBe(30);
    expect(legs[1].elevGainM).toBe(200);
  });

  it("degrades elev when profile missing", () => {
    const legs = verifiedLegs([stop({ id: "a", distanceAlongKm: 10 })], null);
    expect(legs[0].elevGainM).toBeNull();
    expect(legs[0].distanceKm).toBe(10);
  });
});
