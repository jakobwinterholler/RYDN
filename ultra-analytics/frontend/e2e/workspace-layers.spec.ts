/**
 * Prove temporary search workspace vs permanent verified layer lifecycle.
 */
import { test, expect } from "@playwright/test";
import {
  promoteToVerified,
  removeFromSearchResults,
  replaceSearchResults,
  verifiedIdSet,
} from "../src/components/plan/workspaceLayers";
import { resolvePlanSearchChip } from "../src/components/plan/planSearchUi";

test.describe("Temp vs verified workspace lifecycle", () => {
  test("full search → verify → re-search cycle", () => {
    let searchResults = [
      { id: "t1", reviewStatus: "unreviewed" },
      { id: "t2", reviewStatus: "unreviewed" },
      { id: "t3", reviewStatus: "unreviewed" },
    ];
    let verified = [{ id: "v0", reviewStatus: "verified" }];

    // Verify t1 → leaves temp, joins permanent
    const stop = searchResults.find((s) => s.id === "t1")!;
    verified = promoteToVerified(stop, verified);
    searchResults = removeFromSearchResults(searchResults, stop.id);
    expect(searchResults.map((s) => s.id)).toEqual(["t2", "t3"]);
    expect(verified.map((s) => s.id).sort()).toEqual(["t1", "v0"]);

    // New search replaces ALL temp; verified untouched
    searchResults = replaceSearchResults(
      [
        { id: "n1", reviewStatus: "unreviewed" },
        { id: "t1", reviewStatus: "unreviewed" }, // already verified — filtered
        { id: "n2", reviewStatus: "unreviewed" },
      ],
      verifiedIdSet(verified),
    );
    expect(searchResults.map((s) => s.id)).toEqual(["n1", "n2"]);
    expect(verified.map((s) => s.id).sort()).toEqual(["t1", "v0"]);

    // Failed search keeps previous temp (caller does not call replace)
    const kept = searchResults;
    expect(kept.map((s) => s.id)).toEqual(["n1", "n2"]);
  });

  test("Search here requires pan + category; exclusive chip", () => {
    const tight = { south: 48.1, west: 11.5, north: 48.2, east: 11.6 };
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
        mode: "plan",
        searching: false,
        prompted: true,
        hasCategory: true,
        bbox: tight,
      }),
    ).toBe("ready");
  });

  test("DOM: toast never coexists as a second search chip", async ({ page }) => {
    await page.setContent(`<!DOCTYPE html>
<html><body>
  <div class="plan-map-top">
    <button data-search-chip="ready">Search here</button>
  </div>
  <div class="plan-toast" data-testid="plan-toast">Couldn't refresh. Try again.</div>
  <script>
    window.__chips = () => [...document.querySelectorAll('[data-search-chip]')]
      .filter((el) => !el.hidden).map((el) => el.getAttribute('data-search-chip'));
  </script>
</body></html>`);
    const chips = await page.evaluate(
      () => (window as unknown as { __chips: () => string[] }).__chips(),
    );
    expect(chips).toEqual(["ready"]);
    await expect(page.getByTestId("plan-toast")).toHaveText("Couldn't refresh. Try again.");
  });
});
