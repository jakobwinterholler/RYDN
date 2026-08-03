/**
 * Companion bundle version contract — keep in sync with src/bundle_contract.py
 */

export const BUNDLE_SEMANTIC_VERSION = "1.0.0";
export const CURRENT_SCHEMA_VERSION = 5;
/** Lowest schema the Companion can migrate locally without server regeneration. */
export const MIN_MIGRATABLE_SCHEMA_VERSION = 1;
export const MINIMUM_COMPANION_VERSION = "0.2.3";
export const MINIMUM_DESKTOP_VERSION = "0.2.0";

export interface BundleVersionInfo {
  bundleVersion: string;
  schemaVersion: number;
  minimumCompanionVersion: string;
  minimumDesktopVersion: string;
}

export function currentBundleVersionInfo(): BundleVersionInfo {
  return {
    bundleVersion: BUNDLE_SEMANTIC_VERSION,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    minimumCompanionVersion: MINIMUM_COMPANION_VERSION,
    minimumDesktopVersion: MINIMUM_DESKTOP_VERSION,
  };
}

export function applyBundleVersionFields<T extends Record<string, unknown>>(bundle: T): T {
  const info = currentBundleVersionInfo();
  return {
    ...bundle,
    bundleVersion: info.bundleVersion,
    schemaVersion: info.schemaVersion,
    minimumCompanionVersion: info.minimumCompanionVersion,
    minimumDesktopVersion: info.minimumDesktopVersion,
  };
}

export function parseSchemaVersion(bundle: unknown): number | null {
  if (!bundle || typeof bundle !== "object") {
    return null;
  }
  const schema = (bundle as { schemaVersion?: unknown }).schemaVersion;
  return typeof schema === "number" ? schema : null;
}

/** True when the Companion can upgrade this bundle locally. */
export function canMigrateLocally(schemaVersion: number | null | undefined): boolean {
  if (schemaVersion == null) {
    return true;
  }
  if (schemaVersion > CURRENT_SCHEMA_VERSION) {
    return false;
  }
  return schemaVersion >= MIN_MIGRATABLE_SCHEMA_VERSION;
}

/** True when server regeneration is required (schema too new or structurally broken). */
export function requiresServerRegeneration(
  schemaVersion: number | null | undefined,
  errors: string[],
): boolean {
  if (schemaVersion != null && schemaVersion > CURRENT_SCHEMA_VERSION) {
    return true;
  }
  const structural = [
    "Bundle is not an object",
    'Missing field "stops"',
    'Missing field "route.coordinates"',
    "Route coordinates array is empty",
    'Missing field "race.id"',
  ];
  return errors.some((error) => structural.some((needle) => error.includes(needle)));
}

export function compareCompanionVersion(left: string, right: string): number {
  const parse = (value: string) => value.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(left);
  const b = parse(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

export function companionSupportsBundle(bundle: unknown): boolean {
  if (!bundle || typeof bundle !== "object") {
    return false;
  }
  const record = bundle as { minimumCompanionVersion?: string };
  if (!record.minimumCompanionVersion) {
    return true;
  }
  try {
    return compareCompanionVersion(MINIMUM_COMPANION_VERSION, record.minimumCompanionVersion) >= 0;
  } catch {
    return true;
  }
}
