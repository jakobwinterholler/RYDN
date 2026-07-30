/** Pure search lifecycle outcomes — no false timeout when POIs arrived. */

export type PlanSearchOutcome = "results" | "empty" | "failed";

export interface SearchOutcomeInput {
  /** Unique POIs absorbed before settle (including partial tile success). */
  resultCount: number;
  /** True if the controller aborted (timeout or supersede). */
  aborted: boolean;
  /** True if a non-abort network/API failure occurred with no usable body. */
  hardError: boolean;
  /** True if an exception escaped (should be rare with per-tile catch). */
  thrown?: boolean;
}

/**
 * Resolve Idle→Searching→{Results|Empty|Failed}.
 *
 * Partial success (any POIs) ALWAYS wins over abort/timeout/error.
 * Fail only when nothing usable arrived AND something actually failed.
 */
export function resolveSearchOutcome(input: SearchOutcomeInput): PlanSearchOutcome {
  if (input.resultCount > 0) return "results";
  if (input.hardError || input.thrown || input.aborted) return "failed";
  return "empty";
}

export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; message?: string; code?: string };
  if (e.name === "AbortError") return true;
  // fetch abort wrapped as ApiError(network) still carries abort copy
  return /abort/i.test(e.message || "");
}

/** Fail toast copy — only when outcome === failed. Hard 5s cap. */
export const SEARCH_FAIL_TOAST = "Search failed";

/** Client hard cap — cancel, show fail toast, stop spinner. */
export const SEARCH_TIMEOUT_MS = 5_000;
