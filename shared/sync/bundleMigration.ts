import type { CompanionBundle, CompanionStop } from "../types/sync";
import { computePoiId } from "../race/poiId";
import { computeBundleChecksumSync } from "./bundleChecksum";
import {
  applyBundleVersionFields,
  CURRENT_SCHEMA_VERSION,
} from "./bundleContract";
import { diagnoseCompanionBundle, validateCompanionBundle } from "./bundleValidation";

export interface BundlePrepareResult {
  bundle: CompanionBundle | null;
  errors: string[];
  migrated: boolean;
  migrationNotes: string[];
  diagnostics: string[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  const record = asRecord(value);
  if (!record) {
    return value;
  }
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    sorted[key] = sortKeysDeep(record[key]);
  }
  return sorted;
}

function cloneRawBundle(raw: unknown): Record<string, unknown> {
  return sortKeysDeep(raw) as Record<string, unknown>;
}

function normalizeRaceMetadata(record: Record<string, unknown>, notes: string[]): string | null {
  const raceRaw = asRecord(record.race);
  if (!raceRaw) {
    return null;
  }
  if (raceRaw.distanceKm == null && raceRaw.distance_km != null) {
    raceRaw.distanceKm = raceRaw.distance_km;
    notes.push("Migrated race.distance_km → distanceKm");
  }
  if (raceRaw.elevationGainM == null && raceRaw.elevation_gain_m != null) {
    raceRaw.elevationGainM = raceRaw.elevation_gain_m;
    notes.push("Migrated race.elevation_gain_m → elevationGainM");
  }
  if (raceRaw.analyzedAt == null && raceRaw.analyzed_at != null) {
    raceRaw.analyzedAt = raceRaw.analyzed_at;
    notes.push("Migrated race.analyzed_at → analyzedAt");
  }
  record.race = raceRaw;
  return typeof raceRaw.id === "string" ? raceRaw.id : null;
}

function normalizeStop(stopRaw: Record<string, unknown>, raceId: string, notes: string[]): void {
  if (stopRaw.km == null && stopRaw.distance_km != null) {
    stopRaw.km = stopRaw.distance_km;
  }
  if (stopRaw.lat == null && stopRaw.latitude != null) {
    stopRaw.lat = stopRaw.latitude;
  }
  if (stopRaw.lon == null && stopRaw.longitude != null) {
    stopRaw.lon = stopRaw.longitude;
  }
  if (!stopRaw.verificationStatus) {
    stopRaw.verificationStatus = "unverified";
    notes.push(`Defaulted verificationStatus for stop zone ${String(stopRaw.zoneId)}`);
  }
  if (!stopRaw.poiId && raceId) {
    stopRaw.poiId = computePoiId(raceId, {
      osmId: typeof stopRaw.osmId === "number" ? stopRaw.osmId : undefined,
      osmType: typeof stopRaw.osmType === "string" ? stopRaw.osmType : undefined,
      name: typeof stopRaw.name === "string" ? stopRaw.name : undefined,
      category: typeof stopRaw.category === "string" ? stopRaw.category : undefined,
      distanceAlongKm: typeof stopRaw.km === "number" ? stopRaw.km : undefined,
    });
    notes.push(`Added poiId ${String(stopRaw.poiId)} for stop zone ${String(stopRaw.zoneId)}`);
  }
  const alternatives = stopRaw.alternatives ?? stopRaw.nearbyAlternatives;
  if (Array.isArray(alternatives)) {
    stopRaw.alternatives = alternatives;
    stopRaw.nearbyAlternatives = alternatives;
  }
}

function migrateLegacyBundle(raw: unknown): {
  record: Record<string, unknown>;
  notes: string[];
} {
  const record = cloneRawBundle(raw);
  const notes: string[] = [];
  const previousSchema =
    typeof record.schemaVersion === "number" ? record.schemaVersion : null;

  if (record.revision == null && record.bundle_version != null) {
    record.revision = record.bundle_version;
    notes.push("Copied bundle_version → revision");
  }
  if (!record.generatedAt && record.exportedAt) {
    record.generatedAt = record.exportedAt;
    notes.push("Copied exportedAt → generatedAt");
  }
  if (!record.generatedAt) {
    record.generatedAt = new Date().toISOString();
    notes.push("Added generatedAt timestamp");
  }
  if (!record.exportedAt) {
    record.exportedAt = record.generatedAt;
    notes.push("Added exportedAt timestamp");
  }

  const raceId = normalizeRaceMetadata(record, notes);

  if (!Array.isArray(record.unsupportedSections)) {
    record.unsupportedSections = [];
    notes.push("Added empty unsupportedSections array");
  }
  if (!Array.isArray(record.climbs)) {
    record.climbs = [];
    notes.push("Added empty climbs array");
  }

  if (Array.isArray(record.stops) && raceId) {
    for (const entry of record.stops) {
      const stopRaw = asRecord(entry);
      if (stopRaw) {
        normalizeStop(stopRaw, raceId, notes);
      }
    }
  }

  if (previousSchema == null || previousSchema < CURRENT_SCHEMA_VERSION) {
    record.schemaVersion = CURRENT_SCHEMA_VERSION;
    notes.push(
      `Upgraded schema ${previousSchema ?? "unknown"} → ${CURRENT_SCHEMA_VERSION}`,
    );
  }

  applyBundleVersionFields(record);
  notes.push("Applied bundle version contract fields");

  const bundle = record as unknown as CompanionBundle;
  if (!bundle.bundleChecksum) {
    bundle.bundleChecksum = computeBundleChecksumSync(bundle);
    notes.push("Computed missing bundleChecksum");
  }

  return { record, notes };
}

/** Diagnose, migrate, and validate a bundle downloaded from cloud or cache. */
export function prepareCompanionBundle(raw: unknown): BundlePrepareResult {
  const diagnostics = diagnoseCompanionBundle(raw);
  if (!raw || typeof raw !== "object") {
    return {
      bundle: null,
      errors: ["Bundle is not an object"],
      migrated: false,
      migrationNotes: [],
      diagnostics,
    };
  }

  const { record, notes } = migrateLegacyBundle(raw);
  const bundle = record as unknown as CompanionBundle;
  const validation = validateCompanionBundle(bundle);
  if (!validation.valid) {
    return {
      bundle: null,
      errors: validation.errors,
      migrated: notes.length > 0,
      migrationNotes: notes,
      diagnostics: [...diagnostics, ...validation.errors],
    };
  }

  const computed = computeBundleChecksumSync(bundle);
  if (bundle.bundleChecksum && computed && bundle.bundleChecksum !== computed) {
    bundle.bundleChecksum = computed;
    notes.push("Recomputed bundleChecksum after migration");
  }

  return {
    bundle,
    errors: [],
    migrated: notes.length > 0,
    migrationNotes: notes,
    diagnostics,
  };
}

export function formatBundlePrepareFailure(result: BundlePrepareResult): string {
  const parts = [...result.errors];
  if (result.diagnostics.length > 0) {
    parts.push(...result.diagnostics.filter((entry) => !parts.includes(entry)));
  }
  if (parts.length === 0) {
    return "Invalid companion bundle from cloud";
  }
  return `Invalid companion bundle from cloud: ${parts.join("; ")}`;
}

export function migrateCachedBundle(bundle: CompanionBundle): CompanionBundle | null {
  const result = prepareCompanionBundle(bundle);
  return result.bundle;
}

export function ensureStopPoiIds(bundle: CompanionBundle): CompanionBundle {
  const raceId = bundle.race.id;
  const stops = bundle.stops.map((stop) => {
    if (stop.poiId) {
      return stop;
    }
    return {
      ...stop,
      poiId: computePoiId(raceId, {
        osmId: stop.osmId,
        osmType: stop.osmType,
        name: stop.name,
        category: stop.category,
        distanceAlongKm: stop.km,
      }),
    } satisfies CompanionStop;
  });
  const next = { ...bundle, stops };
  if (!next.bundleChecksum) {
    next.bundleChecksum = computeBundleChecksumSync(next);
  }
  return next;
}
