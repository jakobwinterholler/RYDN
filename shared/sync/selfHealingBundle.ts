import { getSupabaseClient } from "../auth/supabaseClient";
import { fetchWithAuth, getApiBaseUrl, parseApiError } from "../api/client";
import type { CompanionBundle } from "../types/sync";
import {
  formatBundlePrepareFailure,
  prepareCompanionBundle,
  type BundlePrepareResult,
} from "../sync/bundleMigration";
import {
  canMigrateLocally,
  CURRENT_SCHEMA_VERSION,
  requiresServerRegeneration,
} from "../sync/bundleContract";
import { logSyncDebug } from "../sync/syncDebugLog";

export interface SelfHealingBundleResult {
  bundle: CompanionBundle;
  healed: boolean;
  migrated: boolean;
  regenerated: boolean;
  notes: string[];
}

async function downloadRawBundleFromSupabase(
  userId: string,
  raceId: string,
): Promise<unknown> {
  const supabase = getSupabaseClient();
  const path = `${userId}/${raceId}/companion-bundle.json`;
  const cacheBust = Date.now();
  const { data, error } = await supabase.storage
    .from("race-assets")
    .download(`${path}?_=${cacheBust}`);

  if (error) {
    throw new Error(error.message);
  }
  return JSON.parse(await data.text()) as unknown;
}

async function downloadRawBundleFromApi(
  accessToken: string,
  raceId: string,
): Promise<unknown> {
  const cacheBust = Date.now();
  const response = await fetchWithAuth(
    `/api/sync/races/${raceId}/bundle?_=${cacheBust}`,
    accessToken,
    { cache: "no-store" },
  );
  if (!response.ok) {
    throw new Error(await parseApiError(response, "Failed to download race."));
  }
  return response.json() as Promise<unknown>;
}

export async function regenerateCompanionBundle(
  accessToken: string,
  raceId: string,
): Promise<{ companion_revision: number; bundle_checksum?: string }> {
  if (!getApiBaseUrl()) {
    throw new Error("Bundle regeneration requires the analysis server (VITE_API_BASE_URL).");
  }
  const response = await fetchWithAuth(`/api/sync/races/${raceId}/regenerate-bundle`, accessToken, {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(await parseApiError(response, "Failed to regenerate bundle."));
  }
  return response.json();
}

function logPrepareFailure(raceId: string, result: BundlePrepareResult, stage: string): void {
  logSyncDebug("bundle-validation", `${stage}: ${raceId}`, {
    errors: result.errors,
    diagnostics: result.diagnostics,
    migrationNotes: result.migrationNotes,
  });
}

async function tryPrepare(
  raw: unknown,
  raceId: string,
  stage: string,
): Promise<BundlePrepareResult> {
  const result = prepareCompanionBundle(raw);
  if (!result.bundle) {
    logPrepareFailure(raceId, result, stage);
  } else if (result.migrated) {
    logSyncDebug("bundle-migration", `${stage}: migrated ${raceId}`, result.migrationNotes);
  }
  return result;
}

/**
 * Download a companion bundle with automatic migration and server regeneration.
 * Never requires the user to clear cache manually.
 */
export async function fetchCompanionBundleSelfHealing(
  accessToken: string,
  raceId: string,
  userId: string | null | undefined,
): Promise<SelfHealingBundleResult> {
  const notes: string[] = [];
  let regenerated = false;
  let migrated = false;

  const downloadRaw = async (): Promise<unknown> => {
    if (!getApiBaseUrl()) {
      if (!userId) {
        throw new Error("User id required to download race.");
      }
      return downloadRawBundleFromSupabase(userId, raceId);
    }
    return downloadRawBundleFromApi(accessToken, raceId);
  };

  let raw = await downloadRaw();
  const initialSchema =
    raw && typeof raw === "object"
      ? (raw as { schemaVersion?: number }).schemaVersion ?? null
      : null;

  if (
    getApiBaseUrl() &&
    initialSchema != null &&
    initialSchema < CURRENT_SCHEMA_VERSION
  ) {
    logSyncDebug(
      "bundle-regenerate",
      `Legacy schema ${initialSchema} for ${raceId} — regenerating before migration`,
    );
    try {
      await regenerateCompanionBundle(accessToken, raceId);
      regenerated = true;
      notes.push(`Regenerated legacy schema ${initialSchema} bundle from analysis.json`);
      raw = await downloadRaw();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Regeneration failed";
      logSyncDebug("bundle-regenerate", `Legacy schema regeneration failed for ${raceId}: ${message}`);
      notes.push(message);
    }
  }

  let prepared = await tryPrepare(raw, raceId, "initial");

  if (!prepared.bundle) {
    const schemaVersion =
      raw && typeof raw === "object"
        ? (raw as { schemaVersion?: number }).schemaVersion ?? null
        : null;

    if (!canMigrateLocally(schemaVersion)) {
      notes.push(`Schema ${schemaVersion ?? "unknown"} cannot be migrated locally`);
    }

    const needsRegen = requiresServerRegeneration(schemaVersion, prepared.errors);

    if (needsRegen && getApiBaseUrl()) {
      logSyncDebug("bundle-regenerate", `Requesting server regeneration for ${raceId}`, prepared.errors);
      try {
        await regenerateCompanionBundle(accessToken, raceId);
        regenerated = true;
        notes.push("Server regenerated bundle from analysis.json");
        raw = await downloadRaw();
        prepared = await tryPrepare(raw, raceId, "post-regenerate");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Regeneration failed";
        logSyncDebug("bundle-regenerate", `Regeneration failed for ${raceId}: ${message}`);
        notes.push(message);
      }
    } else if (needsRegen) {
      notes.push("Structural bundle error — waiting for Desktop sync to upload a fresh bundle");
    }
  }

  if (!prepared.bundle) {
    throw new Error(formatBundlePrepareFailure(prepared));
  }

  migrated = prepared.migrated;
  return {
    bundle: prepared.bundle,
    healed: migrated || regenerated,
    migrated,
    regenerated,
    notes,
  };
}
