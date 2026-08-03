import { describe, expect, it } from "vitest";
import {
  DETAIL_FINE_ATLAS_SPAN_KM,
  DETAIL_FINE_SPAN_KM,
  DETAIL_LOCAL_BASEMAP_SPAN_KM,
  DETAIL_OUTLINE_SPAN_KM,
  LOD_FINE_ATLAS_SPAN_KM,
  LOD_FINE_SPAN_KM,
  LOD_OUTLINE_SPAN_KM,
  lodStyleFromViewSpan,
  preferLocalBasemap,
} from "./routePreviewLod";

describe("lodStyleFromViewSpan", () => {
  it("gives fine atlas + high fidelity for compact footprints (230 km one-way class)", () => {
    const lod = lodStyleFromViewSpan(210);
    expect(lod.useFineAtlas).toBe(true);
    expect(lod.tier).toBe("fine");
    expect(lod.simplify).toBe(0);
    expect(lod.routePts).toBe(96);
    expect(lod.fill).toBeCloseTo(0.62);
  });

  it("matches 600 km loop to 230 km one-way when bbox span is similar", () => {
    // Path length differs; geographic span does not.
    const oneWay = lodStyleFromViewSpan(210);
    const loop = lodStyleFromViewSpan(220);
    expect(loop.tier).toBe(oneWay.tier);
    expect(loop.useFineAtlas).toBe(oneWay.useFineAtlas);
    expect(loop.simplify).toBe(oneWay.simplify);
    expect(loop.routePts).toBe(oneWay.routePts);
  });

  it("anchors Munich→Oviedo-class span at outline density", () => {
    const munichOviedo = lodStyleFromViewSpan(LOD_OUTLINE_SPAN_KM);
    expect(munichOviedo.useFineAtlas).toBe(false);
    expect(munichOviedo.tier).toBe("outline");
    expect(munichOviedo.fill).toBeCloseTo(0.88);
    expect(munichOviedo.routePts).toBe(36);
    expect(munichOviedo.simplify).toBeCloseTo(2.4);
    expect(munichOviedo.borderW).toBeCloseTo(1.05);
  });

  it("simplifies continuously as span grows (not distance buckets)", () => {
    const a = lodStyleFromViewSpan(LOD_FINE_SPAN_KM);
    const b = lodStyleFromViewSpan((LOD_FINE_SPAN_KM + LOD_OUTLINE_SPAN_KM) / 2);
    const c = lodStyleFromViewSpan(LOD_OUTLINE_SPAN_KM);
    expect(a.simplify).toBeLessThan(b.simplify);
    expect(b.simplify).toBeLessThan(c.simplify);
    expect(a.routePts).toBeGreaterThan(b.routePts);
    expect(b.routePts).toBeGreaterThan(c.routePts);
    expect(a.fill).toBeLessThan(b.fill);
    expect(b.fill).toBeLessThan(c.fill);
  });

  it("drops fine atlas past the coast-resolve zoom", () => {
    expect(lodStyleFromViewSpan(LOD_FINE_ATLAS_SPAN_KM - 1).useFineAtlas).toBe(true);
    expect(lodStyleFromViewSpan(LOD_FINE_ATLAS_SPAN_KM).useFineAtlas).toBe(false);
  });

  it("ignores route length — only span matters for equal country counts", () => {
    // Callers used to pass distanceKm; LOD must not depend on it.
    const compact = lodStyleFromViewSpan(200, 1);
    expect(compact.tier).toBe("fine");
    expect(compact.useFineAtlas).toBe(true);
  });

  it("detail profile keeps fine atlas longer than thumbs (share / certificate)", () => {
    const mid = (LOD_FINE_ATLAS_SPAN_KM + DETAIL_FINE_ATLAS_SPAN_KM) / 2;
    expect(lodStyleFromViewSpan(mid, 1, "thumb").useFineAtlas).toBe(false);
    expect(lodStyleFromViewSpan(mid, 1, "detail").useFineAtlas).toBe(true);
    expect(lodStyleFromViewSpan(DETAIL_FINE_ATLAS_SPAN_KM, 1, "detail").useFineAtlas).toBe(false);
  });

  it("detail peak fidelity extends past thumb fine span without changing outline end", () => {
    const between = (LOD_FINE_SPAN_KM + DETAIL_FINE_SPAN_KM) / 2;
    const thumb = lodStyleFromViewSpan(between, 1, "thumb");
    const detail = lodStyleFromViewSpan(between, 1, "detail");
    expect(detail.simplify).toBeLessThan(thumb.simplify);
    expect(detail.routePts).toBeGreaterThan(thumb.routePts);

    const outlineThumb = lodStyleFromViewSpan(DETAIL_OUTLINE_SPAN_KM, 1, "thumb");
    const outlineDetail = lodStyleFromViewSpan(DETAIL_OUTLINE_SPAN_KM, 1, "detail");
    expect(outlineDetail.tier).toBe("outline");
    expect(outlineDetail.simplify).toBeCloseTo(outlineThumb.simplify);
    expect(outlineDetail.fill).toBeCloseTo(outlineThumb.fill);
  });
});

describe("preferLocalBasemap", () => {
  it("uses local basemap for Bavaria-class inland detail spans", () => {
    // ~112 km loop bbox diagonal is well under the threshold.
    expect(preferLocalBasemap(80, "detail")).toBe(true);
    expect(preferLocalBasemap(210, "detail")).toBe(true);
    expect(preferLocalBasemap(DETAIL_LOCAL_BASEMAP_SPAN_KM - 1, "detail")).toBe(true);
  });

  it("keeps quiet atlas for wide multi-country detail certificates", () => {
    expect(preferLocalBasemap(DETAIL_LOCAL_BASEMAP_SPAN_KM, "detail")).toBe(false);
    expect(preferLocalBasemap(LOD_OUTLINE_SPAN_KM, "detail")).toBe(false);
  });

  it("never switches Trips thumbs off the atlas plate", () => {
    expect(preferLocalBasemap(80, "thumb")).toBe(false);
    expect(preferLocalBasemap(210, "thumb")).toBe(false);
  });
});
