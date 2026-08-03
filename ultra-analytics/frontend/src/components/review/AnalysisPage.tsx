import type { Report } from "../../types";
import SectionHeader from "../ui/SectionHeader";
import ExpandableCard from "../ui/ExpandableCard";
import LineChart from "../ui/LineChart";
import { fmtDuration } from "../ui/format";
import TimeLedger from "../sections/TimeLedger";
import Stops from "../sections/Stops";
import Climbs from "../sections/Climbs";

export default function AnalysisPage({ report }: { report: Report }) {
  const { performance, climbs, stops, timeLedger } = report;
  const power = performance.power;
  const hr = performance.hr;
  const isRace = report.race.kind === "race";

  return (
    <section className="review-page">
      <SectionHeader
        question="What actually happened?"
        title="Analysis"
        aside={<span className="pill-muted">{isRace ? "ultra ride" : "training ride"}</span>}
      />

      <div className="analysis-stack">
        {/* Time Ledger — the ultra signature, open by default */}
        {timeLedger && (
          <ExpandableCard
            icon="⏱"
            title="Time Ledger"
            summary={`${Math.round(timeLedger.movingPct)}% moving`}
            defaultOpen
          >
            <TimeLedger data={timeLedger} />
          </ExpandableCard>
        )}

        <ExpandableCard
          icon="⏸"
          title="Stops"
          summary={`${stops.count} · ${fmtDuration(stops.totalStoppedS)} stopped`}
          available={stops.count > 0}
        >
          <Stops data={stops} />
        </ExpandableCard>

        <ExpandableCard
          icon="⛰"
          title="Climbs"
          summary={`${climbs.count} climbs`}
          available={climbs.count > 0}
        >
          <Climbs data={climbs} />
        </ExpandableCard>

        <ExpandableCard
          icon="⚡"
          title="Power"
          summary={power?.np ? `NP ${power.np} W` : power?.avg ? `avg ${power.avg} W` : ""}
          available={!!power}
        >
          {power && (
            <div className="analysis-body">
              <LineChart x={performance.axisKm} y={power.series} color="#f97316" height={160} fill />
              <div className="mini-metrics">
                {power.np != null && (
                  <div className="mini-metric">
                    <span className="mini-metric__v">{power.np} W</span>
                    <span className="mini-metric__l">Normalized Power</span>
                  </div>
                )}
                {power.avgRiding != null && (
                  <div className="mini-metric">
                    <span className="mini-metric__v">{power.avgRiding} W</span>
                    <span className="mini-metric__l">avg (riding)</span>
                  </div>
                )}
                {power.max != null && (
                  <div className="mini-metric">
                    <span className="mini-metric__v">{Math.round(power.max)} W</span>
                    <span className="mini-metric__l">max</span>
                  </div>
                )}
                {power.variabilityIndex != null && (
                  <div className="mini-metric">
                    <span className="mini-metric__v">{power.variabilityIndex}</span>
                    <span className="mini-metric__l">variability index</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </ExpandableCard>

        <ExpandableCard
          icon="❤"
          title="Heart Rate"
          summary={hr?.avg ? `avg ${Math.round(hr.avg)} bpm` : ""}
          available={!!hr}
        >
          {hr && (
            <div className="analysis-body">
              <LineChart x={performance.axisKm} y={hr.series} color="#ef4444" height={160} fill />
              <div className="mini-metrics">
                {hr.avg != null && (
                  <div className="mini-metric">
                    <span className="mini-metric__v">{Math.round(hr.avg)} bpm</span>
                    <span className="mini-metric__l">average</span>
                  </div>
                )}
                {hr.max != null && (
                  <div className="mini-metric">
                    <span className="mini-metric__v">{Math.round(hr.max)} bpm</span>
                    <span className="mini-metric__l">max</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </ExpandableCard>
      </div>
    </section>
  );
}
