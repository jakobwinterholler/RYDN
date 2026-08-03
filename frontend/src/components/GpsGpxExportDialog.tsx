import { useMemo, useState } from "react";
import type { VerifiedStopRecord } from "../planning/stopVerification/types";
import { downloadGpsExport, type GpsGpxExportReport } from "../api";
import { raceGpsExportEndpoint, raceGpsExportPreviewEndpoint } from "../races/api";
import GpsExportQrPanel from "./GpsExportQrPanel";
import CorosExportPreviewPanel, { useCorosExportPreview } from "./CorosExportPreviewPanel";

export type GpsGpxDeviceProfile = "original" | "coros" | "garmin" | "wahoo";

export interface GpsGpxExportOptions {
  device: GpsGpxDeviceProfile;
  verifiedOnly: boolean;
  includeHighConfidence: boolean;
  includeAlternatives: boolean;
  includeOptional: boolean;
}

interface GpsGpxExportDialogProps {
  raceId: string;
  raceName: string;
  open: boolean;
  verifiedStops: Record<string, VerifiedStopRecord>;
  onClose: () => void;
  onExported?: () => void;
}

const DEVICE_OPTIONS: Array<{ id: GpsGpxDeviceProfile; label: string; hint: string }> = [
  { id: "original", label: "GPX (Original)", hint: "Full waypoint names and metadata" },
  { id: "coros", label: "GPX for Coros", hint: "Smart names, native icons, export preview" },
  { id: "garmin", label: "GPX for Garmin", hint: "Balanced names for Edge devices" },
  { id: "wahoo", label: "GPX for Wahoo", hint: "Balanced names for ELEMNT devices" },
];

function countVerifiedStops(verifiedStops: Record<string, VerifiedStopRecord>): number {
  return Object.values(verifiedStops).filter((record) => record.status === "verified").length;
}

function formatNumber(value: number): string {
  return value.toLocaleString();
}

function ExportReportPanel({ report }: { report: GpsGpxExportReport }) {
  return (
    <div className="mt-4 space-y-1 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
      <p className="font-semibold">
        Route integrity: {report.route_integrity_passed ? "✓ Passed" : "✗ Failed"}
      </p>
      <p>Trackpoints: {formatNumber(report.track_point_count)}</p>
      <p>Distance: {report.distance_km.toFixed(2)} km</p>
      <p>Ascent: {formatNumber(report.elevation_gain_m)} m</p>
      {report.elevation_descent_m > 0 ? (
        <p>Descent: {formatNumber(report.elevation_descent_m)} m</p>
      ) : null}
      <p>Verified POIs: {report.verified_poi_count}</p>
      <p>Exported POIs: {report.exported_poi_count}</p>
      <p>
        Critical: {report.critical_count} · Recommended: {report.recommended_count}
        {report.optional_count > 0 ? ` · Optional: ${report.optional_count}` : ""}
      </p>
      {report.device_profile === "coros" && report.coros_icons_assigned != null ? (
        <p>
          Coros Icons: {report.coros_icons_assigned}/{report.coros_icons_total ?? report.exported_poi_count}{" "}
          assigned
        </p>
      ) : null}
      <p>Integrity: {report.integrity_percent}%</p>
    </div>
  );
}

export default function GpsGpxExportDialog({
  raceId,
  raceName,
  open,
  verifiedStops,
  onClose,
  onExported,
}: GpsGpxExportDialogProps) {
  const [device, setDevice] = useState<GpsGpxDeviceProfile>("coros");
  const [verifiedOnly, setVerifiedOnly] = useState(true);
  const [includeHighConfidence, setIncludeHighConfidence] = useState(false);
  const [includeAlternatives, setIncludeAlternatives] = useState(false);
  const [includeOptional, setIncludeOptional] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<GpsGpxExportReport | null>(null);

  const verifiedCount = countVerifiedStops(verifiedStops);
  const exportOptions = useMemo(
    () => ({
      device,
      verifiedOnly,
      includeHighConfidence,
      includeAlternatives,
      includeOptional,
    }),
    [device, verifiedOnly, includeHighConfidence, includeAlternatives, includeOptional],
  );

  const previewEndpoint = useMemo(
    () => (open && !report ? raceGpsExportPreviewEndpoint(raceId, exportOptions) : null),
    [open, report, raceId, exportOptions],
  );

  const { preview, loading: previewLoading, error: previewError } = useCorosExportPreview(
    previewEndpoint,
    device === "coros" && open && !report,
  );

  const canExport =
    device !== "coros" ||
    (preview?.routeIntegrityPassed === true && preview.validationErrors.length === 0);

  async function handleExport() {
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const endpoint = raceGpsExportEndpoint(raceId, exportOptions);
      const slug = raceName.trim().replace(/\s+/g, "-") || "race";
      const exportReport = await downloadGpsExport(endpoint, `${slug}-gps-${device}.gpx`);
      if (exportReport) {
        setReport(exportReport);
      }
      onExported?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "GPS GPX export failed.");
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    setReport(null);
    setError(null);
    onClose();
  }

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close export dialog"
        onClick={handleClose}
      />
      <div className="relative w-full max-w-lg rounded-2xl bg-card p-6 shadow-card">
        <h3 className="text-xl font-semibold text-ink">Race GPX for GPS</h3>
        <p className="mt-2 text-sm text-muted">
          Exports your original GPX track unchanged and adds navigation waypoints only.
          {verifiedCount > 0
            ? ` ${verifiedCount} verified stop${verifiedCount === 1 ? "" : "s"} available.`
            : " No verified stops yet — export will contain the original route only."}
        </p>

        {!report ? (
          <>
            <div className="mt-5 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Format</p>
              {DEVICE_OPTIONS.map((option) => (
                <label
                  key={option.id}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-3 transition ${
                    device === option.id ? "border-accent bg-accent/5" : "border-line bg-canvas"
                  }`}
                >
                  <input
                    type="radio"
                    name="gps-device"
                    checked={device === option.id}
                    onChange={() => setDevice(option.id)}
                    className="mt-1 accent-accent"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-ink">{option.label}</span>
                    <span className="block text-xs text-muted">{option.hint}</span>
                  </span>
                </label>
              ))}
            </div>

            <div className="mt-5 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Waypoints</p>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={verifiedOnly}
                  onChange={(event) => setVerifiedOnly(event.target.checked)}
                  className="accent-accent"
                />
                Verified resupply stops only (default)
              </label>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={includeOptional}
                  onChange={(event) => setIncludeOptional(event.target.checked)}
                  className="accent-accent"
                />
                Include optional stops
              </label>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={includeHighConfidence}
                  onChange={(event) => setIncludeHighConfidence(event.target.checked)}
                  disabled={device === "coros"}
                  className="accent-accent disabled:opacity-50"
                />
                Include high-confidence stops
              </label>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={includeAlternatives}
                  onChange={(event) => setIncludeAlternatives(event.target.checked)}
                  className="accent-accent"
                />
                Include alternatives
              </label>
            </div>

            {device === "coros" ? (
              <CorosExportPreviewPanel
                preview={preview}
                loading={previewLoading}
                error={previewError}
              />
            ) : (
              <p className="mt-4 rounded-xl bg-canvas px-3 py-2 text-xs text-muted">
                Validation runs before download: track point count, distance, ascent, descent, and
                geometry checksum must match the imported GPX. Export is cancelled if the route
                changed.
              </p>
            )}
          </>
        ) : (
          <>
            <p className="mt-3 text-sm text-muted">Export complete. Your GPX file has been downloaded.</p>
            <ExportReportPanel report={report} />
            {device === "coros" ? (
              <GpsExportQrPanel raceId={raceId} raceName={raceName} device="coros" />
            ) : null}
          </>
        )}

        {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={handleClose}
            disabled={loading}
            className="rounded-xl border border-line px-4 py-2 text-sm font-medium text-ink"
          >
            {report ? "Done" : "Cancel"}
          </button>
          {!report ? (
            <button
              type="button"
              onClick={() => void handleExport()}
              disabled={loading || previewLoading || !canExport}
              className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {loading ? "Exporting…" : device === "coros" ? "Export to Coros" : "Export GPX"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
