import { describe, expect, it } from "vitest";
import {
  bboxSpanTooLarge,
  isZoomInSearchError,
  resolvePlanSearchChip,
} from "./planSearchUi";

const tight = { south: 48.13, west: 11.54, north: 48.14, east: 11.56 };
const huge = { south: 40, west: 0, north: 50, east: 10 };

describe("resolvePlanSearchChip — exclusive states", () => {
  it("initial / ride → hidden", () => {
    expect(
      resolvePlanSearchChip({ mode: "plan", searching: false, prompted: false, bbox: tight }),
    ).toBe("hidden");
    expect(
      resolvePlanSearchChip({ mode: "ride", searching: false, prompted: true, bbox: tight }),
    ).toBe("hidden");
  });

  it("pan → ready (only)", () => {
    expect(
      resolvePlanSearchChip({ mode: "plan", searching: false, prompted: true, bbox: tight }),
    ).toBe("ready");
  });

  it("searching wins over ready/zoomIn", () => {
    expect(
      resolvePlanSearchChip({ mode: "plan", searching: true, prompted: true, bbox: tight }),
    ).toBe("searching");
    expect(
      resolvePlanSearchChip({ mode: "plan", searching: true, prompted: true, bbox: huge }),
    ).toBe("searching");
  });

  it("zoomed out → zoomIn, never ready", () => {
    expect(bboxSpanTooLarge(huge)).toBe(true);
    expect(
      resolvePlanSearchChip({ mode: "plan", searching: false, prompted: true, bbox: huge }),
    ).toBe("zoomIn");
  });

  it("after search (prompted false) → hidden even if bbox ok", () => {
    expect(
      resolvePlanSearchChip({ mode: "plan", searching: false, prompted: false, bbox: tight }),
    ).toBe("hidden");
  });

  it("mutually exclusive: exactly one state for each input class", () => {
    const cases = [
      resolvePlanSearchChip({ mode: "plan", searching: false, prompted: false, bbox: tight }),
      resolvePlanSearchChip({ mode: "plan", searching: false, prompted: true, bbox: tight }),
      resolvePlanSearchChip({ mode: "plan", searching: true, prompted: true, bbox: tight }),
      resolvePlanSearchChip({ mode: "plan", searching: false, prompted: true, bbox: huge }),
    ];
    expect(new Set(cases).size).toBe(4);
    expect(cases).toEqual(["hidden", "ready", "searching", "zoomIn"]);
  });
});

describe("isZoomInSearchError", () => {
  it("detects backend zoom-in copy so it never doubles as a banner", () => {
    expect(isZoomInSearchError("Zoom in closer to search this area.")).toBe(true);
    expect(isZoomInSearchError("Search timed out")).toBe(false);
  });
});
