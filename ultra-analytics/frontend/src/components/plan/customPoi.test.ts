import { describe, expect, it } from "vitest";
import {
  buildCustomStop,
  isCustomStop,
  isCustomStopId,
  kindFromStop,
  projectOntoRoute,
  sanitizeCustomName,
} from "./customPoi";

describe("customPoi", () => {
  it("identifies custom ids and osmType", () => {
    expect(isCustomStopId("custom-abc")).toBe(true);
    expect(isCustomStopId("area-node-1")).toBe(false);
    expect(isCustomStop({ id: "custom-1", osmType: "node" })).toBe(true);
    expect(isCustomStop({ id: "x", osmType: "custom" })).toBe(true);
    expect(isCustomStop({ id: "area-node-1", osmType: "node" })).toBe(false);
  });

  it("projects onto a simple northbound polyline", () => {
    const points = [
      [42.0, 3.0],
      [42.1, 3.0],
      [42.2, 3.0],
    ];
    const mid = projectOntoRoute(points, 42.1, 3.001);
    expect(mid.distanceAlongKm).toBeGreaterThan(5);
    expect(mid.distanceAlongKm).toBeLessThan(20);
    expect(mid.distanceOffRouteM).toBeLessThan(200);

    const start = projectOntoRoute(points, 42.0, 3.0);
    expect(start.distanceAlongKm).toBe(0);
    expect(start.distanceOffRouteM).toBe(0);
  });

  it("builds a verified custom stop snapshot", () => {
    const stop = buildCustomStop({
      id: "custom-test",
      name: "  CP1  ",
      kind: "checkpoint",
      lat: 42.05,
      lon: 3.0,
      points: [
        [42.0, 3.0],
        [42.1, 3.0],
      ],
    });
    expect(stop.id).toBe("custom-test");
    expect(stop.name).toBe("CP1");
    expect(stop.category).toBe("Checkpoint");
    expect(stop.group).toBe("checkpoint");
    expect(stop.osmType).toBe("custom");
    expect(stop.reviewStatus).toBe("verified");
    expect(stop.qualityLabel).toBe("Custom");
    expect(stop.distanceAlongKm).toBeGreaterThanOrEqual(0);
  });

  it("maps categories back to kinds", () => {
    expect(kindFromStop({ category: "Cafe", group: "dining" })).toBe("cafe");
    expect(kindFromStop({ category: "Water", group: "water" })).toBe("water");
    expect(kindFromStop({ category: "Hotel", group: "sleep" })).toBe("hotel");
    expect(kindFromStop({ category: "Shop", group: "resupply" })).toBe("shop");
    expect(kindFromStop({ category: "Checkpoint", group: "checkpoint" })).toBe("checkpoint");
  });

  it("sanitizes names", () => {
    expect(sanitizeCustomName("  Aid   Station  ")).toBe("Aid Station");
    expect(sanitizeCustomName("   ")).toBe("Custom stop");
  });
});
