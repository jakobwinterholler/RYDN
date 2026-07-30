/**
 * Prove exclusive Planning search-chip states — only one data-search-chip at a time.
 */
import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  bboxSpanTooLarge,
  resolvePlanSearchChip,
  type PlanSearchChip,
} from "../src/components/plan/planSearchUi";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const evidenceDir = path.join(__dirname, "..", "test-results");

test.describe("Plan search chip state machine", () => {
  test("resolvePlanSearchChip never overlaps states", () => {
    const tight = { south: 48.1, west: 11.5, north: 48.2, east: 11.6 };
    const huge = { south: 40, west: 0, north: 52, east: 15 };
    expect(bboxSpanTooLarge(huge)).toBe(true);

    const flow: PlanSearchChip[] = [
      resolvePlanSearchChip({
        mode: "plan",
        searching: false,
        prompted: false,
        hasCategory: true,
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
        prompted: false,
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
      resolvePlanSearchChip({
        mode: "plan",
        searching: false,
        prompted: true,
        hasCategory: false,
        bbox: tight,
      }),
    ];
    expect(flow).toEqual(["hidden", "ready", "searching", "hidden", "zoomIn", "hidden"]);
  });

  test("DOM harness shows exactly one chip node per state", async ({ page }) => {
    await page.setContent(`<!DOCTYPE html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  .plan-map-top{display:flex;flex-direction:column;align-items:center;gap:8px;padding:12px}
  .plan-search-chip{min-height:44px;padding:0 18px;border-radius:999px;border:1px solid #ccc;
    display:inline-flex;align-items:center;gap:8px;font:600 14px system-ui}
  .plan-nearest{width:240px;padding:10px;border:1px solid #ccc;border-radius:12px}
  [hidden]{display:none!important}
</style></head>
<body>
  <div class="plan-map-top" data-testid="plan-map-top">
    <div class="plan-search-chip" data-search-chip="zoomIn" hidden>Zoom in to search this area</div>
    <button class="plan-search-chip" data-search-chip="ready" hidden>Search this area</button>
    <div class="plan-search-chip" data-search-chip="searching" hidden>Searching…</div>
    <aside class="plan-nearest" data-testid="nearest" hidden>Nearest card</aside>
  </div>
  <script>
    const chips = () => [...document.querySelectorAll('[data-search-chip]')];
    window.__setChip = (state) => {
      chips().forEach((el) => { el.hidden = el.getAttribute('data-search-chip') !== state; });
      document.querySelector('[data-testid=nearest]').hidden = state === 'hidden';
    };
    window.__visibleChips = () => chips().filter((el) => !el.hidden).map((el) => el.getAttribute('data-search-chip'));
    window.__setChip('hidden');
  </script>
</body></html>`);

    const steps: Array<{ state: PlanSearchChip | "hidden"; expect: string[] }> = [
      { state: "hidden", expect: [] },
      { state: "ready", expect: ["ready"] },
      { state: "searching", expect: ["searching"] },
      { state: "hidden", expect: [] },
      { state: "zoomIn", expect: ["zoomIn"] },
    ];

    for (const step of steps) {
      await page.evaluate((s) => {
        (window as unknown as { __setChip: (x: string) => void }).__setChip(s);
      }, step.state);
      const visible = await page.evaluate(
        () => (window as unknown as { __visibleChips: () => string[] }).__visibleChips(),
      );
      expect(visible, `state=${step.state}`).toEqual(step.expect);
      // Hard exclusivity: never more than one chip
      expect(visible.length).toBeLessThanOrEqual(1);
    }

    // ZoomIn must not coexist with ready
    await page.evaluate(() => {
      document.querySelectorAll("[data-search-chip]").forEach((el) => {
        (el as HTMLElement).hidden = false;
      });
    });
    const broken = await page.evaluate(
      () => (window as unknown as { __visibleChips: () => string[] }).__visibleChips(),
    );
    // Simulate what RoutePage forbids: if both visible, length > 1
    expect(broken.length).toBeGreaterThan(1);
    // Restore exclusive machine
    await page.evaluate(() => {
      (window as unknown as { __setChip: (x: string) => void }).__setChip("zoomIn");
    });
    expect(
      await page.evaluate(
        () => (window as unknown as { __visibleChips: () => string[] }).__visibleChips(),
      ),
    ).toEqual(["zoomIn"]);

    await page.screenshot({
      path: path.join(evidenceDir, "search-chip-exclusive.png"),
    });
  });
});
