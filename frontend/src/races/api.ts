import { apiFetch } from "../api/authFetch";
import { getFreshAccessToken } from "@shared/auth/accessToken";
import { fetchSyncRaces, pushRaceNow } from "@shared/api/sync";
import { addPendingSyncRace, removePendingSyncRace } from "@shared/sync/pendingSync";
import { isDesktopCloudCurrent, resolveCloudRaceForLocal } from "@shared/sync/raceVersion";
import type {
  AnalysisStreamEvent,
  ProgressStepDefinition,
} from "../progress";
import type { PoiPlanningProfile, RoadbookResult } from "../api";
import { getSyncUserId } from "../sync/syncUserContext";
import { raceOpenTrace } from "../debug/raceOpenTrace";
import {
  DEFAULT_POI_PROFILE,
  mergePartialRoadbook,
} from "../api";
import type {
  StopRejectFeedbackContext,
  StopRejectReason,
  StopVerificationStatus,
  VerifiedStopRecord,
} from "../planning/stopVerification/types";

import type { RaceDashboardStats } from "@shared/race/readiness";

export type PreparationMilestoneId =
  | "route_understood"
  | "unsupported_reviewed"
  | "stops_verified"
  | "key_climbs_reviewed"
  | "equipment_decided"
  | "stages_planned"
  | "export_generated";

export type { StopRejectReason, StopVerificationStatus, VerifiedStopRecord, StopRejectFeedbackContext };

export interface PreparationProgressItem {
  id: PreparationMilestoneId;
  label: string;
  complete: boolean;
}

export interface RaceSummary {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  last_opened_at: string;
  gpx_original_name: string;
  distance_km: number | null;
  elevation_gain_m: number | null;
  climb_count: number | null;
  gpx_fingerprint?: string | null;
  has_analysis: boolean;
  preparation_completed: number;
  preparation_total: number;
  preparation_items: PreparationProgressItem[];
  archived_at?: string | null;
  dashboard_stats?: RaceDashboardStats | null;
}

export interface RaceDetail {
  race: RaceSummary;
  settings: { poi_profile: PoiPlanningProfile };
  preparation: {
    climb_nicknames: Record<string, string>;
    progress: Record<PreparationMilestoneId, boolean>;
    verified_stops: Record<string, VerifiedStopRecord>;
  };
  exports: Array<{
    id: string;
    type: string;
    filename: string;
    created_at: string;
  }>;
}

async function parseError(response: Response, fallback: string): Promise<string> {
  const error = await response.json().catch(() => ({ detail: fallback }));
  const detail = error.detail;
  return typeof detail === "string" ? detail : fallback;
}

export async function fetchRaces(includeArchived = false): Promise<RaceSummary[]> {
  const query = includeArchived ? "?include_archived=1" : "";
  const response = await apiFetch(`/api/races${query}`);
  if (!response.ok) {
    throw new Error(await parseError(response, "Failed to load races."));
  }
  const payload = await response.json();
  return payload.races ?? [];
}

export async function createRace(file: File, name?: string): Promise<RaceSummary> {
  const formData = new FormData();
  formData.append("file", file);
  if (name?.trim()) {
    formData.append("name", name.trim());
  }

  const response = await apiFetch("/api/races", { method: "POST", body: formData });
  if (!response.ok) {
    throw new Error(await parseError(response, "Failed to create race."));
  }
  const payload = await response.json();
  return payload.race;
}

export async function fetchRaceDetail(raceId: string): Promise<RaceDetail> {
  const response = await apiFetch(`/api/races/${raceId}`);
  if (!response.ok) {
    throw new Error(await parseError(response, "Failed to load race."));
  }
  const payload = await response.json();
  return {
    ...payload,
    preparation: {
      climb_nicknames: payload.preparation?.climb_nicknames ?? {},
      progress: payload.preparation?.progress ?? {},
      verified_stops: parseVerifiedStops(payload.preparation?.verified_stops),
    },
  };
}

export async function renameRace(raceId: string, name: string): Promise<RaceSummary> {
  const response = await apiFetch(`/api/races/${raceId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) {
    throw new Error(await parseError(response, "Failed to rename race."));
  }
  const payload = await response.json();
  return payload.race;
}

export async function deleteRace(raceId: string): Promise<void> {
  const response = await apiFetch(`/api/races/${raceId}`, { method: "DELETE" });
  if (!response.ok) {
    throw new Error(await parseError(response, "Failed to delete race."));
  }
}

export async function duplicateRace(raceId: string): Promise<RaceSummary> {
  const response = await apiFetch(`/api/races/${raceId}/duplicate`, { method: "POST" });
  if (!response.ok) {
    throw new Error(await parseError(response, "Failed to duplicate race."));
  }
  const payload = await response.json();
  return payload.race;
}

export async function archiveRace(raceId: string, archived: boolean): Promise<RaceSummary> {
  const response = await apiFetch(`/api/races/${raceId}/archive`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ archived }),
  });
  if (!response.ok) {
    throw new Error(await parseError(response, "Failed to update archive status."));
  }
  const payload = await response.json();
  return payload.race;
}

export async function updateRacePreparation(
  raceId: string,
  payload: {
    progress?: Partial<Record<PreparationMilestoneId, boolean>>;
    verifiedStops?: Record<string, VerifiedStopRecord | { _delete: true }>;
  },
): Promise<{ race: RaceSummary; preparation: RaceDetail["preparation"] }> {
  const body: {
    progress?: Partial<Record<PreparationMilestoneId, boolean>>;
    verified_stops?: Record<string, Record<string, unknown>>;
  } = {};

  if (payload.progress && Object.keys(payload.progress).length > 0) {
    body.progress = payload.progress;
  }
  if (payload.verifiedStops) {
    body.verified_stops = Object.fromEntries(
      Object.entries(payload.verifiedStops).map(([key, record]) => {
        if ("_delete" in record) {
          return [key, { _delete: true }];
        }
        return [
          key,
          {
            status: record.status,
            reject_reason: record.rejectReason,
            reject_notes: record.rejectNotes,
            feedback_context: record.feedbackContext
              ? {
                  zone_id: record.feedbackContext.zoneId,
                  poi_category: record.feedbackContext.poiCategory,
                  category_key: record.feedbackContext.categoryKey,
                  distance_along_km: record.feedbackContext.distanceAlongKm,
                  distance_off_route_m: record.feedbackContext.distanceOffRouteM,
                  fuel_shop_confidence: record.feedbackContext.fuelShopConfidence,
                  poi_name: record.feedbackContext.poiName,
                  algorithm_targets: record.feedbackContext.algorithmTargets,
                }
              : undefined,
            poi_key: record.poiKey,
            updated_at: record.updatedAt,
          },
        ];
      }),
    );
  }

  const response = await apiFetch(`/api/races/${raceId}/preparation`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await parseError(response, "Failed to update preparation."));
  }
  const result = await response.json();
  return {
    race: result.race,
    preparation: {
      climb_nicknames: result.preparation.climb_nicknames ?? {},
      progress: result.preparation.progress ?? {},
      verified_stops: parseVerifiedStops(result.preparation.verified_stops),
    },
  };
}

export async function promoteDiscoveredStop(
  raceId: string,
  payload: {
    suggestedStop: import("../api").SuggestedStop;
    verifiedStop?: { zoneId: number; record: VerifiedStopRecord };
  },
): Promise<import("../api").RoadbookResult> {
  const body: {
    suggested_stop: Record<string, unknown>;
    verified_stop?: Record<string, unknown>;
  } = {
    suggested_stop: {
      zone_id: payload.suggestedStop.zone_id,
      osm_id: payload.suggestedStop.osm_id,
      osm_type: payload.suggestedStop.osm_type,
      name: payload.suggestedStop.name,
      poi_category: payload.suggestedStop.poi_category,
      category_key: payload.suggestedStop.category_key,
      category_label: payload.suggestedStop.category_label,
      distance_along_km: payload.suggestedStop.distance_along_km,
      distance_off_route_m: payload.suggestedStop.distance_off_route_m,
      lat: payload.suggestedStop.lat,
      lon: payload.suggestedStop.lon,
      score: payload.suggestedStop.score,
      reason: payload.suggestedStop.reason,
    },
  };

  if (payload.verifiedStop) {
    const { zoneId, record } = payload.verifiedStop;
    body.verified_stop = {
      zone_id: zoneId,
      record: {
        status: record.status,
        poi_key: record.poiKey,
        updated_at: record.updatedAt,
      },
    };
  }

  const response = await apiFetch(`/api/races/${raceId}/promote-discovery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await parseError(response, "Failed to promote discovered stop."));
  }
  const result = await response.json();
  return result.roadbook as import("../api").RoadbookResult;
}

function parseVerifiedStops(
  raw: Record<string, unknown> | undefined,
): Record<string, VerifiedStopRecord> {
  if (!raw) {
    return {};
  }
  const parsed: Record<string, VerifiedStopRecord> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!value || typeof value !== "object") {
      continue;
    }
    const record = value as Record<string, unknown>;
    parsed[key] = {
      status: record.status as StopVerificationStatus,
      rejectReason: record.reject_reason as StopRejectReason | undefined,
      rejectNotes: record.reject_notes as string | undefined,
      feedbackContext: parseFeedbackContext(record.feedback_context),
      poiKey: record.poi_key as string | undefined,
      updatedAt: String(record.updated_at ?? new Date().toISOString()),
    };
  }
  return parsed;
}

function parseFeedbackContext(raw: unknown): StopRejectFeedbackContext | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const context = raw as Record<string, unknown>;
  const zoneId = context.zone_id ?? context.zoneId;
  if (typeof zoneId !== "number") {
    return undefined;
  }
  return {
    zoneId,
    poiCategory: context.poi_category as string | undefined,
    categoryKey: context.category_key as string | undefined,
    distanceAlongKm: context.distance_along_km as number | undefined,
    distanceOffRouteM: context.distance_off_route_m as number | undefined,
    fuelShopConfidence: context.fuel_shop_confidence as string | undefined,
    poiName: context.poi_name as string | null | undefined,
    algorithmTargets: Array.isArray(context.algorithm_targets)
      ? (context.algorithm_targets as StopRejectFeedbackContext["algorithmTargets"])
      : [],
  };
}

export async function fetchRaceRoadbook(raceId: string): Promise<RoadbookResult> {
  raceOpenTrace("open_race.fetch_roadbook.start", { raceId });
  const response = await apiFetch(`/api/races/${raceId}/roadbook`);
  if (!response.ok) {
    throw new Error(await parseError(response, "Roadbook not available."));
  }
  raceOpenTrace("open_race.fetch_roadbook.response", {
    raceId,
    detail: `status=${response.status}`,
  });
  raceOpenTrace("open_race.parse_roadbook.start", { raceId });
  const parseStarted = performance.now();
  const text = await response.text();
  const payload = JSON.parse(text) as RoadbookResult;
  raceOpenTrace("open_race.parse_roadbook.done", {
    raceId,
    detail: `bytes=${text.length} parse_ms=${Math.round(performance.now() - parseStarted)}`,
  });
  return payload;
}

function parseStreamEvent(raw: string): AnalysisStreamEvent | null {
  try {
    return JSON.parse(raw) as AnalysisStreamEvent;
  } catch {
    return null;
  }
}

export async function analyzeRaceStream(
  raceId: string,
  onEvent: (event: AnalysisStreamEvent | unknown) => void,
): Promise<RoadbookResult> {
  const response = await apiFetch(`/api/races/${raceId}/analyze/stream`, {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(await parseError(response, "Analysis failed."));
  }
  if (!response.body) {
    throw new Error("Analysis stream unavailable.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: RoadbookResult | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";

    for (const chunk of chunks) {
      const line = chunk
        .split("\n")
        .find((entry) => entry.startsWith("data: "));
      if (!line) {
        continue;
      }

      const event = parseStreamEvent(line.slice(6));
      if (!event) {
        continue;
      }
      onEvent(event);
      if (event.type === "complete") {
        result = event.data as RoadbookResult;
      }
      if (event.type === "error") {
        throw new Error(event.detail);
      }
    }
  }

  if (!result) {
    throw new Error("Analysis finished without a result.");
  }

  const userId = getSyncUserId();
  const token = await getFreshAccessToken();
  if (userId) {
    try {
      await pushRaceNow(token, raceId, userId);
      removePendingSyncRace(userId, raceId);
    } catch (err) {
      try {
        const [localRaces, cloudRaces] = await Promise.all([
          fetchRaces(),
          fetchSyncRaces(token ?? ""),
        ]);
        const local = localRaces.find((race) => race.id === raceId);
        const cloud = local ? resolveCloudRaceForLocal(local, cloudRaces) : undefined;
        if (local && isDesktopCloudCurrent(local, cloud)) {
          removePendingSyncRace(userId, raceId);
          return result;
        }
      } catch {
        // Ignore reconcile errors — fall through to pending + user message.
      }
      addPendingSyncRace(userId, raceId);
      const message = err instanceof Error ? err.message : "Cloud upload failed.";
      throw new Error(`Analysis saved locally but cloud upload failed: ${message}`);
    }
  }

  return result;
}

export async function saveRaceClimbNicknames(
  raceId: string,
  nicknames: Record<string, string>,
): Promise<{ climbs: RoadbookResult["climbs"] }> {
  const response = await apiFetch(`/api/races/${raceId}/climbs/nicknames`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nicknames }),
  });
  if (!response.ok) {
    throw new Error(await parseError(response, "Failed to save climb nicknames."));
  }
  return response.json();
}

export async function recalculateRaceClimbs(
  raceId: string,
  config: import("../api").ClimbDetectionConfig,
): Promise<{
  climbs: RoadbookResult["climbs"];
  climb_candidates: RoadbookResult["climb_candidates"];
  summary: { climb_count: number };
  config: import("../api").ClimbDetectionConfig;
}> {
  const response = await apiFetch(`/api/races/${raceId}/climbs/recalculate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!response.ok) {
    throw new Error(await parseError(response, "Climb recalculation failed."));
  }
  return response.json();
}

export interface RoutePreviewStep {
  id: string;
  label: string;
  status: "pending" | "running" | "complete" | "error";
}

export interface RoutePreviewJobSlice {
  status: "idle" | "running" | "complete" | "error";
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  steps: RoutePreviewStep[];
  progress: {
    label?: string;
    current?: number;
    total?: number;
  };
}

export interface RoutePreviewDebugInfo {
  is_stale: boolean;
  reasons: string[];
  prepared_at: string | null;
  pipeline_version: string;
  stored_pipeline_version: string | null;
  source_fingerprint: string | null;
  stored_source_fingerprint: string | null;
  story_version: string;
  runtime_version: string;
  camera_version: string;
  last_cache_hit: boolean | null;
  has_runtime: boolean;
  has_cache: boolean;
  has_video: boolean;
  runtime: {
    generated_at?: string;
    story_version?: string;
    runtime_version?: string;
    pipeline_version?: string;
    file_mtime?: string;
    file_size_bytes?: number;
    parse_error?: boolean;
  };
  cache: {
    present?: boolean;
    segment_hash?: string;
    terrain_zoom?: number;
    tile_count?: number;
    updated_at?: string;
    file_mtime?: string;
    parse_error?: boolean;
  };
}

export interface RoutePreviewStatus {
  race_id: string;
  prepared: boolean;
  has_runtime: boolean;
  has_cache: boolean;
  has_video: boolean;
  is_stale: boolean;
  stale_reasons: string[];
  prepared_at: string | null;
  pipeline_version: string;
  stored_pipeline_version: string | null;
  source_fingerprint: string | null;
  stored_source_fingerprint: string | null;
  story_version: string;
  runtime_version: string;
  camera_version: string;
  last_cache_hit: boolean | null;
  debug: RoutePreviewDebugInfo;
  prepare: RoutePreviewJobSlice;
  export: RoutePreviewJobSlice;
  status: "idle" | "running" | "complete" | "error";
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  steps: RoutePreviewStep[];
  progress: {
    label?: string;
    current?: number;
    total?: number;
  };
}

export type RoutePreviewStreamEvent =
  | { type: "step"; id: string; label: string; status: string }
  | { type: "progress"; id: string; label: string; current: number; total: number }
  | { type: "complete"; data: { has_video?: boolean; prepared?: boolean; race_id: string } }
  | { type: "error"; detail: string }
  | { type: "done" };

export function racePreviewVideoUrl(raceId: string, version = 0): string {
  const suffix = version > 0 ? `?v=${version}` : "";
  return `/api/races/${raceId}/preview/video${suffix}`;
}

export function racePreviewCacheBaseUrl(raceId: string, cacheVersion = 0): string {
  const suffix = cacheVersion > 0 ? `?v=${cacheVersion}` : "";
  return `/api/races/${raceId}/preview/cache${suffix}`;
}

export async function fetchRoutePreviewRuntime(raceId: string, cacheBust?: string | number) {
  const suffix = cacheBust ? `?v=${encodeURIComponent(String(cacheBust))}` : `?t=${Date.now()}`;
  const response = await apiFetch(`/api/races/${raceId}/preview/runtime${suffix}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(await parseError(response, "Failed to load route preview runtime."));
  }
  return response.json();
}

export async function fetchRoutePreviewStatus(raceId: string): Promise<RoutePreviewStatus> {
  const response = await apiFetch(`/api/races/${raceId}/preview/status?t=${Date.now()}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(await parseError(response, "Failed to load route preview status."));
  }
  return response.json();
}

function parsePreviewStreamEvent(raw: string): RoutePreviewStreamEvent | null {
  try {
    return JSON.parse(raw) as RoutePreviewStreamEvent;
  } catch {
    return null;
  }
}

export async function generateRoutePreviewStream(
  raceId: string,
  onEvent: (event: RoutePreviewStreamEvent) => void,
): Promise<void> {
  await consumePreviewStream(`/api/races/${raceId}/preview/generate/stream`, onEvent);
}

export async function prepareRoutePreviewStream(
  raceId: string,
  onEvent: (event: RoutePreviewStreamEvent) => void,
): Promise<void> {
  await consumePreviewStream(`/api/races/${raceId}/preview/prepare/stream`, onEvent);
}

async function consumePreviewStream(
  endpoint: string,
  onEvent: (event: RoutePreviewStreamEvent) => void,
): Promise<void> {
  const response = await apiFetch(endpoint, {
    method: "POST",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(await parseError(response, "Route preview stream failed."));
  }
  if (!response.body) {
    throw new Error("Route preview stream unavailable.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";

    for (const chunk of chunks) {
      const line = chunk.split("\n").find((entry) => entry.startsWith("data: "));
      if (!line) {
        continue;
      }

      const event = parsePreviewStreamEvent(line.slice(6));
      if (!event) {
        continue;
      }
      onEvent(event);
      if (event.type === "error") {
        throw new Error(event.detail);
      }
      if (event.type === "complete" || event.type === "done") {
        return;
      }
    }
  }
}

export function raceExportEndpoint(raceId: string, type: "excel" | "validation-gpx"): string {
  return `/api/races/${raceId}/exports/${type}`;
}

export interface RaceGpsExportQuery {
  device: "original" | "coros" | "garmin" | "wahoo";
  verifiedOnly: boolean;
  includeHighConfidence: boolean;
  includeAlternatives: boolean;
  includeOptional: boolean;
}

export function raceGpsExportEndpoint(raceId: string, options: RaceGpsExportQuery): string {
  const params = new URLSearchParams({
    device: options.device,
    verified_only: options.verifiedOnly ? "true" : "false",
    include_high_confidence: options.includeHighConfidence ? "true" : "false",
    include_alternatives: options.includeAlternatives ? "true" : "false",
    include_optional: options.includeOptional ? "true" : "false",
  });
  return `/api/races/${raceId}/exports/gps-gpx?${params.toString()}`;
}

export function raceGpsExportPreviewEndpoint(raceId: string, options: RaceGpsExportQuery): string {
  const params = new URLSearchParams({
    device: options.device,
    verified_only: options.verifiedOnly ? "true" : "false",
    include_high_confidence: options.includeHighConfidence ? "true" : "false",
    include_alternatives: options.includeAlternatives ? "true" : "false",
    include_optional: options.includeOptional ? "true" : "false",
  });
  return `/api/races/${raceId}/exports/gps-gpx/preview?${params.toString()}`;
}

export function formatRaceDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) {
    return "Today";
  }
  if (diffDays === 1) {
    return "Yesterday";
  }
  if (diffDays < 7) {
    return `${diffDays} days ago`;
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export { DEFAULT_POI_PROFILE, mergePartialRoadbook };
export type { ProgressStepDefinition };
