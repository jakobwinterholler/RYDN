import { describe, expect, it } from "vitest";
import {
  DEFAULT_LAYERS,
  applyQuickActionEmphasis,
  markerVisible,
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
  it("hides unverified area finds with no Quick Action (calm default)", () => {
    // ROOT CAUSE candidate: Search without QA stores areaPois but map filters them out
    expect(markerVisible(areaMarket(), DEFAULT_LAYERS, null)).toBe(false);
    expect(markerVisible(areaWater(), DEFAULT_LAYERS, null)).toBe(false);
    expect(markerVisible(area24h(), DEFAULT_LAYERS, null)).toBe(false);
    expect(markerVisible(areaSleep(), DEFAULT_LAYERS, null)).toBe(false);
  });

  it("shows Markets finds when Markets QA is on", () => {
    expect(stopMatchesLayer(areaMarket(), "food")).toBe(true);
    expect(markerVisible(areaMarket(), DEFAULT_LAYERS, "food")).toBe(true);
  });

  it("shows Water / 24h / Sleep finds under matching QA", () => {
    expect(markerVisible(areaWater(), DEFAULT_LAYERS, "water")).toBe(true);
    expect(markerVisible(area24h(), DEFAULT_LAYERS, "h24")).toBe(true);
    expect(markerVisible(areaSleep(), DEFAULT_LAYERS, "sleep")).toBe(true);
  });

  it("hides Markets find under Water QA (exclusive)", () => {
    expect(markerVisible(areaMarket(), DEFAULT_LAYERS, "water")).toBe(false);
  });

  it("hides Markets find beyond 500m corridor", () => {
    const far = { ...areaMarket(), distanceOffRouteM: 800 };
    expect(markerVisible(far, DEFAULT_LAYERS, "food")).toBe(false);
  });

  it("does not treat 24h Shop as Markets", () => {
    expect(stopMatchesLayer(area24h(), "food")).toBe(false);
    expect(stopMatchesLayer(area24h(), "h24")).toBe(true);
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
});
