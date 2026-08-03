export interface SyncRaceSummary {
  id: string;
  name: string;
  distance_km: number | null;
  elevation_gain_m: number | null;
  /** Monotonic cloud revision; bumps on each bundle upload. */
  companion_revision: number;
  /** Alias for companion_revision in API responses. */
  version?: number;
  /** Alias for companion_revision — embedded bundle revision. */
  bundle_version?: number;
  /** SHA-256 checksum of canonical bundle content. */
  bundle_checksum?: string | null;
  /** Schema version of the cloud bundle. */
  bundle_schema_version?: number | null;
  /** Significant climbs in the latest cloud analysis/bundle. */
  significant_climb_count?: number | null;
  /** GPX content fingerprint for deduplicating cloud rows. */
  gpx_fingerprint?: string | null;
  updated_at: string | null;
  analyzed_at: string | null;
  has_bundle: boolean;
  readiness_score?: number | null;
}

export interface SyncPushRaceResult {
  race_id: string;
  name?: string;
  companion_revision: number;
  has_bundle: boolean;
  synced_at: string;
}

export interface SyncPushAllResult {
  uploaded: SyncPushRaceResult[];
  failed: Array<{ race_id: string; name?: string; error: string }>;
  skipped?: Array<{ race_id: string; name?: string; reason: string }>;
}

export interface AuthProfile {
  id: string;
  email: string | null;
}

export interface CompanionStopAlternative {
  /** Permanent POI identity. */
  poiId?: string;
  osmId: number;
  osmType: string;
  name: string;
  category: string;
  categoryLabel: string;
  icon: string;
  distanceOffRouteM: number;
  distanceAlongKm: number;
  score: number;
  confidenceScore?: number | null;
  verificationStatus: "verified" | "unverified" | "needs_review" | "pending";
  openingHours: string | null;
  lat: number;
  lon: number;
  phone?: string | null;
  website?: string | null;
  placeId?: string | null;
  hasFood?: boolean;
  hasWater?: boolean;
  hasFuel?: boolean;
}

export interface CompanionStop {
  zoneId: number;
  /** Permanent POI identity — stable across re-analysis. */
  poiId?: string;
  /** Primary POI identity when available. */
  osmId?: number;
  osmType?: string;
  km: number;
  lat: number;
  lon: number;
  name: string;
  category: string;
  categoryLabel: string;
  icon: string;
  distanceOffRouteM?: number;
  verificationStatus: "verified" | "unverified" | "needs_review" | "pending";
  openingHours: string | null;
  notes: string | null;
  phone?: string | null;
  website?: string | null;
  /** Google Place ID for precise Maps / Street View links when available. */
  placeId?: string | null;
  hasFood?: boolean;
  hasWater?: boolean;
  hasFuel?: boolean;
  hasCoffee?: boolean;
  confidenceScore?: number | null;
  verificationDate?: string | null;
  /** Ranked POI alternatives within the same resupply area. */
  alternatives?: CompanionStopAlternative[];
  /** Alias for alternatives — embedded nearby options for this stop. */
  nearbyAlternatives?: CompanionStopAlternative[];
  /** Rider-oriented reasoning for this stop choice. */
  resupplyReason?: string | null;
}

export interface CompanionClimb {
  id: string;
  name: string;
  startKm: number;
  endKm: number;
  lengthKm: number;
  elevationGainM: number;
  avgGradientPct: number;
  max50mPct?: number | null;
  max100mPct?: number | null;
  max250mPct?: number | null;
  max500mPct?: number | null;
  max1000mPct?: number | null;
}

export interface CompanionUnsupportedSection {
  id: string;
  startKm: number;
  endKm: number;
  distanceKm: number;
  displayLabel: string;
  riskLevel: string;
  elevationGainM?: number;
  estimatedRidingHours?: number;
  waterNeededMl?: number;
  carbsNeededG?: number;
  riskBand?: "Low" | "Medium" | "High";
}

/** Compact POI row for bounds-based resupply discovery on Companion. */
export interface CompanionDiscoverPoi {
  osmId: number;
  osmType: string;
  name: string | null;
  category: string;
  priority: number;
  lat: number;
  lon: number;
  distanceAlongKm: number;
  distanceOffRouteM: number;
  score: number;
  zoneId: number | null;
  openingHours?: string | null;
  brand?: string | null;
  tags?: Record<string, string> | null;
}

export interface CompanionDashboardStats {
  verifiedStops: number;
  unverifiedStops: number;
  remainingStops: number;
  remainingUnsupportedKm: number;
  readinessScore: number;
  readinessReasons: Array<{ kind: "pass" | "warn"; text: string }>;
}

export interface CompanionBundle {
  /** Semantic bundle format version, e.g. "1.0.0". */
  bundleVersion?: string;
  schemaVersion: number;
  /** Minimum Companion app version that can read this bundle. */
  minimumCompanionVersion?: string;
  /** Minimum Desktop app version that produced this bundle. */
  minimumDesktopVersion?: string;
  revision?: number;
  /** Alias for revision. */
  bundle_version?: number;
  /** SHA-256 checksum of canonical bundle content. */
  bundleChecksum?: string;
  /** UTC ISO timestamp when bundle was generated. */
  generatedAt?: string;
  syncedAt?: string;
  exportedAt: string;
  race: {
    id: string;
    name: string;
    distanceKm: number;
    elevationGainM: number;
    analyzedAt?: string | null;
  };
  route: {
    coordinates: [number, number][];
    /** Parallel elevation samples (m) for each coordinate when available. */
    elevationsM?: number[];
    bounds: {
      south: number;
      west: number;
      north: number;
      east: number;
    };
  };
  stops: CompanionStop[];
  /** Full discoverable POI set from desktop analysis (optional; falls back to stop alternatives). */
  discoverPois?: CompanionDiscoverPoi[];
  climbs?: CompanionClimb[];
  unsupportedSections: CompanionUnsupportedSection[];
  dashboardStats?: CompanionDashboardStats;
  riderAssumptions?: {
    ridingSpeedKmh: number;
    climbingPenaltyMinPer100m: number;
    waterMlPerHour: number;
    carbsGPerHour: number;
    maxGapWithoutResupplyKm: number;
  };
}

export function isCompanionBundle(value: unknown): value is CompanionBundle {
  if (!value || typeof value !== "object") {
    return false;
  }
  const bundle = value as CompanionBundle;
  return (
    typeof bundle.schemaVersion === "number" &&
    !!bundle.race?.name &&
    Array.isArray(bundle.stops) &&
    Array.isArray(bundle.route?.coordinates) &&
    typeof bundle.bundleChecksum === "string" &&
    bundle.bundleChecksum.length > 0
  );
}
