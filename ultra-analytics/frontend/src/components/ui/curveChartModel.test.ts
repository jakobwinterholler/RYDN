import { describe, expect, it } from "vitest";
import {
  anchorDurations,
  defaultDuration,
  durationFromX,
  durationNearX,
  fmtDur,
  interpolateAt,
  nearestDuration,
  nearestPoint,
  toClimbingRate,
  unionDurations,
  valueAt,
} from "./curveChartModel";

describe("curveChartModel", () => {
  it("formats durations for chips and readouts", () => {
    expect(fmtDur(5)).toBe("5s");
    expect(fmtDur(60)).toBe("1m");
    expect(fmtDur(1200)).toBe("20m");
    expect(fmtDur(3600)).toBe("1h");
    expect(fmtDur(7200)).toBe("2h");
    expect(fmtDur(90)).toBe("1:30");
    expect(fmtDur(3660)).toBe("1h 1m");
  });

  it("finds nearest point when series durations differ", () => {
    const pts = [
      { d: 5, v: 400 },
      { d: 60, v: 300 },
      { d: 1200, v: 250 },
    ];
    expect(nearestPoint(pts, 300)?.d).toBe(60);
    expect(nearestPoint(pts, 1200)?.v).toBe(250);
    expect(nearestPoint([], 60)).toBeNull();
  });

  it("interpolates along the curve for free scrub positions", () => {
    const pts = [
      { d: 5, v: 400 },
      { d: 60, v: 300 },
      { d: 1200, v: 250 },
    ];
    expect(interpolateAt(pts, 5)?.v).toBe(400);
    expect(interpolateAt(pts, 60)?.v).toBe(300);
    const mid = interpolateAt(pts, 15);
    expect(mid).not.toBeNull();
    expect(mid!.v).toBeGreaterThan(300);
    expect(mid!.v).toBeLessThan(400);
    expect(valueAt(pts, 60)).toBe(300);
  });

  it("defaults to 20m when available, else 1h", () => {
    expect(defaultDuration([5, 60, 300, 1200, 3600])).toBe(1200);
    expect(defaultDuration([5, 60, 3600])).toBe(3600);
    expect(defaultDuration([5, 15, 30])).toBe(30);
  });

  it("unions durations across series for hit testing", () => {
    expect(
      unionDurations([
        [
          { d: 5, v: 1 },
          { d: 60, v: 1 },
        ],
        [
          { d: 60, v: 2 },
          { d: 300, v: 2 },
        ],
      ]),
    ).toEqual([5, 60, 300]);
  });

  it("picks duration nearest to pointer x", () => {
    const allD = [5, 60, 300, 1200];
    const sx = (d: number) => allD.indexOf(d) * 100;
    expect(durationNearX(allD, 5, sx)).toBe(5);
    expect(durationNearX(allD, 210, sx)).toBe(300);
  });

  it("maps continuous x to log-time duration for timeline scrubbing", () => {
    const dLo = 5;
    const dHi = 3600;
    const padL = 40;
    const innerW = 800;
    expect(durationFromX(padL, dLo, dHi, padL, innerW)).toBeCloseTo(dLo, 5);
    expect(durationFromX(padL + innerW, dLo, dHi, padL, innerW)).toBeCloseTo(dHi, 5);
    const mid = durationFromX(padL + innerW / 2, dLo, dHi, padL, innerW);
    // Midpoint on log axis ≈ geometric mean
    expect(mid).toBeCloseTo(Math.sqrt(dLo * dHi), 0);
  });

  it("highlights nearest chip duration while scrubbing freely", () => {
    expect(nearestDuration([5, 60, 300, 1200], 280)).toBe(300);
    expect(nearestDuration([], 60)).toBeNull();
  });

  it("lists anchor chips present on the curve", () => {
    expect(
      anchorDurations([
        { d: 5, v: 1 },
        { d: 60, v: 1 },
        { d: 1200, v: 1 },
        { d: 999, v: 1 },
      ]),
    ).toEqual([5, 60, 1200]);
  });

  it("converts elevation gain windows to climbing rate m/h", () => {
    expect(toClimbingRate([{ d: 3600, v: 800 }])).toEqual([{ d: 3600, v: 800 }]);
    expect(toClimbingRate([{ d: 1200, v: 200 }])).toEqual([{ d: 1200, v: 600 }]);
  });
});
