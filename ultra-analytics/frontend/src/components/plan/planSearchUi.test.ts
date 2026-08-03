import { describe, expect, it } from "vitest";
import {
  bboxSpanTooLarge,
  isDegeneratePlanSearchBBox,
  isZoomInSearchError,
  normalizePlanSearchBBox,
  resolvePlanSearchChip,
  searchResultLimitForBbox,
  wrapLongitude,
} from "./planSearchUi";

const tight = { south: 48.13, west: 11.54, north: 48.14, east: 11.56 };
const huge = { south: 40, west: 0, north: 50, east: 10 };
const manresa = { south: 41.7, west: 1.78, north: 41.75, east: 1.86 };
const phoneLike = { south: 41.72, west: 1.8, north: 41.74, east: 1.84 };
const desktopWide = { south: 41.5, west: 1.0, north: 42.0, east: 2.2 };

describe("normalizePlanSearchBBox — MapLibre unwrapped lng", () => {
  it("wraps ±360·k desktop world-copy bounds onto Catalonia", () => {
    const raw = { south: 41.7, west: 361.78, north: 41.75, east: 361.86 };
    const n = normalizePlanSearchBBox(raw);
    expect(n.west).toBeCloseTo(1.78, 5);
    expect(n.east).toBeCloseTo(1.86, 5);
    expect(n.south).toBeCloseTo(41.7, 5);
    expect(n.north).toBeCloseTo(41.75, 5);
  });

  it("leaves already-principal European bboxes unchanged", () => {
    const n = normalizePlanSearchBBox(tight);
    expect(n.west).toBeCloseTo(tight.west, 8);
    expect(n.east).toBeCloseTo(tight.east, 8);
  });

  it("preserves mobile-like and desktop-wide principal bounds", () => {
    expect(normalizePlanSearchBBox(phoneLike).west).toBeCloseTo(phoneLike.west, 8);
    expect(normalizePlanSearchBBox(desktopWide).east).toBeCloseTo(desktopWide.east, 8);
    expect(normalizePlanSearchBBox(manresa).west).toBeCloseTo(manresa.west, 5);
  });

  it("wraps negative world-copy longs onto Catalonia", () => {
    const n = normalizePlanSearchBBox({
      south: 41.7,
      west: -358.22,
      north: 41.75,
      east: -358.14,
    });
    expect(n.west).toBeCloseTo(1.78, 5);
    expect(n.east).toBeCloseTo(1.86, 5);
  });

  it("wrapLongitude maps 362.1 → 2.1", () => {
    expect(wrapLongitude(362.1)).toBeCloseTo(2.1, 8);
    expect(wrapLongitude(-181)).toBeCloseTo(179, 8);
  });

  it("flags degenerate zero-area bboxes", () => {
    expect(isDegeneratePlanSearchBBox({ south: 41.7, west: 1.8, north: 41.7, east: 1.8 })).toBe(
      true,
    );
    expect(isDegeneratePlanSearchBBox(manresa)).toBe(false);
  });
});

describe("resolvePlanSearchChip — exclusive states", () => {
  it("initial / ride / no category → hidden", () => {
    expect(
      resolvePlanSearchChip({
        mode: "plan",
        searching: false,
        prompted: false,
        hasCategory: true,
        bbox: tight,
      }),
    ).toBe("hidden");
    expect(
      resolvePlanSearchChip({
        mode: "plan",
        searching: false,
        prompted: true,
        hasCategory: false,
        bbox: tight,
      }),
    ).toBe("hidden");
    expect(
      resolvePlanSearchChip({
        mode: "ride",
        searching: false,
        prompted: true,
        hasCategory: true,
        bbox: tight,
      }),
    ).toBe("hidden");
  });

  it("pan + category → ready", () => {
    expect(
      resolvePlanSearchChip({
        mode: "plan",
        searching: false,
        prompted: true,
        hasCategory: true,
        bbox: tight,
      }),
    ).toBe("ready");
  });

  it("searching wins over ready/zoomIn", () => {
    expect(
      resolvePlanSearchChip({
        mode: "plan",
        searching: true,
        prompted: true,
        hasCategory: true,
        bbox: tight,
      }),
    ).toBe("searching");
    expect(
      resolvePlanSearchChip({
        mode: "plan",
        searching: true,
        prompted: true,
        hasCategory: true,
        bbox: huge,
      }),
    ).toBe("searching");
  });

  it("zoomed out with category → zoomIn, never ready", () => {
    expect(bboxSpanTooLarge(huge)).toBe(true);
    expect(
      resolvePlanSearchChip({
        mode: "plan",
        searching: false,
        prompted: true,
        hasCategory: true,
        bbox: huge,
      }),
    ).toBe("zoomIn");
  });

  it("after search (prompted false) → hidden", () => {
    expect(
      resolvePlanSearchChip({
        mode: "plan",
        searching: false,
        prompted: false,
        hasCategory: true,
        bbox: tight,
      }),
    ).toBe("hidden");
  });

  it("mutually exclusive lifecycle", () => {
    const cases = [
      resolvePlanSearchChip({
        mode: "plan",
        searching: false,
        prompted: false,
        hasCategory: false,
        bbox: tight,
      }),
      resolvePlanSearchChip({
        mode: "plan",
        searching: false,
        prompted: true,
        hasCategory: true,
        bbox: tight,
      }),
      resolvePlanSearchChip({
        mode: "plan",
        searching: true,
        prompted: true,
        hasCategory: true,
        bbox: tight,
      }),
      resolvePlanSearchChip({
        mode: "plan",
        searching: false,
        prompted: true,
        hasCategory: true,
        bbox: huge,
      }),
    ];
    expect(cases).toEqual(["hidden", "ready", "searching", "zoomIn"]);
  });
});

describe("searchResultLimitForBbox", () => {
  it("caps 3–15 by zoom span", () => {
    expect(searchResultLimitForBbox(huge)).toBe(3);
    expect(searchResultLimitForBbox(tight)).toBe(15);
    expect(searchResultLimitForBbox({ south: 0, west: 0, north: 0.4, east: 0.4 })).toBe(10);
  });
});

describe("isZoomInSearchError", () => {
  it("detects backend zoom-in copy", () => {
    expect(isZoomInSearchError("Zoom in closer to search this area.")).toBe(true);
    expect(isZoomInSearchError("Couldn't refresh. Try again.")).toBe(false);
  });
});
