import type { AnalysisState } from "../analysis/analysisState";
import { preparationPercent } from "../analysis/racePreparationSteps";
import AnalysisDetailsPanel from "../components/races/AnalysisDetailsPanel";

interface RacePreparingViewProps {
  raceName: string;
  state: AnalysisState;
  startedAt: number;
  onCancel?: () => void;
}

export default function RacePreparingView({
  raceName,
  state,
  startedAt,
  onCancel,
}: RacePreparingViewProps) {
  const percent = preparationPercent(state);
  const analyzing = !state.error && percent < 100;

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col justify-center px-6 py-10">
      <div className="urp-animate-fade-up">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Import</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-ink">{raceName}</h1>

        <div className="mt-8 rounded-2xl border border-line bg-card p-6 shadow-card">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-base font-semibold text-ink">
              {state.error ? "Analysis stopped" : analyzing ? "Analyzing…" : "Ready"}
            </h2>
            <p className="text-sm font-medium tabular-nums text-muted">{percent}%</p>
          </div>

          <div className="mt-4 h-2 overflow-hidden rounded-full bg-canvas">
            <div
              className="h-full rounded-full bg-accent transition-all duration-500 ease-out"
              style={{ width: `${percent}%` }}
            />
          </div>

          {analyzing ? (
            <p className="mt-4 text-sm text-muted">
              {state.currentLabel || "Finding climbs, resupply stops, and preparing your workspace…"}
            </p>
          ) : state.error ? (
            <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
          ) : (
            <p className="mt-4 text-sm text-muted">Opening your race workspace…</p>
          )}
        </div>

        {onCancel && (
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              onClick={onCancel}
              className="text-sm text-muted underline-offset-2 transition hover:text-ink hover:underline"
            >
              {state.error ? "Back to My Races" : "Cancel"}
            </button>
          </div>
        )}

        {import.meta.env.DEV && analyzing && (
          <details className="mt-6 text-center">
            <summary className="cursor-pointer text-xs text-muted">Analysis details</summary>
            <div className="mt-3 text-left">
              <AnalysisDetailsPanel state={state} startedAt={startedAt} />
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
