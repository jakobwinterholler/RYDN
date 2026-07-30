import { describe, expect, it } from "vitest";
import {
  DEFAULT_LAYERS,
  LAYER_TOGGLES,
  QA_EXTRA_CAP,
  QA_NEAREST_N,
  QUICK_ACTIONS,
  applyQuickActionEmphasis,
  markerVisible,
  searchLimitForQa,
  stopMatchesLayer,
  type PlanMarker,
} from "./planLayers";

function areaMarket(id = "area-node-1"): PlanMarker {
  return {
    id,
    lat: 48.14,
    lon: 11.55,
    kind: "area",
    group: "resupply",
    category: "Supermarket",
    status: "unreviewed",
    name: "REWE",
    distanceOffRouteM: 120,
  };
}

function areaConvenience(id = "area-node-c"): PlanMarker {
  return {
    id,
    lat: 48.14,
    lon: 11.55,
    kind: "area",
    group: "resupply",
    category: "Convenience",
    status: "unreviewed",
    distanceOffRouteM: 90,
  };
}

function areaWater(id = "area-node-w"): PlanMarker {
  return {
    id,
    lat: 48.14,
    lon: 11.55,
    kind: "area",
    group: "water",
    category: "Drinking water",
    status: "unreviewed",
    distanceOffRouteM: 80,
  };
}

function area24h(id = "area-node-f"): PlanMarker {
  return {
    id,
    lat: 48.14,
    lon: 11.55,
    kind: "area",
    group: "resupply",
    category: "24h Shop",
    status: "unreviewed",
    is24h: true,
    hasShop: true,
    distanceOffRouteM: 90,
  };
}

function areaSleep(id = "area-node-s"): PlanMarker {
  return {
    id,
    lat: 48.14,
    lon: 11.55,
    kind: "area",
    group: "sleep",
    category: "Hotel",
    status: "unreviewed",
    distanceOffRouteM: 400,
  };
}

describe("Search → markerVisible pipeline", () => {
  it("exposes only Water / Markets / Sleep as Quick Actions", () => {
    expect(QUICK_ACTIONS.map((a) => a.id)).toEqual(["water", "food", "sleep"]);
    expect(QUICK_ACTIONS.some((a) => a.id === ("h24" as never))).toBe(false);
    expect(LAYER_TOGGLES.some((t) => t.id === "h24")).toBe(false);
  });

  it("hides unverified area finds with no Quick Action (calm default)", () => {
    expect(markerVisible(areaMarket(), DEFAULT_LAYERS, null)).toBe(false);
    expect(markerVisible(areaWater(), DEFAULT_LAYERS, null)).toBe(false);
    expect(markerVisible(area24h(), DEFAULT_LAYERS, null)).toBe(false);
    expect(markerVisible(areaSleep(), DEFAULT_LAYERS, null)).toBe(false);
  });

  it("shows Markets finds when Markets QA is on (supermarket + convenience)", () => {
    expect(stopMatchesLayer(areaMarket(), "food")).toBe(true);
    expect(stopMatchesLayer(areaConvenience(), "food")).toBe(true);
    expect(markerVisible(areaMarket(), DEFAULT_LAYERS, "food")).toBe(true);
    expect(markerVisible(areaConvenience(), DEFAULT_LAYERS, "food")).toBe(true);
  });

  it("shows Water / Sleep finds under matching QA", () => {
    expect(markerVisible(areaWater(), DEFAULT_LAYERS, "water")).toBe(true);
    expect(markerVisible(areaSleep(), DEFAULT_LAYERS, "sleep")).toBe(true);
  });

  it("hides Markets find under Water QA (exclusive)", () => {
    expect(markerVisible(areaMarket(), DEFAULT_LAYERS, "water")).toBe(false);
  });

  it("shows Search finds within search corridor even beyond 500m (viewport-scoped)", () => {
    const far = { ...areaMarket(), distanceOffRouteM: 800, layer: "temp" as const };
    expect(markerVisible(far, DEFAULT_LAYERS, "food")).toBe(true);
    const tooFar = { ...areaMarket(), distanceOffRouteM: 3500, layer: "temp" as const };
    expect(markerVisible(tooFar, DEFAULT_LAYERS, "food")).toBe(false);
  });

  it("still hides system Markets beyond 500m corridor", () => {
    const far = {
      ...areaMarket(),
      kind: "poi" as const,
      layer: "system" as const,
      distanceOffRouteM: 800,
    };
    expect(markerVisible(far, DEFAULT_LAYERS, "food")).toBe(false);
  });

  it("does not treat 24h Shop as Markets", () => {
    expect(stopMatchesLayer(area24h(), "food")).toBe(false);
  });

  it("emphasizes nearest under QA without dropping the find", () => {
    const markers = [
      areaMarket("a"),
      { ...areaMarket("b"), lat: 48.141, lon: 11.551 },
      { ...areaMarket("c"), lat: 48.15, lon: 11.56 },
    ];
    const out = applyQuickActionEmphasis(markers, "food", { lat: 48.14, lon: 11.55 });
    expect(out.length).toBeGreaterThan(0);
    expect(out.some((m) => m.emphasize)).toBe(true);
  });

  it("caps temporary results 3–15 by viewport span; Water/Markets get fuller hero batches", () => {
    const tight = { south: 48.13, west: 11.54, north: 48.14, east: 11.56 };
    const mid = { south: 48.0, west: 11.4, north: 48.4, east: 11.8 };
    const wide = { south: 47, west: 10, north: 49, east: 13 };
    expect(searchLimitForQa("water", tight)).toBeLessThanOrEqual(15);
    expect(searchLimitForQa("water", tight)).toBeGreaterThanOrEqual(10);
    expect(searchLimitForQa("food", mid)).toBeGreaterThanOrEqual(searchLimitForQa("sleep", mid));
    expect(searchLimitForQa("food", wide)).toBe(5);
    expect(searchLimitForQa("sleep", wide)).toBe(3);
    expect(QA_NEAREST_N + QA_EXTRA_CAP).toBeLessThanOrEqual(12);
  });

  it("does not expose Verified as a layers-panel category", () => {
    expect(LAYER_TOGGLES.some((t) => t.id === "verified")).toBe(false);
  });
});
