import { useEffect, useState } from "react";
import type { GpxExportPreview } from "@shared/race/gpsGpxExport";
import type { WaypointExportPriority } from "@shared/race/corosWaypointPriority";

interface GpxExportPreviewResponse {
  route_integrity_passed: boolean;
  track_point_count: number;
  distance_km: number;
  elevation_gain_m: number;
  elevation_descent_m: number;
  verified_poi_count: number;
  waypoint_count: number;
  critical_count: number;
  recommended_count: number;
  optional_count: number;
  exported_count: number;
  waypoints: Array<{
    name: string;
    km: number;
    priority: WaypointExportPriority;
    sym: string | null;
    category: string;
  }>;
  validation_errors: string[];
}

function mapPreviewResponse(response: GpxExportPreviewResponse): GpxExportPreview {
  return {
    routeIntegrityPassed: response.route_integrity_passed,
    trackPointCount: response.track_point_count,
    distanceKm: response.distance_km,
    elevationGainM: response.elevation_gain_m,
    elevationDescentM: response.elevation_descent_m,
    verifiedPoiCount: response.verified_poi_count,
    waypointCount: response.waypoint_count,
    criticalCount: response.critical_count,
    recommendedCount: response.recommended_count,
    optionalCount: response.optional_count,
    exportedCount: response.exported_count,
    waypoints: response.waypoints,
    validationErrors: response.validation_errors,
  };
}

const PRIORITY_STYLE: Record<WaypointExportPriority, string> = {
  critical: "bg-rose-50 text-rose-800 ring-rose-200",
  recommended: "bg-amber-50 text-amber-900 ring-amber-200",
  optional: "bg-slate-50 text-slate-700 ring-slate-200",
};

interface CorosExportPreviewPanelProps {
  preview: GpxExportPreview | null;
  loading: boolean;
  error: string | null;
}

export default function CorosExportPreviewPanel({
  preview,
  loading,
  error,
}: CorosExportPreviewPanelProps) {
  if (loading) {
    return (
      <div className="mt-5 rounded-2xl border border-line bg-canvas px-4 py-6 text-center">
        <p className="text-sm font-medium text-ink">Validating export…</p>
        <p className="mt-1 text-xs text-muted">Checking route integrity and waypoint quality</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
        {error}
      </div>
    );
  }

  if (!preview) {
    return null;
  }

  const integrityLabel = preview.routeIntegrityPassed ? "PASS" : "FAIL";
  const integrityClass = preview.routeIntegrityPassed
    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
    : "border-red-200 bg-red-50 text-red-800";

  return (
    <div className="mt-5 space-y-4">
      <div className={`rounded-2xl border px-4 py-4 ${integrityClass}`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] opacity-70">
              Export integrity
            </p>
            <p className="mt-1 text-2xl font-bold">{integrityLabel}</p>
          </div>
          <div className="text-right text-xs opacity-80">
            <p>{preview.trackPointCount.toLocaleString()} trackpoints</p>
            <p>{preview.distanceKm.toFixed(1)} km · {preview.elevationGainM.toLocaleString()} m↑</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <PreviewStat label="Waypoints" value={preview.exportedCount} />
        <PreviewStat label="Critical" value={preview.criticalCount} accent="text-rose-700" />
        <PreviewStat label="Recommended" value={preview.recommendedCount} accent="text-amber-800" />
        <PreviewStat label="Optional" value={preview.optionalCount} accent="text-slate-600" />
      </div>

      {preview.waypoints.length > 0 ? (
        <div className="rounded-2xl border border-line bg-canvas">
          <p className="border-b border-line px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted">
            Stops on your Coros
          </p>
          <ul className="max-h-48 divide-y divide-line overflow-y-auto">
            {preview.waypoints.map((waypoint) => (
              <li key={`${waypoint.name}-${waypoint.km}`} className="flex items-center gap-3 px-4 py-2.5">
                <span className="min-w-[3.5rem] text-xs font-medium text-muted">
                  km {Math.round(waypoint.km)}
                </span>
                <span className="flex-1 truncate text-sm font-medium text-ink">{waypoint.name}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ring-1 ${PRIORITY_STYLE[waypoint.priority]}`}
                >
                  {waypoint.priority}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="rounded-2xl border border-line bg-canvas px-4 py-3 text-sm text-muted">
          No verified resupply stops match your export settings. You will receive the original route
          only.
        </p>
      )}

      {preview.validationErrors.length > 0 ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {preview.validationErrors.join(" ")}
        </div>
      ) : null}
    </div>
  );
}

function PreviewStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-white px-3 py-3 text-center shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">{label}</p>
      <p className={`mt-1 text-xl font-bold ${accent ?? "text-ink"}`}>{value}</p>
    </div>
  );
}

export function useCorosExportPreview(
  endpoint: string | null,
  enabled: boolean,
): {
  preview: GpxExportPreview | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const [preview, setPreview] = useState<GpxExportPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!enabled || !endpoint) {
      setPreview(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(endpoint)
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => ({ detail: "Preview failed." }));
          throw new Error(typeof body.detail === "string" ? body.detail : "Preview failed.");
        }
        return response.json() as Promise<GpxExportPreviewResponse>;
      })
      .then((data) => {
        if (!cancelled) {
          setPreview(mapPreviewResponse(data));
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setPreview(null);
          setError(err instanceof Error ? err.message : "Preview failed.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [endpoint, enabled, refreshKey]);

  return {
    preview,
    loading,
    error,
    refresh: () => setRefreshKey((value) => value + 1),
  };
}
