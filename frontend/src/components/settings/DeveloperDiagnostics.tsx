import { useMemo } from "react";
import type { RoadbookResult } from "../../api";
import ClimbCandidateTable from "../ClimbCandidateTable";
import DesktopCompanionCompare from "./DesktopCompanionCompare";
import MapStyleEvaluation from "../maps/MapStyleEvaluation";
import PerformanceReport from "../PerformanceReport";
import PoiTable from "../PoiTable";
import SurfaceDiagnosticsPanel from "../SurfaceDiagnosticsPanel";
import { CLIMB_SENSITIVITY_OPTIONS } from "../../planning/climbSensitivity";
import {
  climbConfigForSensitivity,
  type ClimbSensitivity,
} from "../../planning/climbSensitivity";
import type { ClimbDetectionConfig } from "../../planning/types";
import { useSettings } from "../../settings/SettingsContext";

interface DeveloperDiagnosticsProps {
  roadbook: RoadbookResult | null;
  climbConfig: ClimbDetectionConfig;
  onClimbConfigChange: (config: ClimbDetectionConfig) => void;
  onRecalculateClimbs?: () => void;
  recalculating?: boolean;
  raceName?: string;
  raceId?: string | null;
}

export default function DeveloperDiagnostics({
  roadbook,
  climbConfig,
  onClimbConfigChange,
  onRecalculateClimbs,
  recalculating = false,
  raceName,
  raceId = null,
}: DeveloperDiagnosticsProps) {
  const { settings, updatePlanning } = useSettings();

  const climbFields = useMemo(
    () =>
      [
        ["min_elevation_gain_m", "Minimum elevation gain (m)", 10, 500, 10],
        ["min_average_gradient_pct", "Minimum average gradient (%)", 0.5, 15, 0.5],
        ["meaningful_descent_threshold_m", "Meaningful descent threshold (m)", 10, 300, 5],
        ["smoothing_window_m", "Smoothing window (m)", 10, 500, 10],
        ["gradient_threshold_pct", "Gradient threshold (%)", 0.1, 10, 0.1],
        ["rolling_gradient_window_m", "Rolling gradient window (m)", 20, 1000, 10],
      ] as const,
    [],
  );

  function updateField(field: keyof ClimbDetectionConfig, value: number) {
    onClimbConfigChange({ ...climbConfig, [field]: value });
  }

  return (
    <div className="space-y-8">
      <DesktopCompanionCompare raceId={raceId} raceName={raceName} />

      {roadbook && roadbook.route.track_points.length >= 2 && (
        <MapStyleEvaluation
          route={roadbook.route}
          zones={roadbook.resupply_zones}
          climbs={roadbook.climbs}
          raceName={raceName}
          raceKey={raceName ?? "open-race"}
        />
      )}

      {settings && (
        <section className="space-y-3 rounded-2xl bg-card p-5 shadow-soft">
          <h3 className="text-sm font-semibold text-ink">Developer mode</h3>
          <p className="text-sm text-muted">
            Enable debug tools on the Route page (POI debug, climb debug, map evaluation).
          </p>
          <label className="flex items-center gap-3 text-sm text-ink">
            <input
              type="checkbox"
              checked={settings.planning.developer_mode_enabled ?? false}
              onChange={(event) =>
                void updatePlanning({ developer_mode_enabled: event.target.checked })
              }
              className="h-4 w-4 rounded border-line"
            />
            Show developer tools in Route view
          </label>
        </section>
      )}

      {settings && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-ink">Climb detection sensitivity</h3>
          <p className="text-sm text-muted">
            How many climbs are detected. Recalculate after changing sensitivity.
          </p>
          <div className="flex flex-wrap gap-1">
            {CLIMB_SENSITIVITY_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() =>
                  void updatePlanning({
                    climb_sensitivity: option.id as ClimbSensitivity,
                    climb_config: climbConfigForSensitivity(option.id),
                  })
                }
                className={`rounded-lg px-3 py-2 text-sm transition ${
                  settings.planning.climb_sensitivity === option.id
                    ? "bg-accent text-white"
                    : "bg-canvas text-ink hover:bg-line/40"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          {onRecalculateClimbs && (
            <button
              type="button"
              onClick={onRecalculateClimbs}
              disabled={recalculating}
              className="rounded-xl border border-line bg-canvas px-4 py-2 text-sm font-medium text-ink disabled:opacity-60"
            >
              {recalculating ? "Recalculating climbs…" : "Recalculate climbs"}
            </button>
          )}
        </section>
      )}

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-ink">Climb detection parameters</h3>
        <p className="text-sm text-muted">Fine-grained thresholds for debugging climb detection.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {climbFields.map(([field, label, min, max, step]) => (
            <label key={field} className="block text-xs text-muted">
              {label}
              <input
                type="number"
                min={min}
                max={max}
                step={step}
                value={climbConfig[field]}
                onChange={(event) => updateField(field, Number(event.target.value))}
                className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink"
              />
            </label>
          ))}
        </div>
      </section>

      {roadbook?.surface_diagnostics && (
        <SurfaceDiagnosticsPanel diagnostics={roadbook.surface_diagnostics} />
      )}

      {roadbook?.performance_report && roadbook.performance_report.length > 0 && (
        <PerformanceReport
          report={roadbook.performance_report}
          summary={roadbook.performance_summary ?? null}
        />
      )}

      {roadbook && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-ink">Rejected climb candidates</h3>
          <ClimbCandidateTable
            candidates={roadbook.climb_candidates}
            selectedCandidateId={null}
          />
        </section>
      )}

      {roadbook && roadbook.pois.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-ink">All POIs ({roadbook.pois.length})</h3>
          <p className="text-sm text-muted">Raw POI dataset for debugging resupply matching.</p>
          <PoiTable pois={roadbook.pois} selectedPoiKey={null} onSelectPoi={() => undefined} />
        </section>
      )}
    </div>
  );
}
