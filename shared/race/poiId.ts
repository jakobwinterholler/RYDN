/** Stable permanent POI identifiers shared across Desktop, Cloud, and Companion. */

export function normalizePoiName(value: string | null | undefined): string {
  if (!value?.trim()) {
    return "";
  }
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export interface PoiIdInput {
  osmId?: number;
  osmType?: string;
  name?: string | null;
  brand?: string | null;
  poiCategory?: string | null;
  category?: string | null;
  distanceAlongKm?: number | null;
}

/** Return a stable POI id like `poi_38472`. */
export function computePoiId(raceId: string, poi: PoiIdInput | null | undefined): string {
  const record = poi ?? {};
  if (record.osmId != null && record.osmType) {
    return `poi_${record.osmId}`;
  }

  const category = String(record.poiCategory ?? record.category ?? "unknown");
  const name = normalizePoiName(record.name ?? record.brand ?? "");
  const km = Math.round((record.distanceAlongKm ?? 0) * 10) / 10;
  const digest = fnv1aHex(`${raceId}:${category}:${name}:${km}`);
  const numeric = (parseInt(digest.slice(0, 8), 16) % 900_000) + 10_000;
  return `poi_${numeric}`;
}

function fnv1aHex(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function verifiedStopLookupKeys(
  zoneId: number | null | undefined,
  poiId: string | null | undefined,
): string[] {
  const keys: string[] = [];
  if (poiId) {
    keys.push(poiId);
  }
  if (zoneId != null) {
    const zoneKey = String(zoneId);
    if (!keys.includes(zoneKey)) {
      keys.push(zoneKey);
    }
  }
  return keys;
}

export function resolveVerifiedStopRecord(
  verifiedStops: Record<string, unknown>,
  zoneId: number | null | undefined,
  poiId: string | null | undefined,
): { record: Record<string, unknown> | null; key: string | null } {
  for (const key of verifiedStopLookupKeys(zoneId, poiId)) {
    const record = verifiedStops[key];
    if (record && typeof record === "object") {
      return { record: record as Record<string, unknown>, key };
    }
  }
  return { record: null, key: null };
}
