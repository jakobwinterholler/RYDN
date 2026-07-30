/**
 * E2E: search outcome must never treat partial success as Failed / timeout.
 */
import { test, expect } from "@playwright/test";
import {
  resolveSearchOutcome,
  isAbortError,
  SEARCH_FAIL_TOAST,
} from "../src/components/plan/planSearchLifecycle";
import {
  replaceSearchResults,
  verifiedIdSet,
} from "../src/components/plan/workspaceLayers";

test.describe("Search lifecycle — no false timeout", () => {
  test("abort after POIs arrived → Results found, not Failed", () => {
    const outcome = resolveSearchOutcome({
      resultCount: 7,
      aborted: true,
      hardError: false,
    });
    expect(outcome).toBe("results");
    // Caller must NOT toast on results
    expect(outcome === "failed" ? SEARCH_FAIL_TOAST : null).toBeNull();
  });

  test("one tile OK + one tile abort → apply temp replace", () => {
    const verified = verifiedIdSet([{ id: "v1", reviewStatus: "verified" }]);
    const collected = [
      { id: "a", reviewStatus: "unreviewed" },
      { id: "b", reviewStatus: "unreviewed" },
    ];
    const outcome = resolveSearchOutcome({
      resultCount: collected.length,
      aborted: true,
      hardError: true,
    });
    expect(outcome).toBe("results");
    const next = replaceSearchResults(collected, verified);
    expect(next.map((s) => s.id)).toEqual(["a", "b"]);
  });

  test("true failure with zero POIs → Failed + toast copy", () => {
    expect(
      resolveSearchOutcome({ resultCount: 0, aborted: true, hardError: false }),
    ).toBe("failed");
    expect(SEARCH_FAIL_TOAST).toBe("Couldn't refresh. Try again.");
  });

  test("isAbortError covers wrapped fetch abort", () => {
    expect(isAbortError(new DOMException("The user aborted a request.", "AbortError"))).toBe(
      true,
    );
    expect(isAbortError(new Error("The user aborted a request."))).toBe(true);
    expect(isAbortError(new Error("offline"))).toBe(false);
  });
});
