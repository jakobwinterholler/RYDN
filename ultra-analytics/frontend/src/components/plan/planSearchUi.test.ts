import { describe, expect, it } from "vitest";
import {
  bboxSpanTooLarge,
  isZoomInSearchError,
  resolvePlanSearchChip,
  searchResultLimitForBbox,
} from "./planSearchUi";

const tight = { south: 48.13, west: 11.54, north: 48.14, east: 11.56 };
const huge = { south: 40, west: 0, north: 50, east: 10 };

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
