/** Stable checksum for companion bundle validation (mirrors src/bundle_checksum.py). */

import type { CompanionBundle } from "../types/sync";
import { sha256Hex } from "./sha256";

const VOLATILE_FIELDS = new Set(["syncedAt", "bundleChecksum", "exportedAt"]);

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    sorted[key] = sortKeysDeep(record[key]);
  }
  return sorted;
}

export function canonicalBundlePayload(bundle: CompanionBundle): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(bundle)) {
    if (!VOLATILE_FIELDS.has(key)) {
      payload[key] = value;
    }
  }
  return payload;
}

function canonicalBundleJson(bundle: CompanionBundle): string {
  const payload = canonicalBundlePayload(bundle);
  return JSON.stringify(sortKeysDeep(payload));
}

export async function computeBundleChecksum(bundle: CompanionBundle): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle?.digest) {
    const canonical = canonicalBundleJson(bundle);
    const bytes = new TextEncoder().encode(canonical);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }
  return computeBundleChecksumSync(bundle);
}

export function computeBundleChecksumSync(bundle: CompanionBundle): string {
  return sha256Hex(canonicalBundleJson(bundle));
}
