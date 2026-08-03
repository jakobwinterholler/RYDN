import { useEffect, useRef, useState } from "react";
import type { ImportProgressStats, ImportProgressUpdate, RideKind } from "../../api";
import { importPlannedRouteStream, importRide } from "../../api";
import {
  fileHasGpxTimestamps,
  loadImportPurpose,
  saveImportPurpose,
  type ImportPurpose,
} from "../../library/importPurpose";
import FocusLock from "../ui/FocusLock";

type ImportPhase = "idle" | "working" | "success" | "error";

const COMPLETED_STAGES: { label: string; pct: number }[] = [
  { label: "Uploading files", pct: 12 },
  { label: "Parsing activity", pct: 38 },
  { label: "Computing metrics", pct: 68 },
  { label: "Saving ride", pct: 88 },
];

function formatImportElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}:${String(r).padStart(2, "0")}` : `${r}s`;
}

function ImportLiveStats({ stats }: { stats: ImportProgressStats }) {
  const items: { key: string; label: string; ready: boolean }[] = [
    {
      key: "distance",
      label:
        stats.distanceKm != null
          ? `${Number(stats.distanceKm).toFixed(Number(stats.distanceKm) >= 100 ? 0 : 1)} km`
          : "Distance",
      ready: stats.distanceKm != null,
    },
    {
      key: "elev",
      label:
        stats.elevationGainM != null
          ? `${Math.round(Number(stats.elevationGainM)).toLocaleString("en-US")} m elev`
          : "Elevation",
      ready: stats.elevationGainM != null,
    },
    {
      key: "climbs",
      label:
        stats.climbCount != null
          ? `${stats.climbCount} climb${stats.climbCount === 1 ? "" : "s"}`
          : "Climbs",
      ready: stats.climbCount != null,
    },
    {
      key: "stops",
      label:
        stats.recommendedStopCount != null
          ? `${stats.recommendedStopCount} stop${stats.recommendedStopCount === 1 ? "" : "s"}`
          : stats.waterCount != null
            ? `${stats.waterCount} water`
            : "Stops",
      ready: stats.recommendedStopCount != null || stats.waterCount != null,
    },
    {
      key: "remote",
      label:
        stats.remoteGapCount != null
          ? `${stats.remoteGapCount} remote`
          : "Remote",
      ready: stats.remoteGapCount != null,
    },
    {
      key: "stages",
      label:
        stats.stageCount != null
          ? `${stats.stageCount} stage${stats.stageCount === 1 ? "" : "s"}`
          : "Stages",
      ready: stats.stageCount != null,
    },
  ];

  const visible = items.filter((i) => i.ready);
  if (visible.length === 0) return null;

  return (
    <ul className="import-progress__stats" aria-live="polite">
      {visible.map((item) => (
        <li key={item.key} className="import-progress__stat">
          <span className="import-progress__check" aria-hidden>
            ✓
          </span>
          {item.label}
        </li>
      ))}
    </ul>
  );
}

export function UploadModal({
  allowPlanning,
  onClose,
  onProRequired,
  onImportedRide,
  onImportedRoute,
}: {
  allowPlanning: boolean;
  onClose: () => void;
  onProRequired: () => void;
  onImportedRide: (id: string) => void;
  onImportedRoute: (id: string) => void;
}) {
  const [purpose, setPurpose] = useState<ImportPurpose>(() => {
    const saved = loadImportPurpose();
    return saved === "planned" && !allowPlanning ? "completed" : saved;
  });
  const [kind, setKind] = useState<RideKind>("training");
  const [drag, setDrag] = useState(false);
  const [phase, setPhase] = useState<ImportPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [hintNeedsUnlock, setHintNeedsUnlock] = useState(false);
  const [label, setLabel] = useState("Preparing…");
  const [pct, setPct] = useState(0);
  const [stats, setStats] = useState<ImportProgressStats>({});
  const [elapsedMs, setElapsedMs] = useState(0);
  const [fileLabel, setFileLabel] = useState<string | null>(null);
  const [lastFiles, setLastFiles] = useState<File[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const startedAtRef = useRef<number>(0);
  const successTimerRef = useRef<number | null>(null);
  const rideStageTimerRef = useRef<number | null>(null);
  const busy = phase === "working" || phase === "success";

  useEffect(() => {
    return () => {
      if (successTimerRef.current != null) window.clearTimeout(successTimerRef.current);
      if (rideStageTimerRef.current != null) window.clearInterval(rideStageTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (phase !== "working") return;
    startedAtRef.current = Date.now();
    setElapsedMs(0);
    const id = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAtRef.current);
    }, 400);
    return () => window.clearInterval(id);
  }, [phase]);

  const choosePurpose = (next: ImportPurpose) => {
    if (busy) return;
    if (next === "planned" && !allowPlanning) {
      onProRequired();
      return;
    }
    setPurpose(next);
    saveImportPurpose(next);
    setError(null);
    setHint(null);
    setHintNeedsUnlock(false);
    setPhase("idle");
  };

  const applyProgress = (update: ImportProgressUpdate) => {
    setLabel(update.label);
    setPct(update.pct);
    if (update.stats) setStats((prev) => ({ ...prev, ...update.stats }));
  };

  const finishSuccess = (navigate: () => void) => {
    setPhase("success");
    setPct(100);
    setLabel("Route imported successfully");
    successTimerRef.current = window.setTimeout(() => {
      navigate();
    }, 1000);
  };

  const submit = async (files: File[]) => {
    if (files.length === 0 || busy) return;
    setLastFiles(files);
    setPhase("working");
    setError(null);
    setHint(null);
    setHintNeedsUnlock(false);
    setStats({});
    setPct(purpose === "planned" ? 2 : 8);
    setLabel(purpose === "planned" ? "Uploading GPX" : "Uploading files");
    setFileLabel(
      files.length === 1
        ? files[0].name
        : `${files.length} files · ${files[0]?.name || "selection"}`,
    );

    try {
      if (purpose === "planned") {
        if (!allowPlanning) {
          onProRequired();
          return;
        }
        const gpx = files.find((f) => (f.name || "").toLowerCase().endsWith(".gpx"));
        if (!gpx) {
          throw new Error("Planned routes need a GPX file.");
        }
        setFileLabel(gpx.name);
        const s = await importPlannedRouteStream(gpx, undefined, applyProgress);
        finishSuccess(() => onImportedRoute(s.id));
        return;
      }

      // Completed ride — if a lone GPX has no timestamps, steer to Planned.
      if (files.length === 1 && (files[0].name || "").toLowerCase().endsWith(".gpx")) {
        const timed = await fileHasGpxTimestamps(files[0]);
        if (!timed) {
          if (!allowPlanning) {
            setPhase("idle");
            setHint(
              "This GPX has no timestamps, so it cannot be a completed ride. Unlock Planned Route with Pro or a Race Pass.",
            );
            setHintNeedsUnlock(true);
            return;
          }
          setPhase("idle");
          setPurpose("planned");
          saveImportPurpose("planned");
          setHint(
            "This GPX has no timestamps, so it cannot be a completed ride. Switched to Planned Route — import again to continue.",
          );
          return;
        }
      }

      let stageIdx = 0;
      setLabel(COMPLETED_STAGES[0].label);
      setPct(COMPLETED_STAGES[0].pct);
      rideStageTimerRef.current = window.setInterval(() => {
        stageIdx = Math.min(stageIdx + 1, COMPLETED_STAGES.length - 1);
        const stage = COMPLETED_STAGES[stageIdx];
        setLabel(stage.label);
        setPct((p) => Math.max(p, stage.pct));
      }, 900);

      const s = await importRide(kind, files);
      if (rideStageTimerRef.current != null) {
        window.clearInterval(rideStageTimerRef.current);
        rideStageTimerRef.current = null;
      }
      setLabel("Ride imported successfully");
      setPct(100);
      setPhase("success");
      successTimerRef.current = window.setTimeout(() => {
        onImportedRide(s.id);
      }, 900);
    } catch (e) {
      if (rideStageTimerRef.current != null) {
        window.clearInterval(rideStageTimerRef.current);
        rideStageTimerRef.current = null;
      }
      setError((e as Error).message || "Import failed. Try again.");
      setPhase("error");
    }
  };

  const accept = purpose === "planned" ? ".gpx" : ".fit,.tcx,.gpx";
  const barClass =
    phase === "working" && pct < 98
      ? "import-progress__bar import-progress__bar--live"
      : "import-progress__bar";

  return (
    <FocusLock
      open
      onClose={busy ? () => undefined : onClose}
      labelledBy="upload-title"
      variant="modal"
    >
      <div className="modal__head">
        <h2 id="upload-title">Import</h2>
        <button
          type="button"
          className="modal__x"
          onClick={onClose}
          aria-label="Close"
          disabled={busy}
        >
          ×
        </button>
      </div>

      <div className="kind-toggle" role="group" aria-label="Import as">
        <button
          type="button"
          className={`${purpose === "planned" ? "active" : ""}${!allowPlanning ? " kind-toggle__btn--locked" : ""}`}
          onClick={() => choosePurpose("planned")}
          disabled={busy}
          aria-label={!allowPlanning ? "Planned Route — needs Pro or Race Pass" : "Planned Route"}
        >
          Planned Route
          {!allowPlanning ? (
            <span className="kind-toggle__lock" aria-hidden>
              Pro
            </span>
          ) : null}
        </button>
        <button
          type="button"
          className={purpose === "completed" ? "active" : ""}
          onClick={() => choosePurpose("completed")}
          disabled={busy}
        >
          Completed Ride
        </button>
      </div>

      {purpose === "planned" ? (
        <p className="modal__lead">
          Course GPX for planning and verification. Never enters the Ride Library or analytics.
        </p>
      ) : (
        <>
          <p className="modal__lead">
            Finished activity from Strava export, Garmin, FIT, TCX, or timed GPX — goes to Library.
          </p>
          <div className="kind-toggle kind-toggle--secondary" role="group" aria-label="Ride type">
            <button
              type="button"
              className={kind === "training" ? "active" : ""}
              onClick={() => setKind("training")}
              disabled={busy}
            >
              Training
            </button>
            <button
              type="button"
              className={kind === "race" ? "active" : ""}
              onClick={() => setKind("race")}
              disabled={busy}
            >
              Race
            </button>
          </div>
        </>
      )}

      {phase === "idle" || phase === "error" ? (
        <div
          className={`dropzone${drag ? " drag" : ""}${phase === "error" ? " dropzone--error" : ""}`}
          onClick={() => {
            if (!busy) inputRef.current?.click();
          }}
          onDragOver={(e) => {
            e.preventDefault();
            if (!busy) setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            if (!busy) void submit(Array.from(e.dataTransfer.files));
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (!busy) inputRef.current?.click();
            }
          }}
        >
          <div className="dropzone__icon">＋</div>
          <div className="dropzone__title">Drop files here, or click to choose</div>
          <div className="dropzone__sub">
            {purpose === "planned"
              ? "GPX course file · becomes a Planned Route"
              : "FIT · TCX · GPX · becomes a Ride in Library"}
          </div>
          <input
            ref={inputRef}
            type="file"
            multiple={purpose === "completed"}
            accept={accept}
            hidden
            disabled={busy}
            onChange={(e) => {
              const list = Array.from(e.target.files ?? []);
              e.target.value = "";
              void submit(list);
            }}
          />
        </div>
      ) : (
        <div
          className={`import-progress${phase === "success" ? " import-progress--success" : ""}`}
          aria-live="polite"
          aria-busy={phase === "working"}
        >
          {fileLabel && <div className="import-progress__file">{fileLabel}</div>}
          <div className="import-progress__track">
            <div
              className={barClass}
              style={{ width: `${Math.max(phase === "success" ? 100 : 4, Math.min(100, pct))}%` }}
            />
          </div>
          <div className="import-progress__row">
            {phase === "working" ? (
              <span className="import-progress__spinner" aria-hidden />
            ) : (
              <span className="import-progress__done" aria-hidden>
                ✓
              </span>
            )}
            <div className="import-progress__copy">
              <div className="import-progress__label">
                {phase === "success"
                  ? purpose === "planned"
                    ? "Route imported successfully"
                    : "Ride imported successfully"
                  : label}
              </div>
              {phase === "working" && (
                <div className="import-progress__meta">
                  <span>{Math.round(pct)}%</span>
                  <span aria-hidden>·</span>
                  <span>{formatImportElapsed(elapsedMs)}</span>
                </div>
              )}
            </div>
          </div>
          {purpose === "planned" && <ImportLiveStats stats={stats} />}
        </div>
      )}

      {hint ? (
        <div className="modal__hint">
          <p>{hint}</p>
          {hintNeedsUnlock ? (
            <button
              type="button"
              className="btn btn--primary"
              style={{ marginTop: 10 }}
              onClick={onProRequired}
            >
              Unlock with Race Pass or Pro
            </button>
          ) : null}
        </div>
      ) : null}
      {error && phase === "error" && (
        <div className="import-error">
          <div className="modal__error">{error}</div>
          <button
            type="button"
            className="btn btn--ghost import-error__retry"
            onClick={() => void submit(lastFiles)}
            disabled={lastFiles.length === 0}
          >
            Retry
          </button>
        </div>
      )}
    </FocusLock>
  );
}
