import { describe, expect, it } from "vitest";
import {
  elevationAtKm,
  elevationGainBetweenKm,
  hasUsableElevation,
  profileMarkerT,
} from "./rideElevation";

const climb: [number, number][] = [
  [0, 100],
  [10, 100],
  [20, 300], // +200
  [30, 280], // -20
  [40, 480], // +200
  [50, 480],
];

describe("hasUsableElevation", () => {
  it("rejects empty / single point", () => {
    expect(hasUsableElevation([])).toBe(false);
    expect(hasUsableElevation([[0, 100]])).toBe(false);
  });
  it("accepts a real profile", () => {
    expect(hasUsableElevation(climb)).toBe(true);
  });
});

describe("elevationAtKm", () => {
  it("interpolates between samples", () => {
    expect(elevationAtKm(climb, 15)).toBeCloseTo(200, 5);
  });
  it("clamps to ends", () => {
    expect(elevationAtKm(climb, -5)).toBe(100);
    expect(elevationAtKm(climb, 99)).toBe(480);
  });
});

describe("elevationGainBetweenKm", () => {
  it("returns null without elevation", () => {
    expect(elevationGainBetweenKm(null, 0, 10)).toBeNull();
    expect(elevationGainBetweenKm([], 0, 10)).toBeNull();
  });

  it("returns 0 for empty / reverse range", () => {
    expect(elevationGainBetweenKm(climb, 10, 10)).toBe(0);
    expect(elevationGainBetweenKm(climb, 20, 10)).toBe(0);
  });

  it("counts ascent only across a leg", () => {
    // 0→50: +200 then +200 = 400 (descent ignored)
    expect(elevationGainBetweenKm(climb, 0, 50)).toBe(400);
  });

  it("gains between mid points", () => {
    // 10→30: climb 100→300 (+200), then down to 280 — gain 200
    expect(elevationGainBetweenKm(climb, 10, 30)).toBe(200);
    // 25→40: start ~290, next sample 280, then 480 → ascent 200
    expect(elevationGainBetweenKm(climb, 25, 40)).toBe(200);
  });

  it("ignores sub-noise wiggles", () => {
    const flat: [number, number][] = [
      [0, 100],
      [1, 100.3],
      [2, 99.8],
      [3, 100.2],
      [4, 100],
    ];
    expect(elevationGainBetweenKm(flat, 0, 4)).toBe(0);
  });
});

describe("profileMarkerT", () => {
  it("maps km to 0–1", () => {
    expect(profileMarkerT(climb, 0)).toBe(0);
    expect(profileMarkerT(climb, 50)).toBe(1);
    expect(profileMarkerT(climb, 25)).toBeCloseTo(0.5, 5);
  });
});
