import type { RouteInsights } from "./routeInsights";
import { formatKm } from "./routeInsights";

interface RouteSummaryStripProps {
  distanceKm: number;
  elevationGainM: number;
  climbCount: number;
  suggestedStopCount: number;
  verifiedPercent: number;
  insights: RouteInsights;
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-[96px]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight text-ink">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export default function RouteSummaryStrip({
  distanceKm,
  elevationGainM,
  climbCount,
  suggestedStopCount,
  verifiedPercent,
  insights,
}: RouteSummaryStripProps) {
  return (
    <section className="rounded-3xl bg-card px-6 py-5 shadow-soft">
      <div className="flex flex-wrap items-start gap-x-10 gap-y-5">
        <Metric label="Distance" value={formatKm(distanceKm, 0)} />
        <Metric label="Elevation" value={`+${Math.round(elevationGainM)} m`} />
        <Metric label="Climbs" value={String(climbCount)} />
        <Metric
          label="Suggested stops"
          value={String(suggestedStopCount)}
          hint={suggestedStopCount > 0 ? `~${formatKm(distanceKm / suggestedStopCount, 0)} apart` : undefined}
        />
        <Metric
          label="Verified"
          value={`${verifiedPercent}%`}
          hint={verifiedPercent < 100 ? "Not all reviewed yet" : "All stops reviewed"}
        />
        <Metric
          label="Longest unsupported"
          value={insights.longestGapKm > 0 ? formatKm(insights.longestGapKm, 0) : "—"}
          hint={
            insights.longestGap
              ? `${formatKm(insights.longestGap.startKm, 0)} → ${formatKm(insights.longestGap.endKm, 0)}`
              : undefined
          }
        />
      </div>
    </section>
  );
}
