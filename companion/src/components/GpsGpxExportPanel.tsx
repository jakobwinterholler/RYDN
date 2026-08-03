import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@shared/auth/AuthProvider";
import { fetchOriginalGpx } from "@shared/api/sync";
import {
  buildGpxExportPreview,
  exportGpxForGps,
  GpxExportQualityError,
  GpxTrackModifiedError,
  ROUTE_INTEGRITY_FAILED_MESSAGE,
  type GpsGpxDeviceProfile,
  type GpsGpxExportReport,
  type GpxExportPreview,
} from "@shared/race/gpsGpxExport";
import type { WaypointExportPriority } from "@shared/race/corosWaypointPriority";
import type { CompanionBundle } from "@shared/types/sync";
import { loadOriginalGpx, saveOriginalGpx } from "../db";
import { shareGpxFile } from "../lib/shareGpxFile";

const DEVICE_OPTIONS: Array<{ id: GpsGpxDeviceProfile; label: string; hint: string }> = [
  { id: "original", label: "GPX (Original)", hint: "Full waypoint names" },
  { id: "coros", label: "GPX for Coros", hint: "Smart names, native icons, preview" },
  { id: "garmin", label: "GPX for Garmin", hint: "Balanced names" },
  { id: "wahoo", label: "GPX for Wahoo", hint: "Balanced names" },
];

const PRIORITY_STYLE: Record<WaypointExportPriority, string> = {
  critical: "bg-rose-500/15 text-rose-100 ring-rose-400/30",
  recommended: "bg-amber-500/15 text-amber-100 ring-amber-400/30",
  optional: "bg-white/10 text-white/70 ring-white/15",
};

function countVerifiedStops(bundle: CompanionBundle): number {
  return bundle.stops.filter((stop) => stop.verificationStatus === "verified").length;
}

function formatNumber(value: number): string {
  return value.toLocaleString();
}

function ExportReportPanel({ report }: { report: GpsGpxExportReport }) {
  return (
    <div className="mt-4 space-y-1 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
      <p className="font-semibold text-white">
        Route integrity: {report.routeIntegrityPassed ? "✓ Passed" : "✗ Failed"}
      </p>
      <p>Trackpoints: {formatNumber(report.trackPointCount)}</p>
      <p>Distance: {report.distanceKm.toFixed(2)} km</p>
      <p>Ascent: {formatNumber(report.elevationGainM)} m</p>
      {report.elevationDescentM > 0 ? <p>Descent: {formatNumber(report.elevationDescentM)} m</p> : null}
      <p>Verified POIs: {report.verifiedPoiCount}</p>
      <p>Exported POIs: {report.exportedPoiCount}</p>
      <p>
        Critical: {report.criticalCount} · Recommended: {report.recommendedCount}
      </p>
      {report.deviceProfile === "coros" && report.corosIconsAssigned != null ? (
        <p>
          Coros Icons: {report.corosIconsAssigned}/{report.corosIconsTotal ?? report.exportedPoiCount}{" "}
          assigned
        </p>
      ) : null}
      <p>Integrity: {report.integrityPercent}%</p>
    </div>
  );
}

function CorosPreviewPanel({
  preview,
  loading,
}: {
  preview: GpxExportPreview | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-5 text-center text-sm text-white/60">
        Validating export…
      </div>
    );
  }
  if (!preview) {
    return null;
  }

  const integrityClass = preview.routeIntegrityPassed
    ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-100"
    : "border-red-400/30 bg-red-500/10 text-red-100";

  return (
    <div className="mt-4 space-y-3">
      <div className={`rounded-xl border px-4 py-3 ${integrityClass}`}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] opacity-70">
          Export integrity
        </p>
        <p className="mt-1 text-2xl font-bold text-white">
          {preview.routeIntegrityPassed ? "PASS" : "FAIL"}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <PreviewStat label="Waypoints" value={preview.exportedCount} />
        <PreviewStat label="Critical" value={preview.criticalCount} />
        <PreviewStat label="Recommended" value={preview.recommendedCount} />
        <PreviewStat label="Optional" value={preview.optionalCount} />
      </div>
      {preview.waypoints.length > 0 ? (
        <ul className="max-h-40 divide-y divide-white/10 overflow-y-auto rounded-xl border border-white/10 bg-white/[0.03]">
          {preview.waypoints.map((waypoint) => (
            <li key={`${waypoint.name}-${waypoint.km}`} className="flex items-center gap-2 px-3 py-2">
              <span className="text-xs text-white/45">km {Math.round(waypoint.km)}</span>
              <span className="flex-1 truncate text-sm text-white">{waypoint.name}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ring-1 ${PRIORITY_STYLE[waypoint.priority]}`}
              >
                {waypoint.priority}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function PreviewStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-center">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/40">{label}</p>
      <p className="mt-1 text-lg font-bold text-white">{value}</p>
    </div>
  );
}

interface GpsGpxExportPanelProps {
  bundle: CompanionBundle;
  onSuccess?: () => void;
  showCancel?: boolean;
  onCancel?: () => void;
  initialDevice?: GpsGpxDeviceProfile;
  autoStartExport?: boolean;
  onAutoStartHandled?: () => void;
}

export default function GpsGpxExportPanel({
  bundle,
  onSuccess,
  showCancel = false,
  onCancel,
  initialDevice,
  autoStartExport = false,
  onAutoStartHandled,
}: GpsGpxExportPanelProps) {
  const { accessToken, user } = useAuth();
  const [device, setDevice] = useState<GpsGpxDeviceProfile>(initialDevice ?? "coros");
  const [verifiedOnly, setVerifiedOnly] = useState(true);
  const [includeHighConfidence, setIncludeHighConfidence] = useState(false);
  const [includeAlternatives, setIncludeAlternatives] = useState(false);
  const [includeOptional, setIncludeOptional] = useState(false);
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<GpsGpxExportReport | null>(null);
  const [preview, setPreview] = useState<GpxExportPreview | null>(null);
  const [originalGpx, setOriginalGpx] = useState<ArrayBuffer | null>(null);

  const verifiedCount = useMemo(() => countVerifiedStops(bundle), [bundle]);
  const autoStartedRef = useRef(false);

  const exportOptions = useMemo(
    () => ({
      deviceProfile: device,
      verifiedOnly,
      includeHighConfidence,
      includeAlternatives,
      includeOptional,
    }),
    [device, verifiedOnly, includeHighConfidence, includeAlternatives, includeOptional],
  );

  async function resolveOriginalGpx(): Promise<ArrayBuffer> {
    const cached = await loadOriginalGpx(bundle.race.id);
    if (cached) {
      return cached;
    }
    if (!accessToken || !user?.id) {
      throw new Error("Connect to the internet once to download the original route GPX.");
    }
    const gpx = await fetchOriginalGpx(accessToken, bundle.race.id, user.id);
    await saveOriginalGpx(bundle.race.id, gpx);
    return gpx;
  }

  useEffect(() => {
    if (report || device !== "coros") {
      setPreview(null);
      return;
    }

    let cancelled = false;
    setPreviewLoading(true);

    void (async () => {
      try {
        const gpx = originalGpx ?? (await resolveOriginalGpx());
        if (!originalGpx) {
          setOriginalGpx(gpx);
        }
        if (cancelled) {
          return;
        }
        setPreview(buildGpxExportPreview(gpx, bundle, exportOptions));
      } catch (err) {
        if (!cancelled) {
          setPreview(null);
          setError(err instanceof Error ? err.message : "Preview failed.");
        }
      } finally {
        if (!cancelled) {
          setPreviewLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bundle, device, exportOptions, originalGpx, report]);

  const canExport =
    device !== "coros" ||
    (preview?.routeIntegrityPassed === true && preview.validationErrors.length === 0);

  async function handleExport() {
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const gpx = originalGpx ?? (await resolveOriginalGpx());
      const { bytes, report: exportReport } = exportGpxForGps(gpx, bundle, exportOptions);
      const slug = bundle.race.name.trim().replace(/\s+/g, "-") || "race";
      const filename = `${slug}-gps-${device}.gpx`;
      await shareGpxFile(bytes, filename);
      setReport(exportReport);
      if (exportReport.exportedPoiCount === 0) {
        setError("Exported original route only — no verified stops matched your options.");
      } else {
        onSuccess?.();
      }
    } catch (err) {
      if (err instanceof GpxTrackModifiedError) {
        setError(ROUTE_INTEGRITY_FAILED_MESSAGE);
      } else if (err instanceof GpxExportQualityError) {
        setError(err.message);
      } else if (err instanceof Error && err.name === "AbortError") {
        onCancel?.();
      } else {
        setError(err instanceof Error ? err.message : "GPS GPX export failed.");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!autoStartExport || autoStartedRef.current) {
      return;
    }
    autoStartedRef.current = true;
    void handleExport().finally(() => onAutoStartHandled?.());
  }, [autoStartExport, onAutoStartHandled]);

  return (
    <div>
      <h3 className="text-lg font-semibold text-white">Race GPX for GPS</h3>
      <p className="mt-2 text-sm leading-relaxed text-white/55">
        Exports your original GPX unchanged and adds navigation waypoints. Share to Coros, Files,
        or AirDrop.
        {verifiedCount > 0
          ? ` ${verifiedCount} verified stop${verifiedCount === 1 ? "" : "s"} available.`
          : " No verified stops yet — you'll get the original route only."}
      </p>

      {!report ? (
        <>
          <div className="mt-4 space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/40">Format</p>
            {DEVICE_OPTIONS.map((option) => (
              <label
                key={option.id}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-3 ${
                  device === option.id ? "border-sky-400/40 bg-sky-500/10" : "border-white/10 bg-white/[0.03]"
                }`}
              >
                <input
                  type="radio"
                  name="gps-device-mobile"
                  checked={device === option.id}
                  onChange={() => setDevice(option.id)}
                  className="mt-1 accent-sky-400"
                />
                <span>
                  <span className="block text-sm font-medium text-white">{option.label}</span>
                  <span className="block text-xs text-white/45">{option.hint}</span>
                </span>
              </label>
            ))}
          </div>

          <div className="mt-4 space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/40">Waypoints</p>
            <label className="flex min-h-[44px] items-center gap-2 text-sm text-white/85">
              <input
                type="checkbox"
                checked={verifiedOnly}
                onChange={(event) => setVerifiedOnly(event.target.checked)}
                className="accent-sky-400"
              />
              Verified resupply stops only
            </label>
            <label className="flex min-h-[44px] items-center gap-2 text-sm text-white/85">
              <input
                type="checkbox"
                checked={includeOptional}
                onChange={(event) => setIncludeOptional(event.target.checked)}
                className="accent-sky-400"
              />
              Include optional stops
            </label>
            <label className="flex min-h-[44px] items-center gap-2 text-sm text-white/85">
              <input
                type="checkbox"
                checked={includeHighConfidence}
                onChange={(event) => setIncludeHighConfidence(event.target.checked)}
                disabled={device === "coros"}
                className="accent-sky-400 disabled:opacity-50"
              />
              Include high-confidence stops
            </label>
            <label className="flex min-h-[44px] items-center gap-2 text-sm text-white/85">
              <input
                type="checkbox"
                checked={includeAlternatives}
                onChange={(event) => setIncludeAlternatives(event.target.checked)}
                className="accent-sky-400"
              />
              Include alternatives
            </label>
          </div>

          {device === "coros" ? <CorosPreviewPanel preview={preview} loading={previewLoading} /> : null}
        </>
      ) : (
        <ExportReportPanel report={report} />
      )}

      {error ? <p className="mt-4 text-sm text-red-300">{error}</p> : null}

      <div className="mt-5 flex gap-2">
        {showCancel ? (
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="min-h-[48px] flex-1 rounded-xl border border-white/12 text-sm font-medium text-white/80"
          >
            {report ? "Done" : "Cancel"}
          </button>
        ) : null}
        {!report ? (
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={loading || previewLoading || !canExport}
            className={`min-h-[48px] rounded-xl bg-sky-500 text-sm font-semibold text-white disabled:opacity-60 ${
              showCancel ? "flex-1" : "w-full"
            }`}
          >
            {loading ? "Exporting…" : device === "coros" ? "Export to Coros" : "Share GPX"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
