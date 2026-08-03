import type {
  AnalysisPartialEvent,
  AnalysisPerformanceEvent,
  AnalysisStreamEvent,
  ProgressStepDefinition,
  ProgressStepEvent,
} from "./progress";

export interface PoiReviews {
  source: string | null;
  rating: number | null;
  review_count: number | null;
}

export interface PerformanceStageRow {
  stage_id: string;
  label: string;
  duration_s: number;
  percent: number;
}

export interface PerformanceSummaryRow {
  cache_mode: "cold" | "warm" | "hot";
  total_s: number;
  memory_peak_mb: number;
  target_cold_s: number;
  target_warm_s: number;
  meets_cold_target: boolean;
  meets_warm_target: boolean;
  surface_cache_hit: boolean;
  poi_cache_hit: boolean;
  processed_geometry_hit: boolean;
}

export interface PoiPlanningProfile {
  mini_supermarkets: boolean;
  small_supermarkets: boolean;
  convenience_stores: boolean;
  gas_stations: boolean;
  drinking_water: boolean;
  bakeries: boolean;
  restaurants: boolean;
  cafes: boolean;
  fast_food: boolean;
  atms: boolean;
  pharmacies: boolean;
  bike_shops: boolean;
  dining_fallback_km: number;
  dining_fallback_enabled: boolean;
}

export const DEFAULT_POI_PROFILE: PoiPlanningProfile = {
  mini_supermarkets: true,
  small_supermarkets: true,
  convenience_stores: true,
  gas_stations: true,
  drinking_water: true,
  bakeries: true,
  restaurants: false,
  cafes: false,
  fast_food: false,
  atms: false,
  pharmacies: false,
  bike_shops: false,
  dining_fallback_km: 30,
  dining_fallback_enabled: true,
};

export interface RouteSummary {
  route_name: string;
  distance_km: number;
  elevation_gain_m: number;
  climb_count: number;
  road_pct: number;
  gravel_pct: number;
  trail_pct: number;
  unknown_pct: number;
  /** @deprecated Use road_pct — kept for compatibility */
  asphalt_pct: number;
}

export interface ClimbRow {
  id: string;
  nickname: string | null;
  suggested_name: string | null;
  name_source: string | null;
  start_km: number;
  end_km: number;
  length_km: number;
  elevation_gain_m: number;
  avg_gradient_pct: number;
  max_50_m_pct: number | null;
  max_100_m_pct: number | null;
  max_250_m_pct: number | null;
  max_500_m_pct: number | null;
  max_1000_m_pct: number | null;
}

export interface ClimbCandidateRow {
  candidate_id: string;
  climb_id: string | null;
  start_km: number;
  end_km: number;
  length_km: number;
  elevation_gain_m: number;
  net_elevation_gain_m: number;
  avg_gradient_pct: number;
  max_gradient_pct: number | null;
  status: "accepted" | "rejected";
  rejection_reason: string | null;
  rejection_label: string | null;
}

export interface PoiRow {
  osm_id: number;
  osm_type: string;
  name: string | null;
  category: string;
  priority: number;
  lat: number;
  lon: number;
  distance_along_km: number;
  distance_off_route_m: number;
  detour_band_id: string;
  detour_label: string;
  detour_emoji: string;
  detour_tone: "good" | "caution" | "warning" | "bad";
  score: number;
  zone_id: number | null;
  night_usability: string;
  night_usability_label: string;
  water_fountain_type: string | null;
  water_fountain_type_label: string | null;
  tags: Record<string, string>;
  opening_hours: string | null;
  brand: string | null;
  phone: string | null;
  website: string | null;
  reviews: PoiReviews;
  fuel_shop_confidence?: string | null;
  fuel_shop_label?: string | null;
}

export interface ZonePoiOption {
  osm_id: number;
  osm_type: string;
  name: string | null;
  poi_category: string;
  distance_along_km: number;
  distance_off_route_m: number;
  accessibility_label: string;
  accessibility_emoji: string;
  accessibility_tone: "good" | "caution" | "warning" | "bad";
  score: number;
  brand: string | null;
  lat: number;
  lon: number;
  night_usability: string;
  night_usability_label: string;
  water_fountain_type: string | null;
  water_fountain_type_label: string | null;
  opening_hours: string | null;
  phone: string | null;
  website: string | null;
  tags: Record<string, string>;
  reviews: PoiReviews;
  fuel_shop_confidence?: string | null;
  fuel_shop_label?: string | null;
}

export interface ZoneCategoryGroup {
  key: "food" | "water" | "fuel" | "dining";
  label: string;
  primary: ZonePoiOption | null;
  alternatives: ZonePoiOption[];
}

export interface ResupplyZone {
  zone_id: number;
  name: string;
  lat: number;
  lon: number;
  distance_along_km: number;
  poi_count: number;
  accessibility_label: string;
  accessibility_emoji: string;
  accessibility_tone: "good" | "caution" | "warning" | "bad";
  categories: ZoneCategoryGroup[];
}

export interface SuggestedStop {
  zone_id: number;
  osm_id: number;
  osm_type: string;
  name: string | null;
  poi_category: string;
  category_key: string;
  category_label: string;
  distance_along_km: number;
  distance_off_route_m: number;
  lat: number;
  lon: number;
  score: number;
  reason: string | null;
}

export interface TrackPoint {
  lat: number;
  lon: number;
  km: number;
  ele_m: number | null;
  cumulative_gain_m: number;
}

export interface RouteBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface SurfaceSegment {
  start_km: number;
  end_km: number;
  surface: string;
  color: string;
  osm_surface: string | null;
  rider_category: string;
  rider_subcategory: string;
  surface_source: string;
  surface_confidence: number;
}

export interface SurfaceInsight {
  id: string;
  label: string;
  length_km: number;
  start_km: number;
  end_km: number;
  category: string;
  subcategory: string | null;
}

export interface SurfaceDiagnostics {
  total_points: number;
  unknown_by_cause: Record<string, number>;
  source_counts: Record<string, number>;
  category_km: Record<string, number>;
  top_unmapped_tags: Array<{ tag: string; point_count: number }>;
  runtime: {
    osm_load_s: number;
    json_parse_s: number;
    simplify_s: number;
    index_build_s: number;
    matching_s: number;
    inference_s: number;
    merge_s: number;
    total_s: number;
  };
  decimation_factor: number;
  osm_segment_count_raw: number;
  osm_segment_count_indexed: number;
  avg_candidates_per_point: number;
}

export interface ResupplyQualitySegment {
  start_km: number;
  end_km: number;
  quality: string;
  label: string;
  emoji: string;
  color: string;
  distance_to_next_zone_km: number | null;
}

export interface RouteVisualization {
  track_points: TrackPoint[];
  bounds: RouteBounds;
  surface_segments: SurfaceSegment[];
  resupply_segments: ResupplyQualitySegment[];
}

export interface PoiDebugRow {
  osm_id: number;
  osm_type: string;
  name: string | null;
  brand: string | null;
  category: string | null;
  lat: number | null;
  lon: number | null;
  status: "imported" | "discarded";
  discard_stage: string | null;
  discard_reason: string | null;
  distance_along_km: number | null;
  distance_off_route_m: number | null;
  score: number | null;
  zone_id: number | null;
  cluster_id: number | null;
  zone_role: string | null;
  primary_score?: number | null;
  fuel_score?: number | null;
  food_score?: number | null;
  water_score?: number | null;
  cluster_winner?: boolean | null;
  bundle_exported?: boolean | null;
}

export interface RoadbookResult {
  summary: RouteSummary;
  climbs: ClimbRow[];
  climb_candidates: ClimbCandidateRow[];
  pois: PoiRow[];
  resupply_zones: ResupplyZone[];
  suggested_stops?: SuggestedStop[];
  route: RouteVisualization;
  performance_report?: PerformanceStageRow[];
  performance_summary?: PerformanceSummaryRow | null;
  surface_insights?: SurfaceInsight[];
  surface_diagnostics?: SurfaceDiagnostics | null;
  poi_debug?: PoiDebugRow[];
}

export type AppTab =
  | "dashboard"
  | "route"
  | "verify"
  | "unsupported"
  | "climbs"
  | "surface"
  | "resupply"
  | "export"
  | "preview";

export interface ClimbDetectionConfig {
  smoothing_window_m: number;
  rolling_gradient_window_m: number;
  gradient_threshold_pct: number;
  meaningful_descent_threshold_m: number;
  min_elevation_gain_m: number;
  min_average_gradient_pct: number;
}

const DEFAULT_ANALYSIS_STEPS: ProgressStepDefinition[] = [
  { id: "reading_gpx", label: "Reading GPX" },
  { id: "calculating_distance", label: "Calculating distance" },
  { id: "osm_surface_data", label: "Downloading OSM data", active_label: "Downloading OSM data" },
  { id: "detecting_surfaces", label: "Detecting surfaces" },
  { id: "osm_poi_data", label: "Downloading POI data", active_label: "Downloading POI data" },
  { id: "finding_pois", label: "Finding POIs" },
  { id: "creating_resupply_zones", label: "Creating Resupply Zones" },
  { id: "detecting_climbs", label: "Detecting climbs" },
  { id: "calculating_gradients", label: "Calculating gradients" },
  { id: "calculating_resupply_quality", label: "Calculating Resupply Quality" },
  { id: "generating_route_visualization", label: "Generating Route Visualization" },
  { id: "preparing_dashboard", label: "Preparing Dashboard" },
  { id: "complete", label: "Complete" },
];

let cachedAnalysisSteps = DEFAULT_ANALYSIS_STEPS;

export function getAnalysisStepDefinitions(): ProgressStepDefinition[] {
  return cachedAnalysisSteps;
}

export async function checkHealth(): Promise<{ status: string; version: string }> {
  const response = await fetch("/api/health");
  if (!response.ok) {
    throw new Error("Backend unavailable");
  }
  return response.json();
}

export async function fetchAnalysisSteps(): Promise<ProgressStepDefinition[]> {
  const response = await fetch("/api/progress/steps");
  if (!response.ok) {
    return DEFAULT_ANALYSIS_STEPS;
  }

  const payload = await response.json();
  if (!Array.isArray(payload.steps) || payload.steps.length === 0) {
    return DEFAULT_ANALYSIS_STEPS;
  }

  cachedAnalysisSteps = payload.steps.map((step: ProgressStepDefinition) => ({
    id: step.id,
    label: step.label,
    active_label: step.active_label ?? undefined,
  }));
  return cachedAnalysisSteps;
}

export async function fetchPoiProfileDefault(): Promise<PoiPlanningProfile> {
  const response = await fetch("/api/poi/profile/default");
  if (!response.ok) {
    return DEFAULT_POI_PROFILE;
  }
  const payload = await response.json();
  return { ...DEFAULT_POI_PROFILE, ...(payload.profile ?? {}) };
}

function emptyRoadbook(): RoadbookResult {
  return {
    summary: {
      route_name: "",
      distance_km: 0,
      elevation_gain_m: 0,
      climb_count: 0,
      road_pct: 0,
      gravel_pct: 0,
      trail_pct: 0,
      unknown_pct: 0,
      asphalt_pct: 0,
    },
    climbs: [],
    climb_candidates: [],
    pois: [],
    resupply_zones: [],
    route: {
      track_points: [],
      bounds: { south: 0, west: 0, north: 0, east: 0 },
      surface_segments: [],
      resupply_segments: [],
    },
    performance_report: [],
  };
}

export function mergePartialRoadbook(
  current: RoadbookResult | null,
  slice: string,
  data: Record<string, unknown>,
): RoadbookResult {
  const base = current ?? emptyRoadbook();

  switch (slice) {
    case "bootstrap":
      return {
        ...base,
        summary: (data.summary as RouteSummary) ?? base.summary,
        route: (data.route as RouteVisualization) ?? base.route,
      };
    case "climbs":
      return {
        ...base,
        climbs: (data.climbs as ClimbRow[]) ?? base.climbs,
        climb_candidates: (data.climb_candidates as ClimbCandidateRow[]) ?? base.climb_candidates,
        summary: (data.summary as RouteSummary) ?? base.summary,
      };
    case "surface":
      return {
        ...base,
        summary: (data.summary as RouteSummary) ?? base.summary,
        route: (data.route as RouteVisualization) ?? base.route,
      };
    case "pois":
      return {
        ...base,
        pois: (data.pois as PoiRow[]) ?? base.pois,
      };
    case "zones":
      return {
        ...base,
        resupply_zones: (data.resupply_zones as ResupplyZone[]) ?? base.resupply_zones,
      };
    case "timeline":
      return {
        ...base,
        route: (data.route as RouteVisualization) ?? base.route,
      };
    default:
      return base;
  }
}

export async function generateRoadbook(
  file: File,
  poiProfile: PoiPlanningProfile = DEFAULT_POI_PROFILE,
): Promise<RoadbookResult> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("poi_profile", JSON.stringify(poiProfile));

  const response = await fetch("/api/generate", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Analysis failed." }));
    const detail = error.detail;
    const message = typeof detail === "string" ? detail : "Analysis failed.";
    throw new Error(message);
  }

  return response.json();
}

function parseStreamEvent(raw: string): AnalysisStreamEvent | null {
  try {
    return JSON.parse(raw) as AnalysisStreamEvent;
  } catch {
    return null;
  }
}

export async function generateRoadbookStream(
  file: File,
  onEvent: (event: AnalysisStreamEvent | unknown) => void,
  poiProfile: PoiPlanningProfile = DEFAULT_POI_PROFILE,
): Promise<RoadbookResult> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("poi_profile", JSON.stringify(poiProfile));

  const response = await fetch("/api/generate/stream", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Analysis failed." }));
    const detail = error.detail;
    const message = typeof detail === "string" ? detail : "Analysis failed.";
    throw new Error(message);
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

  return result;
}

export function isProgressStepEvent(event: AnalysisStreamEvent): event is ProgressStepEvent {
  return event.type === "step";
}

export function isPartialEvent(event: AnalysisStreamEvent): event is AnalysisPartialEvent {
  return event.type === "partial";
}

export function isPerformanceEvent(event: AnalysisStreamEvent): event is AnalysisPerformanceEvent {
  return event.type === "performance";
}

export async function saveClimbNicknames(nicknames: Record<string, string>): Promise<{ climbs: ClimbRow[] }> {
  const response = await fetch("/api/climbs/nicknames", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nicknames }),
  });
  if (!response.ok) {
    throw new Error("Failed to save climb nicknames.");
  }
  return response.json();
}

export async function recalculateClimbs(config: ClimbDetectionConfig): Promise<{
  climbs: ClimbRow[];
  climb_candidates: ClimbCandidateRow[];
  summary: { climb_count: number };
  config: ClimbDetectionConfig;
}> {
  const response = await fetch("/api/climbs/recalculate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Climb recalculation failed." }));
    const detail = error.detail;
    throw new Error(typeof detail === "string" ? detail : "Climb recalculation failed.");
  }

  return response.json();
}

export async function fetchClimbConfigDefaults(): Promise<ClimbDetectionConfig> {
  const response = await fetch("/api/climbs/config");
  if (!response.ok) {
    throw new Error("Failed to load climb defaults.");
  }
  const payload = await response.json();
  return payload.config;
}

export async function clearSession(): Promise<void> {
  await fetch("/api/session/clear", { method: "POST" });
}

export interface GpsGpxExportReport {
  export_version: string;
  device_profile: string;
  route_integrity_passed: boolean;
  track_point_count: number;
  distance_km: number;
  elevation_gain_m: number;
  elevation_descent_m: number;
  verified_poi_count: number;
  exported_poi_count: number;
  coros_icons_assigned: number | null;
  coros_icons_total: number | null;
  integrity_percent: number;
  waypoint_count: number;
  critical_count: number;
  recommended_count: number;
  optional_count: number;
}

export async function downloadExport(endpoint: string, filename: string): Promise<void> {
  const response = await fetch(endpoint);
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Export failed." }));
    const detail = error.detail;
    throw new Error(typeof detail === "string" ? detail : "Export failed.");
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export async function downloadGpsExport(
  endpoint: string,
  filename: string,
): Promise<GpsGpxExportReport | null> {
  const response = await fetch(endpoint);
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Export failed." }));
    const detail = error.detail;
    throw new Error(typeof detail === "string" ? detail : "Export failed.");
  }

  const summaryHeader = response.headers.get("X-Gps-Export-Summary");
  const report = summaryHeader ? (JSON.parse(summaryHeader) as GpsGpxExportReport) : null;

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  return report;
}
