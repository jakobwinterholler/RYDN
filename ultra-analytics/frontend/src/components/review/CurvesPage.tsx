import type { Curve, Curves, ZoneSet } from "../../types";
import SectionHeader from "../ui/SectionHeader";
import LineChart from "../ui/LineChart";
import CurveCard from "./CurveCard";

const POWER = "#1a1a18";
const NP = "#5c5c56";
const MOVING = "#2f5d50";
const ELAPSED = "#8a8a82";
const HR = "#8f3d3d";
const CAD = "#5c6b8a";
const ELEV = "#5c5c56";
const TEMP = "#9a7b2f";

function at(curve: Curve, d: number): number | null {
  const p = curve.points.find((x) => x.d === d);
  return p ? p.v : null;
}

function fmtDurShort(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  const h = s / 3600;
  return Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`;
}

function BestChips({ curve, unit }: { curve: Curve; unit: string }) {
  // Highlight chips from the canonical timeline (not every point).
  const keys = [5, 60, 300, 1200, 3600, 14400].filter((d) => at(curve, d) != null);
  if (keys.length === 0) return null;
  return (
    <div className="chips">
      {keys.map((d) => (
        <div className="chip curve-chip" key={d}>
          <span className="chip__k">{fmtDurShort(d)}</span>
          <span className="chip__v">
            {Math.round(at(curve, d) as number)}
            {unit ? ` ${unit}` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

function ZoneBars({ set, accent }: { set: ZoneSet; accent: string }) {
  if (!set.available || !set.zones) return null;
  const total = set.zones.reduce((a, z) => a + z.seconds, 0) || 1;
  return (
    <div className="zones">
      <div className="zones__bar">
        {set.zones.map((z, i) => (
          <div
            key={z.name}
            className="zones__seg"
            style={{
              width: `${(z.seconds / total) * 100}%`,
              background: `color-mix(in srgb, ${accent} ${28 + i * 14}%, #f7f6f3)`,
            }}
            title={`${z.name} · ${z.pct}%`}
          />
        ))}
      </div>
      <div className="zones__rows">
        {set.zones
          .filter((z) => z.pct >= 0.5)
          .map((z, i) => (
            <div className="zones__row" key={z.name}>
              <span
                className="zones__dot"
                style={{ background: `color-mix(in srgb, ${accent} ${28 + i * 14}%, #f7f6f3)` }}
              />
              <span className="zones__name">{z.name}</span>
              <span className="zones__range">{z.range}</span>
              <span className="zones__pct">{z.pct}%</span>
            </div>
          ))}
      </div>
      <div className="zones__basis">
        {set.basis}
        {set.ftpEst ? ` · FTP ≈ ${set.ftpEst} W` : ""}
        {set.maxHrEst ? ` · max HR ≈ ${set.maxHrEst} bpm` : ""}
      </div>
    </div>
  );
}

export default function CurvesPage({ data }: { data: Curves }) {
  if (!data.available) {
    return (
      <section className="review-page">
        <SectionHeader question={data.question} title="Curves" />
        <div className="empty-note">
          This ride is too short for best-effort curves. Longer days with continuous GPS unlock speed,
          power, and heart-rate duration charts here.
        </div>
      </section>
    );
  }

  const fatigue = data.fatigue;
  const fatigueX = fatigue.series?.map((p) => p.h) ?? [];
  const fatigueY = fatigue.series?.map((p) => p.v) ?? [];
  const temp = data.temperature;

  return (
    <section className="review-page">
      <SectionHeader
        question={data.question}
        title="Curves"
        aside={<span className="pill-muted">best-effort · log time axis</span>}
      />

      {/* Flagship: Power Duration Curve */}
      {data.power.available && (
        <CurveCard
          large
          title="Power Duration Curve"
          question="What is my best sustained power at every duration?"
          series={[{ label: "Best power", color: POWER, points: data.power.points }]}
          unit=" W"
          height={340}
          hint="Every point is the hardest you could hold power for that long — the spine of your fitness. Hover to read any duration."
          footer={<BestChips curve={data.power} unit="W" />}
        />
      )}

      {/* Signature: moving vs elapsed speed */}
      {(data.speedMoving.available || data.speedElapsed.available) && (
        <CurveCard
          large
          title="Moving vs Elapsed Speed"
          question="How fast could I ride — and what did stopping cost me?"
          series={[
            { label: "Moving", color: MOVING, points: data.speedMoving.points },
            { label: "Elapsed", color: ELAPSED, points: data.speedElapsed.points },
          ]}
          unit=" km/h"
          height={300}
          format={(v) => v.toFixed(1)}
          hint={`Best average speed starts at ${data.speedMinDurationS ?? 5}s — shorter windows are GPS noise. Spike jumps are capped. The gap between the lines is time off the pedals.`}
        />
      )}

      <div className="curve-grid">
        {data.np.available && (
          <CurveCard
            title="Normalized Power Curve"
            question="Best sustained physiological effort?"
            series={[{ label: "Best NP", color: NP, points: data.np.points }]}
            unit=" W"
          />
        )}
        {data.hr.available && (
          <CurveCard
            title="Heart Rate Curve"
            question="Highest sustained heart rate?"
            series={[{ label: "Best HR", color: HR, points: data.hr.points }]}
            unit=" bpm"
          />
        )}
        {data.elevationGain.available && (
          <CurveCard
            title="Elevation Gain Curve"
            question="Most climbing packed into any window?"
            series={[{ label: "Gain", color: ELEV, points: data.elevationGain.points }]}
            unit=" m"
          />
        )}
        {data.cadence.available && (
          <CurveCard
            title="Cadence Curve"
            question="Highest sustained cadence?"
            series={[{ label: "Cadence", color: CAD, points: data.cadence.points }]}
            unit=" rpm"
          />
        )}
      </div>

      {/* Fatigue */}
      {fatigue.available && (
        <div className="curve-card curve-card--large">
          <div className="curve-card__head">
            <div>
              <div className="curve-card__q">Where did fatigue begin?</div>
              <div className="curve-card__title">Fatigue Curve</div>
            </div>
            <span className="pill-muted">{fatigue.metric}</span>
          </div>
          <LineChart x={fatigueX} y={fatigueY} color={POWER} height={180} fill />
          {fatigue.insight && <div className="curve-card__hint">{fatigue.insight}</div>}
          <div className="mini-metrics">
            {data.fade.available && (
              <div className="mini-metric">
                <span className="mini-metric__v">{data.fade.pct}%</span>
                <span className="mini-metric__l">
                  power fade ({data.fade.firstHalf}→{data.fade.secondHalf} W)
                </span>
              </div>
            )}
            {data.hrDrift.available && (
              <div className="mini-metric">
                <span className="mini-metric__v">{data.hrDrift.pct}%</span>
                <span className="mini-metric__l">HR decoupling</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Temperature over the ride */}
      {temp.available && temp.series && (
        <div className="curve-card">
          <div className="curve-card__head">
            <div>
              <div className="curve-card__q">What conditions did I ride through?</div>
              <div className="curve-card__title">Temperature</div>
            </div>
            <span className="pill-muted">
              {temp.min}–{temp.max}°C · avg {temp.avg}°C
            </span>
          </div>
          <LineChart
            x={temp.series.map((p) => p.km)}
            y={temp.series.map((p) => p.v)}
            color={TEMP}
            height={150}
            fill
          />
        </div>
      )}

      {/* Time in zones */}
      {(data.zones.power.available || data.zones.hr.available) && (
        <div className="curve-grid">
          {data.zones.power.available && (
            <div className="curve-card">
              <div className="curve-card__head">
                <div>
                  <div className="curve-card__q">Where did my power live?</div>
                  <div className="curve-card__title">Time in Power Zones</div>
                </div>
              </div>
              <ZoneBars set={data.zones.power} accent={POWER} />
            </div>
          )}
          {data.zones.hr.available && (
            <div className="curve-card">
              <div className="curve-card__head">
                <div>
                  <div className="curve-card__q">Where did my heart live?</div>
                  <div className="curve-card__title">Time in HR Zones</div>
                </div>
              </div>
              <ZoneBars set={data.zones.hr} accent={HR} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
