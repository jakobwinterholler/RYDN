import type { Overview } from "../../types";
import MetricCard from "../ui/MetricCard";
import SectionHeader from "../ui/SectionHeader";
import { fmtDuration, fmtNumber } from "../ui/format";

export default function OverviewPage({ data }: { data: Overview }) {
  return (
    <section className="review-page">
      <SectionHeader question={data.question} title="Overview" />

      <div className="metric-grid">
        <MetricCard label="Distance" value={fmtNumber(Math.round(data.distanceKm))} unit="km" />
        <MetricCard label="Elevation" value={fmtNumber(data.elevationGainM)} unit="m" />
        <MetricCard label="Moving time" value={fmtDuration(data.movingTimeS)} />
        <MetricCard label="Elapsed time" value={fmtDuration(data.elapsedTimeS)} sub="this day" />
        <MetricCard
          label="Moving speed"
          value={data.avgSpeedMovingKmh.toFixed(1)}
          unit="km/h"
          sub="riding only"
        />
        <MetricCard
          label="Avg speed"
          value={data.avgSpeedElapsedKmh.toFixed(1)}
          unit="km/h"
          sub="incl. stops"
        />
        {data.hasPower && (
          <MetricCard
            label="Normalized Power"
            value={`${data.npW}`}
            unit="W"
            accent
            sub={data.variabilityIndex ? `VI ${data.variabilityIndex}` : undefined}
          />
        )}
        {data.hasPower && (
          <MetricCard label="Avg power" value={`${data.avgPowerW ?? "—"}`} unit="W" sub="riding" />
        )}
        {data.caloriesKcal != null && (
          <MetricCard label="Calories" value={fmtNumber(data.caloriesKcal)} unit="kcal" />
        )}
        <MetricCard
          label="Temperature"
          value={data.avgTempC != null ? `${data.avgTempC}` : "—"}
          unit={data.avgTempC != null ? "°C" : undefined}
          sub={data.maxTempC != null ? `max ${data.maxTempC}°C` : "no sensor"}
        />
        <MetricCard
          label="Weather"
          value={data.weather ?? "—"}
          sub={data.weather ? undefined : "coming soon"}
        />
      </div>

      <div className="insight-line">{data.insight}</div>
    </section>
  );
}
