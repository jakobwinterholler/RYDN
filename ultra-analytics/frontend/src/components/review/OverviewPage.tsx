import type { Overview } from "../../types";
import SectionHeader from "../ui/SectionHeader";
import { fmtDuration, fmtNumber } from "../ui/format";

function Stat({
  label,
  value,
  unit,
  sub,
  accent,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className={`overview-stat${accent ? " overview-stat--accent" : ""}`}>
      <div className="overview-stat__label">{label}</div>
      <div className="overview-stat__value">
        {value}
        {unit ? <span className="overview-stat__unit">{unit}</span> : null}
      </div>
      {sub ? <div className="overview-stat__sub">{sub}</div> : null}
    </div>
  );
}

export default function OverviewPage({ data }: { data: Overview }) {
  const showPower = data.hasPower && (data.npW != null || data.avgPowerW != null);
  const hikeHeavy = data.hasHike && data.pctClimbOnFoot >= 8;
  const stopHeavy = data.movingPct < 75 && data.distanceKm >= 60;

  return (
    <section className="review-page overview-page">
      <SectionHeader
        question={data.question || "How did the day go?"}
        title="Expedition day"
      />

      {data.insight ? <p className="overview-insight overview-insight--lead">{data.insight}</p> : null}

      <div className="overview-band" aria-label="Distance and elevation">
        <Stat label="Distance" value={fmtNumber(Math.round(data.distanceKm))} unit="km" accent />
        <Stat label="Climbing" value={fmtNumber(data.elevationGainM)} unit="m" />
        <Stat
          label="Moving"
          value={fmtDuration(data.movingTimeS)}
          sub={`${Math.round(data.movingPct)}% of day`}
        />
        <Stat
          label="Elapsed"
          value={fmtDuration(data.elapsedTimeS)}
          sub={stopHeavy ? `${fmtDuration(data.stoppedTimeS)} stopped` : "clock time"}
        />
      </div>

      <div className="overview-band overview-band--secondary" aria-label="Pace">
        <Stat
          label="Riding speed"
          value={data.avgSpeedMovingKmh.toFixed(1)}
          unit="km/h"
          sub="moving only"
        />
        <Stat
          label="Day speed"
          value={data.avgSpeedElapsedKmh.toFixed(1)}
          unit="km/h"
          sub="incl. stops"
        />
        {data.avgTempC != null && (
          <Stat
            label="Temperature"
            value={`${data.avgTempC}`}
            unit="°C"
            sub={data.maxTempC != null ? `max ${data.maxTempC}°C` : undefined}
          />
        )}
        {hikeHeavy && (
          <Stat
            label="On foot"
            value={`${Math.round(data.pctClimbOnFoot)}`}
            unit="%"
            sub={`${fmtNumber(Math.round(data.hikeDistanceKm * 10) / 10)} km hike-a-bike`}
          />
        )}
      </div>

      {showPower && (
        <div className="overview-band overview-band--power" aria-label="Power">
          {data.npW != null && (
            <Stat label="Normalized Power" value={`${data.npW}`} unit="W" accent />
          )}
          {data.avgPowerW != null && (
            <Stat label="Avg power" value={`${data.avgPowerW}`} unit="W" sub="riding" />
          )}
        </div>
      )}
    </section>
  );
}
