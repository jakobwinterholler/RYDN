import { computeStopConfidence } from "./stopConfidence";
import type { CompanionBundle, CompanionStop, CompanionStopAlternative } from "../types/sync";
import {
  assignWaypointPriority,
  shouldExportPriority,
  type WaypointExportPriority,
} from "./corosWaypointPriority";
import {
  GPS_GPX_EXPORT_VERSION,
  isExcludedExportCategory,
  isInvalidExportName,
  MAX_WAYPOINT_OFF_ROUTE_M,
  formatCorosWaypointName,
  resolveCorosWptIcon,
  ROUTE_INTEGRITY_FAILED_MESSAGE,
} from "./gpsGpxExportConstants";

export type GpsGpxDeviceProfile = "original" | "coros" | "garmin" | "wahoo";

export const GPS_GPX_DEVICE_PROFILES: GpsGpxDeviceProfile[] = [
  "original",
  "coros",
  "garmin",
  "wahoo",
];

export interface GpsGpxExportOptions {
  deviceProfile: GpsGpxDeviceProfile;
  verifiedOnly: boolean;
  includeHighConfidence: boolean;
  includeAlternatives: boolean;
  /** When false (default), export Critical + Recommended waypoints only. */
  includeOptional: boolean;
}

export interface TrackFingerprint {
  trackPointCount: number;
  distanceKm: number;
  elevationGainM: number;
  elevationDescentM: number;
  geometryChecksum: string;
  trackBytesChecksum: string;
}

export interface GpsGpxExportReport {
  exportVersion: string;
  deviceProfile: GpsGpxDeviceProfile;
  routeIntegrityPassed: boolean;
  trackPointCount: number;
  distanceKm: number;
  elevationGainM: number;
  elevationDescentM: number;
  verifiedPoiCount: number;
  exportedPoiCount: number;
  corosIconsAssigned: number | null;
  corosIconsTotal: number | null;
  integrityPercent: number;
  waypointCount: number;
  criticalCount: number;
  recommendedCount: number;
  optionalCount: number;
}

export interface GpxExportPreviewWaypoint {
  name: string;
  km: number;
  priority: WaypointExportPriority;
  sym: string | null;
  category: string;
}

export interface GpxExportPreview {
  routeIntegrityPassed: boolean;
  trackPointCount: number;
  distanceKm: number;
  elevationGainM: number;
  elevationDescentM: number;
  verifiedPoiCount: number;
  waypointCount: number;
  criticalCount: number;
  recommendedCount: number;
  optionalCount: number;
  exportedCount: number;
  waypoints: GpxExportPreviewWaypoint[];
  validationErrors: string[];
}

export class GpxTrackModifiedError extends Error {
  constructor(message: string = ROUTE_INTEGRITY_FAILED_MESSAGE) {
    super(message);
    this.name = "GpxTrackModifiedError";
  }
}

export class GpxExportQualityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GpxExportQualityError";
  }
}

interface GpsWaypoint {
  lat: number;
  lon: number;
  ele: number | null;
  name: string;
  desc: string;
  category: string;
  km: number;
  isPrimary: boolean;
  osmKey: string;
  sym: string | null;
  verificationStatus: string;
  offRouteM: number | null;
  priority: WaypointExportPriority;
}

const EARTH_RADIUS_M = 6_371_000;

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const lat1R = (lat1 * Math.PI) / 180;
  const lon1R = (lon1 * Math.PI) / 180;
  const lat2R = (lat2 * Math.PI) / 180;
  const lon2R = (lon2 * Math.PI) / 180;
  const dLat = lat2R - lat1R;
  const dLon = lon2R - lon1R;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1R) * Math.cos(lat2R) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function sha256Hex(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function decodeGpx(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return new TextDecoder("utf-8").decode(view);
}

function extractTrackBytes(gpxText: string): string {
  const matches = [...gpxText.matchAll(/<trk\b[^>]*>[\s\S]*?<\/trk>/gi)];
  if (matches.length === 0) {
    throw new Error("No <trk> sections found in GPX.");
  }
  return matches.map((match) => match[0]).join("");
}

function parseTrackPoints(gpxText: string): Array<{ lat: number; lon: number; ele: number | null }> {
  const points: Array<{ lat: number; lon: number; ele: number | null }> = [];
  const pattern =
    /<trkpt\s+lat="([^"]+)"\s+lon="([^"]+)"[^>]*>([\s\S]*?)<\/trkpt>/gi;
  for (const match of gpxText.matchAll(pattern)) {
    const lat = Number(match[1]);
    const lon = Number(match[2]);
    const body = match[3] ?? "";
    const eleMatch = body.match(/<ele[^>]*>([^<]+)<\/ele>/i);
    const ele = eleMatch ? Number(eleMatch[1]) : null;
    points.push({
      lat,
      lon,
      ele: ele == null || Number.isNaN(ele) ? null : ele,
    });
  }
  if (points.length === 0) {
    throw new Error("No track points found in GPX.");
  }
  return points;
}

function computeElevationDescentM(
  points: Array<{ lat: number; lon: number; ele: number | null }>,
): number {
  let descent = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (previous.ele == null || current.ele == null) {
      continue;
    }
    const diff = previous.ele - current.ele;
    if (diff > 0) {
      descent += diff;
    }
  }
  return descent;
}

export function fingerprintGpxBytes(bytes: ArrayBuffer | Uint8Array): TrackFingerprint {
  const gpxText = decodeGpx(bytes);
  const points = parseTrackPoints(gpxText);
  let distanceKm = 0;
  let elevationGainM = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    distanceKm += haversineM(previous.lat, previous.lon, current.lat, current.lon) / 1000;
    if (previous.ele != null && current.ele != null && current.ele > previous.ele) {
      elevationGainM += current.ele - previous.ele;
    }
  }
  const geometryParts = points.map(
    (point) => `${point.lat},${point.lon},${point.ele ?? ""}`,
  );
  const trackBytes = extractTrackBytes(gpxText);
  return {
    trackPointCount: points.length,
    distanceKm,
    elevationGainM,
    elevationDescentM: computeElevationDescentM(points),
    geometryChecksum: sha256Hex(geometryParts.join("|")),
    trackBytesChecksum: sha256Hex(trackBytes),
  };
}

function validateTrackUnchanged(before: TrackFingerprint, after: TrackFingerprint): void {
  const unchanged =
    before.trackPointCount === after.trackPointCount &&
    before.distanceKm === after.distanceKm &&
    before.elevationGainM === after.elevationGainM &&
    before.elevationDescentM === after.elevationDescentM &&
    before.geometryChecksum === after.geometryChecksum &&
    before.trackBytesChecksum === after.trackBytesChecksum;
  if (!unchanged) {
    throw new GpxTrackModifiedError();
  }
}

function formatKmLabel(km: number): string {
  return `KM${Math.round(km)}`;
}

function serviceLabels(stop: CompanionStop): string {
  const services: string[] = [];
  if (stop.hasFuel) {
    services.push("Fuel");
  }
  if (stop.hasWater) {
    services.push("Water");
  }
  if (stop.hasFood) {
    services.push("Food");
  }
  if (stop.hasCoffee) {
    services.push("Coffee");
  }
  return services.length > 0 ? services.join(", ") : stop.categoryLabel;
}

function waypointName(
  stop: Pick<
    CompanionStop,
    | "name"
    | "category"
    | "categoryLabel"
    | "hasFuel"
    | "hasWater"
    | "hasFood"
    | "hasCoffee"
    | "resupplyReason"
  >,
  km: number,
  deviceProfile: GpsGpxDeviceProfile,
  isPrimary: boolean,
): string {
  if (deviceProfile === "coros") {
    return formatCorosWaypointName({
      name: stop.name,
      brand: stop.name,
      category: stop.category,
      hasFuel: stop.hasFuel,
      hasWater: stop.hasWater,
      hasFood: stop.hasFood,
      resupplyReason: stop.resupplyReason,
      isPrimary,
    });
  }
  const kmLabel = formatKmLabel(km);
  const base = isPrimary ? stop.name : `ALT ${stop.name}`;
  return `${base} ${kmLabel}`.slice(0, 64);
}

function waypointDesc(
  stop: CompanionStop,
  km: number,
  isPrimary: boolean,
  sym: string | null,
): string {
  const confidence = computeStopConfidence({
    verificationStatus: stop.verificationStatus,
    verifiedAt: stop.verificationDate,
    poiScore: stop.confidenceScore,
    openingHours: stop.openingHours,
    website: stop.website,
    phone: stop.phone,
  });
  const lines = [
    `Type: ${stop.categoryLabel}`,
    `Services: ${serviceLabels(stop)}`,
    `Route km: ${km.toFixed(2)}`,
    `Opening hours: ${stop.openingHours ?? "Unknown"}`,
    `Confidence: ${confidence.label} (${confidence.score})`,
    `Role: ${isPrimary ? "Primary" : "Alternative"}`,
    `Verification: ${stop.verificationStatus}`,
  ];
  if (sym) {
    lines.push(`Coros icon: ${sym}`);
  }
  return lines.join("\n");
}

function isResupplyStop(stop: Pick<CompanionStop, "category">): boolean {
  return !isExcludedExportCategory(stop.category);
}

function shouldExportStop(stop: CompanionStop, options: GpsGpxExportOptions): boolean {
  if (!isResupplyStop(stop)) {
    return false;
  }
  if (options.deviceProfile === "coros") {
    return stop.verificationStatus === "verified";
  }
  if (stop.verificationStatus === "verified") {
    return true;
  }
  if (options.includeHighConfidence) {
    const confidence = computeStopConfidence({
      verificationStatus: stop.verificationStatus,
      verifiedAt: stop.verificationDate,
      poiScore: stop.confidenceScore,
      openingHours: stop.openingHours,
      website: stop.website,
      phone: stop.phone,
    });
    return confidence.level === "high";
  }
  if (!options.verifiedOnly) {
    return true;
  }
  return false;
}

function stopPriority(stop: CompanionStop): WaypointExportPriority {
  return assignWaypointPriority({
    resupplyReason: stop.resupplyReason,
    hasFuel: stop.hasFuel,
    hasWater: stop.hasWater,
    hasFood: stop.hasFood,
    confidenceScore: stop.confidenceScore,
    verificationStatus: stop.verificationStatus,
  });
}

function countVerifiedStops(bundle: CompanionBundle): number {
  return bundle.stops.filter((stop) => stop.verificationStatus === "verified").length;
}

function alternativeToWaypointSource(
  anchor: CompanionStop,
  alternative: CompanionStopAlternative,
): Pick<
  CompanionStop,
  | "name"
  | "category"
  | "categoryLabel"
  | "hasFuel"
  | "hasWater"
  | "hasFood"
  | "hasCoffee"
  | "openingHours"
  | "confidenceScore"
  | "verificationStatus"
  | "verificationDate"
  | "website"
  | "phone"
> {
  return {
    name: alternative.name,
    category: alternative.category,
    categoryLabel: alternative.categoryLabel,
    hasFuel: anchor.hasFuel,
    hasWater: anchor.hasWater,
    hasFood: anchor.hasFood,
    hasCoffee: anchor.hasCoffee,
    openingHours: alternative.openingHours,
    confidenceScore: alternative.score,
    verificationStatus: alternative.verificationStatus,
    verificationDate: null,
    website: alternative.website ?? null,
    phone: alternative.phone ?? null,
  };
}

function collectWaypoints(bundle: CompanionBundle, options: GpsGpxExportOptions): GpsWaypoint[] {
  const waypoints: GpsWaypoint[] = [];
  const seenOsm = new Set<string>();
  const seenZonePrimary = new Set<string>();

  const stops = [...bundle.stops].sort((left, right) => left.km - right.km);
  for (const stop of stops) {
    if (!shouldExportStop(stop, options)) {
      continue;
    }

    const primaryKey =
      stop.osmType && stop.osmId != null ? `${stop.osmType}-${stop.osmId}` : `zone-${stop.zoneId}`;
    if (!seenZonePrimary.has(String(stop.zoneId))) {
      seenZonePrimary.add(String(stop.zoneId));
      if (!seenOsm.has(primaryKey)) {
        seenOsm.add(primaryKey);
        const sym =
          options.deviceProfile === "coros"
            ? resolveCorosWptIcon({
                category: stop.category,
                hasFuel: stop.hasFuel,
                hasWater: stop.hasWater,
                hasFood: stop.hasFood,
              })
            : null;
        waypoints.push({
          lat: stop.lat,
          lon: stop.lon,
          ele: null,
          name: waypointName(stop, stop.km, options.deviceProfile, true),
          desc: waypointDesc(stop, stop.km, true, sym),
          category: stop.category,
          km: stop.km,
          isPrimary: true,
          osmKey: primaryKey,
          sym,
          verificationStatus: stop.verificationStatus,
          offRouteM: stop.distanceOffRouteM ?? null,
          priority: stopPriority(stop),
        });
      }
    }

    if (!options.includeAlternatives) {
      continue;
    }

    for (const alternative of stop.alternatives ?? []) {
      const altKey = `${alternative.osmType}-${alternative.osmId}`;
      if (seenOsm.has(altKey)) {
        continue;
      }
      seenOsm.add(altKey);
      const source = alternativeToWaypointSource(stop, alternative);
      const km = alternative.distanceAlongKm ?? stop.km;
      const mergedStop = {
        ...stop,
        ...source,
        lat: alternative.lat,
        lon: alternative.lon,
        km,
      };
      const sym =
        options.deviceProfile === "coros"
          ? resolveCorosWptIcon({
              category: alternative.category,
              hasFuel: stop.hasFuel,
              hasWater: stop.hasWater,
              hasFood: stop.hasFood,
            })
          : null;
      waypoints.push({
        lat: alternative.lat,
        lon: alternative.lon,
        ele: null,
        name: waypointName(source, km, options.deviceProfile, false),
        desc: waypointDesc(mergedStop, km, false, sym),
        category: alternative.category,
        km,
        isPrimary: false,
        osmKey: altKey,
        sym,
        verificationStatus: source.verificationStatus,
        offRouteM: alternative.distanceOffRouteM ?? stop.distanceOffRouteM ?? null,
        priority: assignWaypointPriority({
          resupplyReason: stop.resupplyReason,
          hasFuel: stop.hasFuel,
          hasWater: stop.hasWater,
          hasFood: stop.hasFood,
          confidenceScore: source.confidenceScore,
          verificationStatus: source.verificationStatus,
        }),
      });
    }
  }

  waypoints.sort((left, right) => left.km - right.km || Number(right.isPrimary) - Number(left.isPrimary));
  return waypoints.filter((waypoint) => shouldExportPriority(waypoint.priority, options.includeOptional));
}

function countPriorityBreakdown(waypoints: GpsWaypoint[]): {
  criticalCount: number;
  recommendedCount: number;
  optionalCount: number;
} {
  let criticalCount = 0;
  let recommendedCount = 0;
  let optionalCount = 0;
  for (const waypoint of waypoints) {
    if (waypoint.priority === "critical") {
      criticalCount += 1;
    } else if (waypoint.priority === "recommended") {
      recommendedCount += 1;
    } else {
      optionalCount += 1;
    }
  }
  return { criticalCount, recommendedCount, optionalCount };
}

function collectAllCandidateWaypoints(
  bundle: CompanionBundle,
  options: GpsGpxExportOptions,
): GpsWaypoint[] {
  const withOptional: GpsGpxExportOptions = { ...options, includeOptional: true };
  return collectWaypoints(bundle, withOptional);
}

function tryValidateExportQuality(
  waypoints: GpsWaypoint[],
  options: GpsGpxExportOptions,
  verifiedPoiCount: number,
): string[] {
  try {
    validateExportQuality(waypoints, options, verifiedPoiCount);
    return [];
  } catch (error) {
    if (error instanceof GpxExportQualityError) {
      return [error.message];
    }
    return [error instanceof Error ? error.message : "Export validation failed."];
  }
}
function validateExportQuality(
  waypoints: GpsWaypoint[],
  options: GpsGpxExportOptions,
  verifiedPoiCount: number,
): void {
  const failures: string[] = [];
  const seen = new Set<string>();

  for (const waypoint of waypoints) {
    if (waypoint.verificationStatus !== "verified") {
      failures.push(`Waypoint '${waypoint.name}' is not verified.`);
    }
    if (isExcludedExportCategory(waypoint.category)) {
      failures.push(`Unsupported marker category: ${waypoint.category}.`);
    }
    if (isInvalidExportName(waypoint.name.replace(/^ALT\s+/, ""))) {
      failures.push(`Invalid waypoint name: ${waypoint.name}.`);
    }
    if (options.deviceProfile === "coros" && !waypoint.sym) {
      failures.push(`Missing Coros icon for '${waypoint.name}'.`);
    }
    if (waypoint.offRouteM != null && waypoint.offRouteM > MAX_WAYPOINT_OFF_ROUTE_M) {
      failures.push(`Waypoint '${waypoint.name}' is too far from route (${waypoint.offRouteM} m).`);
    }
    const dedupeKey = `${waypoint.name}:${waypoint.lat.toFixed(5)}:${waypoint.lon.toFixed(5)}`;
    if (seen.has(dedupeKey)) {
      failures.push(`Duplicate waypoint: ${waypoint.name}.`);
    }
    seen.add(dedupeKey);
  }

  if (verifiedPoiCount < waypoints.length) {
    failures.push("Exported POI count exceeds verified POI count.");
  }

  if (failures.length > 0) {
    throw new GpxExportQualityError(failures.join(" "));
  }
}

function renderWaypointsXml(waypoints: GpsWaypoint[], deviceProfile: GpsGpxDeviceProfile): string {
  if (waypoints.length === 0) {
    return "";
  }
  const chunks = [`\n  <!-- Ultra Roadbook navigation waypoints v${GPS_GPX_EXPORT_VERSION} -->\n`];
  for (const waypoint of waypoints) {
    const lat = waypoint.lat.toFixed(8).replace(/\.?0+$/, "");
    const lon = waypoint.lon.toFixed(8).replace(/\.?0+$/, "");
    chunks.push(`  <wpt lat="${lat}" lon="${lon}">\n`);
    if (waypoint.ele != null) {
      chunks.push(`    <ele>${waypoint.ele}</ele>\n`);
    }
    chunks.push(`    <name>${escapeXml(waypoint.name)}</name>\n`);
    chunks.push(`    <desc>${escapeXml(waypoint.desc)}</desc>\n`);
    if (deviceProfile === "coros" && waypoint.sym) {
      chunks.push(`    <sym>${escapeXml(waypoint.sym)}</sym>\n`);
      chunks.push(`    <type>${escapeXml(waypoint.sym)}</type>\n`);
    } else {
      chunks.push(`    <type>${escapeXml(waypoint.category)}</type>\n`);
    }
    chunks.push("  </wpt>\n");
  }
  return chunks.join("");
}

function insertWaypoints(original: Uint8Array, waypointXml: string): Uint8Array {
  if (!waypointXml) {
    return original;
  }
  const text = decodeGpx(original);
  const closingMatch = text.match(/<\/gpx\s*>/i);
  if (!closingMatch || closingMatch.index == null) {
    throw new Error("Invalid GPX: missing </gpx> closing tag.");
  }
  const merged = `${text.slice(0, closingMatch.index)}${waypointXml}${text.slice(closingMatch.index)}`;
  return new TextEncoder().encode(merged);
}

function buildExportReport(
  before: TrackFingerprint,
  waypoints: GpsWaypoint[],
  verifiedPoiCount: number,
  deviceProfile: GpsGpxDeviceProfile,
): GpsGpxExportReport {
  const exportedCount = waypoints.length;
  const corosIconsAssigned = waypoints.filter((waypoint) => waypoint.sym).length;
  const { criticalCount, recommendedCount, optionalCount } = countPriorityBreakdown(waypoints);
  return {
    exportVersion: GPS_GPX_EXPORT_VERSION,
    deviceProfile,
    routeIntegrityPassed: true,
    trackPointCount: before.trackPointCount,
    distanceKm: Math.round(before.distanceKm * 100) / 100,
    elevationGainM: Math.round(before.elevationGainM),
    elevationDescentM: Math.round(before.elevationDescentM),
    verifiedPoiCount,
    exportedPoiCount: exportedCount,
    corosIconsAssigned: deviceProfile === "coros" ? corosIconsAssigned : null,
    corosIconsTotal: deviceProfile === "coros" ? exportedCount : null,
    integrityPercent: 100,
    waypointCount: exportedCount,
    criticalCount,
    recommendedCount,
    optionalCount,
  };
}

const DEFAULT_OPTIONS: GpsGpxExportOptions = {
  deviceProfile: "coros",
  verifiedOnly: true,
  includeHighConfidence: false,
  includeAlternatives: false,
  includeOptional: false,
};

export function buildGpxExportPreview(
  originalGpx: ArrayBuffer | Uint8Array,
  bundle: CompanionBundle,
  options: Partial<GpsGpxExportOptions> = {},
): GpxExportPreview {
  const resolved: GpsGpxExportOptions = { ...DEFAULT_OPTIONS, ...options };
  const originalBytes =
    originalGpx instanceof Uint8Array ? originalGpx : new Uint8Array(originalGpx);

  let before: TrackFingerprint;
  let routeIntegrityPassed = true;
  const validationErrors: string[] = [];

  try {
    before = fingerprintGpxBytes(originalBytes);
  } catch (error) {
    routeIntegrityPassed = false;
    validationErrors.push(error instanceof Error ? error.message : "GPX fingerprint failed.");
    return {
      routeIntegrityPassed: false,
      trackPointCount: 0,
      distanceKm: 0,
      elevationGainM: 0,
      elevationDescentM: 0,
      verifiedPoiCount: 0,
      waypointCount: 0,
      criticalCount: 0,
      recommendedCount: 0,
      optionalCount: 0,
      exportedCount: 0,
      waypoints: [],
      validationErrors,
    };
  }

  const verifiedPoiCount = countVerifiedStops(bundle);
  const allWaypoints = collectAllCandidateWaypoints(bundle, resolved);
  const waypoints = collectWaypoints(bundle, resolved);
  const { criticalCount, recommendedCount, optionalCount } = countPriorityBreakdown(allWaypoints);

  validationErrors.push(...tryValidateExportQuality(waypoints, resolved, verifiedPoiCount));

  try {
    const outputBytes = insertWaypoints(
      originalBytes,
      renderWaypointsXml(waypoints, resolved.deviceProfile),
    );
    const after = fingerprintGpxBytes(outputBytes);
    validateTrackUnchanged(before, after);
  } catch (error) {
    routeIntegrityPassed = false;
    if (error instanceof GpxTrackModifiedError) {
      validationErrors.push(ROUTE_INTEGRITY_FAILED_MESSAGE);
    } else {
      validationErrors.push(error instanceof Error ? error.message : "Integrity check failed.");
    }
  }

  return {
    routeIntegrityPassed: routeIntegrityPassed && validationErrors.length === 0,
    trackPointCount: before.trackPointCount,
    distanceKm: Math.round(before.distanceKm * 100) / 100,
    elevationGainM: Math.round(before.elevationGainM),
    elevationDescentM: Math.round(before.elevationDescentM),
    verifiedPoiCount,
    waypointCount: allWaypoints.length,
    criticalCount,
    recommendedCount,
    optionalCount,
    exportedCount: waypoints.length,
    waypoints: waypoints.map((waypoint) => ({
      name: waypoint.name,
      km: waypoint.km,
      priority: waypoint.priority,
      sym: waypoint.sym,
      category: waypoint.category,
    })),
    validationErrors,
  };
}

export function exportGpxForGps(
  originalGpx: ArrayBuffer | Uint8Array,
  bundle: CompanionBundle,
  options: Partial<GpsGpxExportOptions> = {},
): { bytes: Uint8Array; report: GpsGpxExportReport } {
  const resolved: GpsGpxExportOptions = { ...DEFAULT_OPTIONS, ...options };
  if (!GPS_GPX_DEVICE_PROFILES.includes(resolved.deviceProfile)) {
    throw new Error(`Unsupported device profile: ${resolved.deviceProfile}`);
  }

  const originalBytes =
    originalGpx instanceof Uint8Array ? originalGpx : new Uint8Array(originalGpx);
  const before = fingerprintGpxBytes(originalBytes);
  const verifiedPoiCount = countVerifiedStops(bundle);
  const waypoints = collectWaypoints(bundle, resolved);
  validateExportQuality(waypoints, resolved, verifiedPoiCount);
  const outputBytes = insertWaypoints(originalBytes, renderWaypointsXml(waypoints, resolved.deviceProfile));
  const after = fingerprintGpxBytes(outputBytes);
  validateTrackUnchanged(before, after);

  return {
    bytes: outputBytes,
    report: buildExportReport(before, waypoints, verifiedPoiCount, resolved.deviceProfile),
  };
}

export { GPS_GPX_EXPORT_VERSION, ROUTE_INTEGRITY_FAILED_MESSAGE };
