// Mirrors the report JSON produced by the backend. Kept intentionally loose —
// the backend is the source of truth and the UI renders whatever it sends.

export interface RaceMeta {
  name: string;
  kind: "training" | "race";
  fileCount: number;
  sources: string[];
  startTime: string | null;
  endTime: string | null;
  sampleCount: number;
}

export interface Channel {
  avg: number | null;
  max: number | null;
  series: (number | null)[];
  np?: number | null;
  avgRiding?: number | null;
  variabilityIndex?: number | null;
}

export interface Overview {
  question: string;
  distanceKm: number;
  elevationGainM: number;
  elevationLossM: number;
  movingTimeS: number;
  elapsedTimeS: number;
  stoppedTimeS: number;
  movingPct: number;
  avgSpeedMovingKmh: number;
  avgSpeedElapsedKmh: number;
  hasHike: boolean;
  hikeDistanceKm: number;
  hikeTimeS: number;
  hikeGainM: number;
  pctClimbOnFoot: number;
  hasPower: boolean;
  npW: number | null;
  avgPowerW: number | null;
  variabilityIndex: number | null;
  caloriesKcal: number | null;
  avgTempC: number | null;
  maxTempC: number | null;
  weather: string | null;
  insight: string;
}

// ---- accounts ----
export interface SetupCheck {
  id: string;
  ok: boolean;
  label: string;
  detail?: string;
  fix?: string;
}

export interface SetupStatus {
  ready: boolean;
  readyForGoogle: boolean;
  readyForStrava: boolean;
  tunnelActive?: boolean;
  tunnelUrl?: string | null;
  backendUrl?: string;
  envPath: string;
  lanIp: string | null;
  desktopUrl: string;
  phoneUrl: string | null;
  origin: string;
  googleRedirectUri: string;
  stravaRedirectUri: string;
  register: {
    googleOrigins: string[];
    googleRedirectUris: string[];
    stravaCallbackDomain: string;
    stravaCallbackDomainDesktop: string;
    stravaFullRedirect: string;
  };
  checks: SetupCheck[];
  nextStep: string;
  missingCount: number;
}

export interface AuthConfig {
  googleEnabled: boolean;
  stravaEnabled: boolean;
  origin?: string;
  googleRedirectUri?: string;
  stravaRedirectUri?: string;
  setup?: SetupStatus;
}

export interface User {
  id: string;
  provider: "google" | "local" | null; // auth identity provider
  email: string | null;
  name: string | null;
  avatar: string | null;
  onboardedAt: number | null;
}

// A ride provider (where rides come from) — separate from auth.
export interface Provider {
  id: string;
  label: string;
  enabled: boolean;
  connected: boolean;
  lastSyncAt: number | null;
  athleteId: number | null;
}

// ---- ride library ----
export type RideStatus =
  | "draft"
  | "planning"
  | "ready"
  | "in_progress"
  | "completed"
  | "reviewed";

export type RideArea = "planning" | "completed";

export interface RideSummary {
  id: string;
  savedAt: number;
  source?: "upload" | "strava";
  analyzed?: boolean;
  /** Lifecycle state — Draft → … → Reviewed */
  status?: RideStatus;
  /** Home section this ride belongs to */
  area?: RideArea;
  name: string;
  kind: "training" | "race";
  date: string | null;
  distanceKm: number;
  elevationGainM: number;
  durationS: number;
  movingTimeS: number;
  rideType: string;
  hasPhotos?: boolean;
  photoUrl?: string | null;
  gear?: string | null;
  gearName?: string | null;
}

/** Named event in the trophy cabinet — may group many activities. */
export interface Ultra {
  id: string;
  createdAt: number;
  updatedAt: number;
  name: string;
  year: number | null;
  kind: string;
  status: RideStatus;
  area?: RideArea;
  activityIds: string[];
  country?: string | null;
  countryCode?: string | null;
  /** ISO 3166-1 alpha-2 codes for multi-country Ultras. */
  countryCodes?: string[];
  /** True when the rider overrode automatic country detection. */
  countriesManual?: boolean;
  /** Race result / placing — e.g. "14th", "Winner", "DNF". */
  result?: string | null;
  /** @deprecated use result */
  finishPlace?: string | null;
  finishPercentile?: number | null;
  rating?: number | null;
  coverUrl?: string | null;
  logoUrl?: string | null;
  distanceKm: number;
  elevationGainM: number;
  /** Ultra elapsed: first ride start → last ride end (includes overnight gaps). */
  durationS: number;
  /** Sum of each member ride's own elapsed time (excludes inter-day gaps). */
  rideElapsedTimeS?: number;
  /** Sum of member moving times when known. */
  movingTimeS?: number;
  /** Number of calendar riding days (same-day recordings count as one). */
  dayCount?: number;
  date?: string | null;
  /** Inclusive calendar range for the Ultra (YYYY-MM-DD). */
  dateStart?: string | null;
  dateEnd?: string | null;
  activityOrderManual?: boolean;
  experience?: Record<string, unknown>;
  strategies?: unknown[];
}

export interface UltraDay extends RideSummary {
  dayIndex: number;
  /** All Library recordings that make up this calendar day (usually one). */
  activityIds?: string[];
  recordingCount?: number;
  recordings?: {
    id: string;
    name: string;
    date: string | null;
    distanceKm: number;
    elevationGainM: number;
    durationS: number;
    movingTimeS: number;
  }[];
}

export interface UltraDetail {
  ultra: Ultra;
  days: UltraDay[];
  route: { points: number[][]; segments?: number[][][] };
  /** Library rides available to add (not claimed by other Ultras). */
  library: RideSummary[];
}

/** Software suggests related Library days — never auto-creates an Ultra. */
export interface UltraSuggestion {
  label: string;
  activityIds: string[];
  count: number;
  message: string;
}

export interface Cabinet {
  planningUltras: Ultra[];
  completedUltras: Ultra[];
  ungroupedRides: RideSummary[];
  /** Planned GPX routes — never Rides, never in Library. */
  plannedRoutes?: PlannedRouteSummary[];
  suggestions?: UltraSuggestion[];
}

/** Planned course GPX — planning object, not a completed activity. */
export interface PlannedRouteSummary {
  id: string;
  createdAt?: number;
  updatedAt?: number;
  name: string;
  sourceFilename?: string;
  distanceKm: number;
  elevationGainM: number;
  pointCount: number;
  hasTimestamps: boolean;
  status: "planning" | "ready" | "archived" | string;
  dateStart?: string | null;
  dateEnd?: string | null;
  verificationProgress?: { done: number; total: number };
  objectType: "route";
  hasAnalysis?: boolean;
}

export interface RoutePreparation {
  routeUnderstood: boolean;
  stopsVerified: boolean;
  keyClimbsReviewed: boolean;
  stagesPlanned: boolean;
  notes: string;
}

export interface PlannedRouteDetail extends PlannedRouteSummary {
  points: number[][];
  preparation: RoutePreparation;
  stopReviews?: Record<string, string>;
  /** Permanently saved verified stops (including area search finds). */
  savedStops?: Record<string, RecommendedStop | Record<string, unknown>>;
}

export interface RouteClimb {
  id: string;
  name: string | null;
  startKm: number;
  endKm: number;
  lengthKm: number;
  elevationGainM: number;
  avgGradientPct: number;
  maxGradientPct?: number | null;
  estimatedClimbTimeS?: number | null;
  hard?: boolean;
  difficultyScore?: number;
  difficultyLabel?: string;
  startLat?: number | null;
  startLon?: number | null;
  endLat?: number | null;
  endLon?: number | null;
}

export interface RoutePoi {
  osmId: number;
  osmType: string;
  name: string | null;
  category: string;
  group: string;
  lat: number;
  lon: number;
  distanceAlongKm: number;
  distanceOffRouteM: number;
  openingHours?: string | null;
  website?: string | null;
}

export interface RecommendedStop extends RoutePoi {
  id: string;
  qualityStars: number;
  qualityLabel: string;
  qualityScore?: number;
  /** 0–100 ultra resupply usefulness (sort key). */
  resupplyScore?: number;
  storeSize?: "small" | "large" | "unknown" | string;
  services?: string[];
  is24h?: boolean;
  priority?: boolean;
  reviewStatus: "verified" | "rejected" | "skipped" | "unreviewed" | string;
  distanceSincePreviousKm?: number;
  estimatedArrivalS?: number;
  googleMapsUrl?: string | null;
  streetViewUrl?: string | null;
}

export interface RouteRemoteGap {
  id: string;
  startKm: number;
  endKm: number;
  distanceKm: number;
  riskLevel: string;
  label: string;
  estimatedRideTimeS?: number;
  preparation?: string;
  midLat?: number | null;
  midLon?: number | null;
}

export interface RouteSleepPlan {
  stageIndex: number;
  stageLabel: string;
  targetKm: number;
  suggestion: RoutePoi | null;
  note: string;
}

export interface RouteStage {
  index: number;
  label: string;
  startKm: number;
  endKm: number;
  distanceKm: number;
  elevationGainM: number;
  reason: string;
}

export interface CriticalDecision {
  id: string;
  kind: string;
  priority?: number;
  title: string;
  detail: string;
  advice: string;
  km: number;
  lat?: number | null;
  lon?: number | null;
  relatedStopId?: string | null;
  relatedStop?: RecommendedStop | RoutePoi | null;
  relatedClimbId?: string | null;
  riskLevel?: string;
}

export interface RouteWeatherDay {
  date: string;
  weatherCode?: number | null;
  tempMaxC?: number | null;
  tempMinC?: number | null;
  precipMm?: number | null;
  windMaxKmh?: number | null;
  decisionReasons?: string[];
}

export interface RouteWeather {
  status: string;
  message?: string;
  sampleLat?: number;
  sampleLon?: number;
  sampleKm?: number;
  days: RouteWeatherDay[];
  decisionAlerts?: RouteWeatherDay[];
  hasDecisionWeather?: boolean;
}

export interface RouteAnalysis {
  routeId: string;
  status: string;
  computedAt?: number;
  durationS?: number;
  targetStageKm?: number;
  cache?: { poi?: string };
  poiError?: string | null;
  summary: {
    distanceKm: number;
    elevationGainM: number;
    climbCount: number;
    recommendedStopCount?: number;
    verifiedStopCount?: number;
    criticalDecisionCount?: number;
    remoteGapCount: number;
    longestRemoteGapKm: number | null;
    stageCount: number;
    hasElevation?: boolean;
  };
  insights: string[];
  emptyReasons?: {
    climbs?: string | null;
    stops?: string | null;
    decisions?: string | null;
    remote?: string | null;
  };
  profile: number[][];
  climbs: RouteClimb[];
  pois?: RoutePoi[];
  recommendedStops?: RecommendedStop[];
  sleep: RoutePoi[];
  sleepPlan?: RouteSleepPlan[];
  remoteGaps: RouteRemoteGap[];
  stages: RouteStage[];
  criticalDecisions?: CriticalDecision[];
  weather: RouteWeather | null;
  stopReviews?: Record<string, string>;
  elevationSource?: string;
}

export interface SyncResult {
  added: number;
  fetched: number;
  names?: string[];
  athlete?: {
    firstname?: string;
    lastname?: string;
    profile?: string;
  } | null;
}

// ---- curves ----
export interface CurvePoint {
  d: number; // seconds
  v: number;
}
export interface Curve {
  available: boolean;
  points: CurvePoint[];
}
export interface Temperature {
  available: boolean;
  avg?: number;
  max?: number;
  min?: number;
  series?: { km: number; v: number }[];
}
export interface Fatigue {
  available: boolean;
  metric?: string;
  unit?: string;
  series?: { h: number; v: number | null }[];
  insight?: string | null;
}
export interface Fade {
  available: boolean;
  firstHalf?: number;
  secondHalf?: number;
  pct?: number;
}
export interface HrDrift {
  available: boolean;
  pct?: number;
}
export interface Zone {
  name: string;
  range: string;
  seconds: number;
  pct: number;
}
export interface ZoneSet {
  available: boolean;
  basis?: string;
  ftpEst?: number;
  maxHrEst?: number;
  zones?: Zone[];
}
export interface Curves {
  question: string;
  available: boolean;
  durations?: number[];
  /** Best-average speed curves ignore windows shorter than this (default 5s). */
  speedMinDurationS?: number;
  power: Curve;
  np: Curve;
  speedMoving: Curve;
  speedElapsed: Curve;
  hr: Curve;
  cadence: Curve;
  elevationGain: Curve;
  temperature: Temperature;
  fatigue: Fatigue;
  fade: Fade;
  hrDrift: HrDrift;
  zones: { power: ZoneSet; hr: ZoneSet };
}

export interface Performance {
  question: string;
  axisKm: number[];
  power: Channel | null;
  hr: Channel | null;
  cadence: Channel | null;
  speed: Channel | null;
  elevation: Channel | null;
  insights: string[];
  hasPower: boolean;
  hasHr: boolean;
}

export interface Climb {
  index: number;
  startKm: number;
  endKm: number;
  lengthKm: number;
  gainM: number;
  avgGradient: number;
  maxGradient: number;
  timeS: number | null;
  vam: number | null;
  avgPower: number | null;
  avgHr: number | null;
  walkedKm: number;
  rideableKm: number;
  walkedPct: number;
  walkedTimeS: number;
  walkedGainM: number;
  hasHike: boolean;
  score: number;
  costRank: number;
}

export interface Stop {
  index: number;
  km: number;
  atElapsed: string;
  localHour: number;
  partOfDay: "day" | "night";
  durationS: number;
  durationLabel: string;
  category: string;
  confidence: number;
  hint: string;
  reasons: string[];
  efficiency: string | null;
  lat: number | null;
  lon: number | null;
}

export interface ResupplyLeg {
  fromIndex: number;
  toIndex: number;
  fromKm: number;
  toKm: number;
  distanceKm: number;
  gainM: number;
}

export interface ResupplyCadence {
  question: string;
  available?: boolean;
  resupplyCount: number;
  briefBreaksExcluded: number;
  thresholdMin: number;
  avgDistanceKm: number | null;
  avgGainM: number | null;
  longestKm?: number;
  shortestKm?: number;
  legs: ResupplyLeg[];
  insight: string;
}

export interface LedgerBucket {
  label: string;
  seconds: number;
  label_duration: string;
  pct: number;
  color: string;
}

export interface PacingThird {
  label: string;
  effort: number | null;
  avgSpeedKmh: number | null;
  avgHr: number | null;
}

export interface PacingFinding {
  type: string;
  severity: "low" | "medium" | "high";
  title: string;
  detail: string;
  recommendation: string;
}

export interface Report {
  race: RaceMeta;
  overview: Overview;
  performance: Performance;
  curves: Curves;
  climbs: {
    question: string;
    climbs: Climb[];
    count: number;
    pctClimbingOnFoot?: number;
    hikeGainM?: number;
    insight: string | null;
  };
  stops: {
    question: string;
    stops: Stop[];
    count: number;
    totalStoppedS: number;
    insight: string | null;
    cadence: ResupplyCadence;
  };
  timeLedger: {
    question: string;
    totalS: number;
    movingPct: number;
    buckets: LedgerBucket[];
    insight: string;
  };
  pacing: {
    question: string;
    available: boolean;
    metric?: string;
    thirds?: PacingThird[];
    decouplingPct?: number | null;
    findings: PacingFinding[];
    verdict: string;
  };
  summary: {
    question: string;
    headline: string;
    strengths: string[];
    weaknesses: string[];
    recommendations: string[];
    narrative: string[];
  };
}

/** Stitched Ultra expedition analytics — one activity, not N day reports. */
export interface UltraAggregation {
  distanceKm: number;
  elevationGainM: number;
  elevationLossM: number;
  totalAscentM: number;
  totalDescentM: number;
  /** Ultra elapsed: first ride start → last ride end (includes overnight). */
  elapsedTimeS: number;
  /** Sum of each day's ride elapsed (excludes inter-day gaps). */
  rideElapsedTimeS: number;
  /** Sum of moving times. */
  movingTimeS: number;
  stoppedTimeS: number;
  avgSpeedKmh: number;
  avgMovingSpeedKmh: number;
  avgGradientPct: number;
  maxElevationM: number | null;
  minElevationM: number | null;
  ridingDays: number;
  startDate: string | null;
  finishDate: string | null;
  validation: {
    ok: boolean;
    note: string;
    checks: {
      metric: string;
      stitched: number;
      sumOfDays: number;
      delta: number;
      tolerance: number;
      unit: string;
      ok: boolean;
    }[];
  };
}

export interface UltraDayHours {
  dayIndex: number;
  activityId: string;
  activityIds?: string[];
  recordingCount?: number;
  name: string;
  date: string | null;
  distanceKm: number;
  elevationGainM: number;
  movingTimeS: number;
  elapsedTimeS: number;
  stoppedTimeS: number;
}

export interface UltraAnalysis {
  ultraAnalysisSchema: number;
  analysisSchema: number;
  ultraId: string;
  status: "ready" | "ready_with_warnings" | "needs_data" | "empty";
  message: string | null;
  activityIds: string[];
  missingActivityIds?: string[];
  aggregation: UltraAggregation | null;
  dayHours: UltraDayHours[];
  availability: Record<string, boolean>;
  overview?: Overview;
  performance?: Performance;
  curves?: Curves;
  climbs?: Report["climbs"];
  stops?: Report["stops"];
  timeLedger?: Report["timeLedger"];
  pacing?: Report["pacing"];
  summary?: Report["summary"];
}
