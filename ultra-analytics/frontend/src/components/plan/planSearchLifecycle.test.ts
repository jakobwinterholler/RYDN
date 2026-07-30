import { describe, expect, it } from "vitest";
import {
  isAbortError,
  resolveSearchOutcome,
  SEARCH_FAIL_TOAST,
} from "./planSearchLifecycle";

describe("resolveSearchOutcome — no false timeout", () => {
  it("results win over abort/timeout", () => {
    expect(
      resolveSearchOutcome({ resultCount: 5, aborted: true, hardError: false }),
    ).toBe("results");
    expect(
      resolveSearchOutcome({ resultCount: 1, aborted: true, hardError: true }),
    ).toBe("results");
  });

  it("results win over thrown", () => {
    expect(
      resolveSearchOutcome({
        resultCount: 3,
        aborted: false,
        hardError: false,
        thrown: true,
      }),
    ).toBe("results");
  });

  it("empty when clean zero results", () => {
    expect(
      resolveSearchOutcome({ resultCount: 0, aborted: false, hardError: false }),
    ).toBe("empty");
  });

  it("failed only when no results and real failure", () => {
    expect(
      resolveSearchOutcome({ resultCount: 0, aborted: true, hardError: false }),
    ).toBe("failed");
    expect(
      resolveSearchOutcome({ resultCount: 0, aborted: false, hardError: true }),
    ).toBe("failed");
    expect(
      resolveSearchOutcome({
        resultCount: 0,
        aborted: false,
        hardError: false,
        thrown: true,
      }),
    ).toBe("failed");
  });

  it("partial tile success is Results found, not Failed", () => {
    // One tile returned POIs, second aborted
    expect(
      resolveSearchOutcome({ resultCount: 4, aborted: true, hardError: true }),
    ).toBe("results");
  });
});

describe("isAbortError", () => {
  it("detects AbortError", () => {
    expect(isAbortError(new DOMException("Aborted", "AbortError"))).toBe(true);
    expect(isAbortError(new Error("network"))).toBe(false);
    expect(SEARCH_FAIL_TOAST).toMatch(/Search failed/);
  });
});
