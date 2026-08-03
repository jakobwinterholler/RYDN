/**
 * Forensic PlanMap proof — inject POI markers for Water/Markets/24h/Sleep,
 * assert symbol layers, correct sprites, and click → selection.
 */
import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const evidenceDir = path.join(__dirname, "..", "test-results");

test.describe("PlanMap marker pipeline", () => {
  test("all 4 category sprites render and markers are clickable", async ({ page }) => {
    page.on("console", (msg) => {
      if (msg.type() === "warning" || msg.type() === "error") {
        console.log("BROWSER:", msg.type(), msg.text());
      }
    });
    page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

    await page.goto("/planmap-harness.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => (window as unknown as { __planMapReady?: boolean }).__planMapReady === true,
      null,
      { timeout: 60000 },
    );
    await page.waitForTimeout(800);

    // Declutter so unclustered symbol layers paint
    await page.evaluate(async () => {
      const map = (window as unknown as { __planMap: { easeTo: (o: unknown) => void } }).__planMap;
      map.easeTo({ center: [11.575, 48.137], zoom: 15, duration: 0 });
      await new Promise((r) => setTimeout(r, 700));
    });

    const probe = await page.evaluate(() => {
      const w = window as unknown as {
        __planMap?: {
          queryRenderedFeatures: (
            g?: unknown,
            o?: { layers?: string[] },
          ) => Array<{
            layer?: { id?: string };
            properties?: Record<string, unknown>;
          }>;
          getStyle?: () => { layers?: Array<{ id: string; type: string }> };
          getZoom?: () => number;
          hasImage?: (id: string) => boolean;
          querySourceFeatures?: (s: string) => unknown[];
        };
        __planMarkers?: Array<{ id: string }>;
      };
      const map = w.__planMap!;
      const layerIds = (map.getStyle?.()?.layers || []).map((l) => l.id);
      const icons = map.queryRenderedFeatures(undefined, {
        layers: ["stops-icons", "stops-verified"],
      });
      const byCat: Record<string, string> = {};
      for (const f of icons) {
        const cat = String(f.properties?.category || "");
        byCat[cat] = String(f.properties?.sprite || "");
      }
      return {
        zoom: map.getZoom?.(),
        hasIconsLayer: layerIds.includes("stops-icons"),
        hasVerifiedLayer: layerIds.includes("stops-verified"),
        iconCount: icons.length,
        byCat,
        sprites: icons.map((f) => f.properties?.sprite),
        spriteOk: {
          supermarket: !!map.hasImage?.("rydn-supermarket-emphasized"),
          water: !!map.hasImage?.("rydn-waterFountain-emphasized"),
          shop24h: !!map.hasImage?.("rydn-shop24h-emphasized"),
          sleep: !!map.hasImage?.("rydn-sleepSpot-emphasizedVerified"),
        },
        clusterCount: map.queryRenderedFeatures(undefined, { layers: ["stops-clusters"] }).length,
        layerError: layerIds.includes("stops-icons") ? null : "stops-icons missing",
      };
    });

    console.log("PROBE", JSON.stringify(probe, null, 2));
    expect(probe.hasIconsLayer).toBe(true);
    expect(probe.hasVerifiedLayer).toBe(true);
    expect(probe.iconCount).toBeGreaterThanOrEqual(4);
    expect(probe.clusterCount).toBe(0); // zoom 15 — real icons, not cluster dots
    expect(probe.spriteOk.supermarket).toBe(true);
    expect(probe.spriteOk.water).toBe(true);
    expect(probe.spriteOk.shop24h).toBe(true);
    expect(probe.spriteOk.sleep).toBe(true);

    // Sprites must be category icons — drop / basket / moon / bed
    const spriteList = (probe.sprites || []).map(String);
    expect(spriteList.some((s) => s.includes("waterFountain"))).toBe(true);
    expect(spriteList.some((s) => s.includes("supermarket"))).toBe(true);
    expect(spriteList.some((s) => s.includes("shop24h"))).toBe(true);
    expect(spriteList.some((s) => s.includes("sleepSpot"))).toBe(true);

    const categories = [
      { id: "area-node-market-1", expectSprite: "supermarket" },
      { id: "area-node-24h-1", expectSprite: "shop24h" },
      { id: "area-node-sleep-1", expectSprite: "sleepSpot" },
      { id: "area-node-water-1", expectSprite: "waterFountain" },
    ];

    for (const cat of categories) {
      const clicked = await page.evaluate(async (targetId) => {
        const w = window as unknown as {
          __planMap: {
            queryRenderedFeatures: (
              pt: { x: number; y: number } | [{ x: number; y: number }, { x: number; y: number }],
              o?: { layers?: string[] },
            ) => Array<{ properties?: Record<string, unknown> }>;
            project: (c: [number, number]) => { x: number; y: number };
            fire: (
              type: string,
              e: { point: { x: number; y: number }; lngLat: { lng: number; lat: number } },
            ) => void;
            easeTo: (o: unknown) => void;
          };
          __planMarkers: Array<{ id: string; lon: number; lat: number }>;
          __lastSelect?: string;
        };
        const m = w.__planMarkers.find((x) => x.id === targetId);
        if (!m) return { ok: false, reason: "missing marker" };
        w.__planMap.easeTo({ center: [m.lon, m.lat], zoom: 15.5, duration: 0 });
        await new Promise((r) => setTimeout(r, 350));
        const pt = w.__planMap.project([m.lon, m.lat]);
        const box: [{ x: number; y: number }, { x: number; y: number }] = [
          { x: pt.x - 18, y: pt.y - 18 },
          { x: pt.x + 18, y: pt.y + 18 },
        ];
        const hits = w.__planMap
          .queryRenderedFeatures(box, { layers: ["stops-icons", "stops-verified"] })
          .filter((f) => String(f.properties?.id || "") === targetId);
        const fallback = hits.length
          ? hits
          : w.__planMap.queryRenderedFeatures(box, { layers: ["stops-icons", "stops-verified"] });
        if (!fallback.length) return { ok: false, reason: "no hit", id: targetId };
        const hit = hits[0] || fallback[0];
        w.__planMap.fire("click", { point: pt, lngLat: { lng: m.lon, lat: m.lat } });
        await new Promise((r) => setTimeout(r, 150));
        return {
          ok: true,
          id: String(hit.properties?.id || ""),
          sprite: String(hit.properties?.sprite || ""),
          lastSelect: w.__lastSelect || "",
        };
      }, cat.id);

      console.log("CLICK", cat.id, JSON.stringify(clicked));
      expect(clicked.ok).toBe(true);
      expect(clicked.lastSelect).toBe(cat.id);
      expect(String(clicked.sprite)).toContain(cat.expectSprite);
    }

    await page.screenshot({
      path: path.join(evidenceDir, "planmap-markers-proof.png"),
      fullPage: true,
    });

    const selText = await page.locator("[data-testid=selection]").innerText();
    expect(selText).toContain("area-node-water-1");
  });
});
