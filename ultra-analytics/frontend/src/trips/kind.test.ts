import { describe, expect, it } from "vitest";
import { countUltrasByKind, filterUltrasByKind, normalizeUltraKind, ultraKindLabel } from "./kind";

describe("normalizeUltraKind", () => {
  it("maps known values", () => {
    expect(normalizeUltraKind("race")).toBe("race");
    expect(normalizeUltraKind("bikepacking")).toBe("bikepacking");
    expect(normalizeUltraKind("ultra")).toBe("ultra");
    expect(normalizeUltraKind("training")).toBe("ultra");
    expect(normalizeUltraKind("")).toBe("ultra");
  });

  it("maps legacy tour to Long ride", () => {
    expect(normalizeUltraKind("tour")).toBe("ultra");
    expect(normalizeUltraKind("tours")).toBe("ultra");
  });
});

describe("filter + counts", () => {
  const ultras = [
    { kind: "race" },
    { kind: "race" },
    { kind: "bikepacking" },
    { kind: "tour" },
    { kind: "ultra" },
    { kind: "training" },
  ];

  it("filters by kind", () => {
    expect(filterUltrasByKind(ultras, "race")).toHaveLength(2);
    // tour + ultra + training → Long ride
    expect(filterUltrasByKind(ultras, "ultra")).toHaveLength(3);
    expect(filterUltrasByKind(ultras, "all")).toHaveLength(6);
  });

  it("counts", () => {
    const c = countUltrasByKind(ultras);
    expect(c.all).toBe(6);
    expect(c.race).toBe(2);
    expect(c.bikepacking).toBe(1);
    expect(c.ultra).toBe(3);
  });

  it("labels", () => {
    expect(ultraKindLabel("tour")).toBe("Long ride");
    expect(ultraKindLabel("ultra")).toBe("Long ride");
    expect(ultraKindLabel("race")).toBe("Race");
  });
});
