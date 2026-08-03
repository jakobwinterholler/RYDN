import {
  fetchImportDuplicates,
  importApiAvailable,
  importGpxStream,
  type ConflictAction,
  type ImportDuplicateMatch,
  type ImportGpxEvent,
} from "@shared/api/importGpx";
import { useAuth } from "@shared/auth/AuthProvider";
import {
  importOfflineUserMessage,
  importSignInUserMessage,
  importUnavailableUserMessage,
  toUserFacingError,
} from "@shared/companion/userFacingErrors";
import type { CompanionBundle } from "@shared/types/sync";
import { useCallback, useEffect, useRef, useState } from "react";
import { saveCompanionBundle, saveOriginalGpx, saveRaceList, loadRaceList, deleteCompanionRace } from "../db";
import { fingerprintGpxFile } from "../lib/gpxFingerprint";
import DuplicateRaceDialog from "./DuplicateRaceDialog";

interface GpxImportFlowProps {
  file: File | null;
  onClose: () => void;
  onComplete: (bundle: CompanionBundle) => void;
  online: boolean;
}

export default function GpxImportFlow({ file, onClose, onComplete, online }: GpxImportFlowProps) {
  const { accessToken } = useAuth();
  const [phase, setPhase] = useState<"importing" | "ready" | "error">("importing");
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [syncWarning, setSyncWarning] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [duplicates, setDuplicates] = useState<ImportDuplicateMatch[] | null>(null);
  const [pendingFile] = useState<File | null>(file);
  const startedRef = useRef(false);

  const applyEvent = useCallback((event: ImportGpxEvent) => {
    if (event.type === "import_stage" || event.type === "progress") {
      setPercent((current) => {
        const nextPercent =
          event.type === "progress"
            ? event.percent ?? current
            : event.status === "complete"
              ? 100
              : event.percent ?? current;
        return Math.min(100, Math.round(nextPercent));
      });
      if (event.type === "import_stage" && event.stage_id === "ready" && event.status === "complete") {
        setPhase("ready");
      }
    }
  }, []);

  const persistImport = useCallback(
    async (
      result: {
        raceId: string;
        localRaceId?: string;
        bundle: CompanionBundle;
        companionRevision: number | null;
        fingerprint: string;
      },
      sourceFile: File,
    ) => {
      const gpxBytes = await sourceFile.arrayBuffer();
      const localRaceId = result.localRaceId ?? result.raceId;
      if (localRaceId !== result.raceId) {
        await deleteCompanionRace(localRaceId);
      }

      await saveCompanionBundle(result.bundle, {
        syncFromCloud: {
          revision: result.companionRevision ?? result.bundle.revision ?? 1,
          checksum: result.bundle.bundleChecksum ?? null,
          climbCount: result.bundle.climbs?.length ?? null,
        },
      });
      await saveOriginalGpx(result.raceId, gpxBytes);

      const existing = await loadRaceList();
      const revision =
        result.companionRevision ??
        result.bundle.revision ??
        result.bundle.bundle_version ??
        1;
      const others = existing.filter(
        (race) => race.id !== result.raceId && race.id !== localRaceId,
      );
      await saveRaceList([
        {
          id: result.raceId,
          name: result.bundle.race.name,
          distance_km: result.bundle.race.distanceKm,
          elevation_gain_m: result.bundle.race.elevationGainM,
          companion_revision: revision,
          version: revision,
          bundle_version: revision,
          bundle_checksum: result.bundle.bundleChecksum ?? null,
          bundle_schema_version: result.bundle.schemaVersion,
          gpx_fingerprint: result.fingerprint,
          updated_at: result.bundle.syncedAt ?? new Date().toISOString(),
          analyzed_at: result.bundle.race.analyzedAt ?? null,
          has_bundle: true,
          readiness_score: result.bundle.dashboardStats?.readinessScore ?? null,
          downloadedRevision: revision,
          downloadedChecksum: result.bundle.bundleChecksum ?? null,
          downloadedClimbCount: result.bundle.climbs?.length ?? null,
          offlineReady: true,
          source: "local-import",
          lastOpenedAt: new Date().toISOString(),
        },
        ...others,
      ]);
    },
    [],
  );

  const runImport = useCallback(
    async (sourceFile: File, conflictAction: ConflictAction, replaceRaceId?: string) => {
      if (!accessToken) {
        setError(importSignInUserMessage());
        setPhase("error");
        return;
      }
      if (!online) {
        setError(importOfflineUserMessage());
        setPhase("error");
        return;
      }
      if (!importApiAvailable()) {
        setError(importUnavailableUserMessage());
        setPhase("error");
        return;
      }

      setRunning(true);
      setError(null);
      setSyncWarning(null);
      setPhase("importing");
      setPercent(0);

      try {
        const result = await importGpxStream(
          accessToken,
          {
            file: sourceFile,
            name: sourceFile.name.replace(/\.gpx$/i, "").replace(/[_-]+/g, " "),
            conflictAction,
            replaceRaceId,
          },
          applyEvent,
        );
        await persistImport(result, sourceFile);
        if (result.syncWarning) {
          setSyncWarning(result.syncWarning);
        }
        setPhase("ready");
        setPercent(100);
        setRunning(false);
        onComplete(result.bundle);
      } catch (err) {
        setError(toUserFacingError(err, "Couldn't import this GPX. Try again or use desktop Ultra Roadbook."));
        setPhase("error");
        setRunning(false);
      }
    },
    [accessToken, applyEvent, online, onComplete, persistImport],
  );

  useEffect(() => {
    if (!pendingFile || startedRef.current) {
      return;
    }
    startedRef.current = true;

    void (async () => {
      if (!accessToken || !online || !importApiAvailable()) {
        if (!online) {
          setError(importOfflineUserMessage());
        } else if (!importApiAvailable()) {
          setError(importUnavailableUserMessage());
        } else {
          setError(importSignInUserMessage());
        }
        setPhase("error");
        return;
      }
      try {
        const fingerprint = await fingerprintGpxFile(pendingFile);
        const matches = await fetchImportDuplicates(accessToken, fingerprint);
        if (matches.length > 0) {
          setDuplicates(matches);
          return;
        }
        await runImport(pendingFile, "create");
      } catch (err) {
        setError(toUserFacingError(err, "Couldn't start the import. Try again."));
        setPhase("error");
      }
    })();
  }, [accessToken, online, pendingFile, runImport]);

  if (!pendingFile) {
    return null;
  }

  const statusLabel =
    phase === "ready" ? "Ready" : phase === "error" ? "Stopped" : "Analyzing…";

  return (
    <>
      {duplicates ? (
        <DuplicateRaceDialog
          matches={duplicates}
          fileName={pendingFile.name}
          onReplace={(raceId) => {
            setDuplicates(null);
            void runImport(pendingFile, "replace", raceId);
          }}
          onDuplicate={() => {
            setDuplicates(null);
            void runImport(pendingFile, "create");
          }}
          onCancel={() => {
            setDuplicates(null);
            onClose();
          }}
        />
      ) : null}

      <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/75 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[env(safe-area-inset-top,0px)] sm:items-center">
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#141414] p-5 shadow-2xl urp-animate-fade-up">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-emerald-300/80">
                {phase === "ready" ? "Route ready" : "Import route"}
              </p>
              <h2 className="mt-1 truncate text-lg font-semibold text-white">{pendingFile.name}</h2>
            </div>
            {!running ? (
              <button
                type="button"
                onClick={onClose}
                className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lg px-2 text-sm text-white/45 hover:bg-white/5 hover:text-white"
              >
                Close
              </button>
            ) : null}
          </div>

          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between text-xs text-white/45">
              <span>{statusLabel}</span>
              <span>{percent}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-emerald-400 transition-all duration-500 ease-out"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>

          {phase === "ready" ? (
            <p className="mt-4 text-sm text-emerald-200">Your route is analyzed and ready to review.</p>
          ) : running ? (
            <p className="mt-4 text-sm text-white/50">
              Finding climbs, resupply stops, and building your companion bundle…
            </p>
          ) : null}

          {error ? <p className="mt-4 text-sm text-red-300">{error}</p> : null}
          {syncWarning ? (
            <p className="mt-4 text-sm text-amber-200">
              Route saved locally. Cloud sync failed: {syncWarning}
            </p>
          ) : null}
        </div>
      </div>
    </>
  );
}
