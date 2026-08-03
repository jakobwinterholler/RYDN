/**
 * Temporary race-open diagnostics. Remove after the freeze is resolved.
 * Logs appear in the browser console with ISO timestamps.
 */

import { useEffect, useLayoutEffect } from "react";

export type RaceOpenStep =
  | "open_race.start"
  | "open_race.fetch_detail.start"
  | "open_race.fetch_detail.done"
  | "open_race.fetch_roadbook.start"
  | "open_race.fetch_roadbook.response"
  | "open_race.parse_roadbook.start"
  | "open_race.parse_roadbook.done"
  | "open_race.done"
  | "open_race.error"
  | "render.dashboard.start"
  | "render.dashboard.done"
  | "render.route.start"
  | "render.route.done"
  | "render.resupply.start"
  | "render.resupply.done"
  | "render.unsupported.start"
  | "render.unsupported.done"
  | "planning.select_hubs.start"
  | "planning.select_hubs.done";

export interface RaceOpenTraceEntry {
  step: RaceOpenStep;
  at: string;
  msSinceStart: number;
  raceId?: string;
  detail?: string;
}

declare global {
  interface Window {
    __RACE_OPEN_TRACE?: RaceOpenTraceEntry[];
    __RACE_OPEN_TRACE_START?: number;
  }
}

function ensureTrace(): RaceOpenTraceEntry[] {
  if (typeof window === "undefined") {
    return [];
  }
  if (!window.__RACE_OPEN_TRACE) {
    window.__RACE_OPEN_TRACE = [];
    window.__RACE_OPEN_TRACE_START = performance.now();
  }
  return window.__RACE_OPEN_TRACE;
}

export function resetRaceOpenTrace(raceId?: string): void {
  if (typeof window === "undefined") {
    return;
  }
  window.__RACE_OPEN_TRACE = [];
  window.__RACE_OPEN_TRACE_START = performance.now();
  raceOpenTrace("open_race.start", { raceId, detail: "trace reset" });
}

export function raceOpenTrace(
  step: RaceOpenStep,
  options: { raceId?: string; detail?: string } = {},
): void {
  if (typeof window === "undefined") {
    return;
  }
  const trace = ensureTrace();
  const start = window.__RACE_OPEN_TRACE_START ?? performance.now();
  const entry: RaceOpenTraceEntry = {
    step,
    at: new Date().toISOString(),
    msSinceStart: Math.round(performance.now() - start),
    raceId: options.raceId,
    detail: options.detail,
  };
  trace.push(entry);
  if (import.meta.env.DEV) {
    console.info(`[race-open] ${entry.at} +${entry.msSinceStart}ms ${step}`, options.detail ?? "");
  }
}

export function getRaceOpenTrace(): RaceOpenTraceEntry[] {
  return typeof window !== "undefined" ? (window.__RACE_OPEN_TRACE ?? []) : [];
}

export function useRenderTrace(stepStart: RaceOpenStep, stepDone: RaceOpenStep): void {
  useLayoutEffect(() => {
    raceOpenTrace(stepStart);
  }, [stepStart]);

  useEffect(() => {
    raceOpenTrace(stepDone);
  }, [stepDone]);
}
