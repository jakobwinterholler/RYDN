import type { Curve, Curves, Fatigue, FatiguePoint, ZoneSet } from "../../types";
import SectionHeader from "../ui/SectionHeader";
import LineChart from "../ui/LineChart";
import { toClimbingRate, valueAt } from "../ui/curveChartModel";
import CurveCard from "./CurveCard";
import DurabilityChart from "./DurabilityChart";

/** Normalize legacy fatigue payloads (absolute W, 0-indexed hours) to % of hour 1. */
function normalizeFatigue(fatigue: Fatigue): {
  series: FatiguePoint[];
  absUnit: string;
  baselineAbs?: number;
  metric?: string;
} {
  const raw = (fatigue.series ?? []).filter((p) => p.v != null) as FatiguePoint[];
  const isPct = fatigue.unit === "% of hour 1" || raw.some((p) => p.abs != null);
  if (isPct) {
    return {
      series: raw,
      absUnit: fatigue.absUnit ?? "W",
      baselineAbs: fatigue.baselineAbs,
      metric: fatigue.metric,
    };
  }
  // Legacy: v is absolute effort, h is 0-based hour index.
  const baseline = raw.find((p) => p.h === 0)?.v ?? raw[0]?.v;
  if (baseline == null || baseline <= 0) {
    return { series: [], absUnit: fatigue.unit === "m/beat" ? "m/beat" : "W", metric: fatigue.metric };
  }
  const absUnit = fatigue.unit === "m/beat" ? "m/beat" : "W";
  return {
    series: raw.map((p) => ({
      h: p.h + 1, // hour index 0 → end of hour 1
      v: Math.round(((p.v as number) / baseline) * 1000) / 10,
      abs: p.v,
    })),
    absUnit,
    baselineAbs: absUnit === "W" ? Math.round(baseline) : Math.round(baseline * 1000) / 1000,
    metric: fatigue.metric,
  };
}

const POWER = "#1a1a18";
const NP = "#5c5c56";
const MOVING = "#2f5d50";
const ELAPSED = "#8a8a82";
const HR = "#8f3d3d";
const CAD = "#5c6b8a";
const ELEV = "#5c5c56";
const TEMP = "#9a7b2f";

function at(curve: Curve, d: number): number | null {
  return valueAt(curve.points, d);
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

function speedGapMeta(
  moving: Curve,
  elapsed: Curve,
): ((label: string, d: number, v: number | null) => string | null) | undefined {
  if (!moving.available || !elapsed.available) return undefined;
  return (label, d, v) => {
    if (label !== "Moving" || v == null) return null;
    const e = at(elapsed, d);
    if (e == null) return null;
    const gap = v - e;
    if (gap < 0.3) return "Stops barely diluted this window";
    return `${gap.toFixed(1)} km/h lost to stops`;
  };
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
  const fatigueNorm = normalizeFatigue(fatigue);
  const fatigueSeries = fatigueNorm.series;
  const temp = data.temperature;
  const climbRate = data.elevationGain.available
    ? toClimbingRate(data.elevationGain.points)
    : [];
  const hasPower = data.power.available && data.power.points.length > 0;
  const hasSpeed =
    (data.speedMoving.available && data.speedMoving.points.length > 0) ||
    (data.speedElapsed.available && data.speedElapsed.points.length > 0);
  const hasNp = data.np.available && data.np.points.length > 0;
  const hasHr = data.hr.available && data.hr.points.length > 0;
  const hasClimb = climbRate.length > 0;
  const hasCad = data.cadence.available && data.cadence.points.length > 0;
  const hasAnyCurve = hasPower || hasSpeed || hasNp || hasHr || hasClimb || hasCad;

  return (
    <section className="review-page">
      <SectionHeader
        question={data.question}
        title="Curves"
        aside={<span className="pill-muted">best effort · time →</span>}
      />
      <p className="curves-lead">
        Hardest effort you could hold for each duration. Drag across a chart like a timeline — values
        update live — or tap 5m / 20m / 1h…
      </p>

      {!hasAnyCurve && (
        <div className="empty-note">
          No sensor streams produced a curve for this day. Power meters unlock power &amp; NP; GPS
          unlocks speed and climbing rate; a heart-rate strap unlocks HR and drift.
        </div>
      )}

      {hasPower && (
        <CurveCard
          large
          title="Power"
          question="Hardest sustained watts?"
          context="For training, watch 5–20 min. For ultras, 1–4 h tells you if the day was truly aerobic."
          series={[{ label: "Best power", color: POWER, points: data.power.points }]}
          unit=" W"
          height={320}
          preferDuration={1200}
          hint="Every point is your best average power for that window — the classic mean-maximal curve."
        />
      )}

      {hasSpeed && (
        <CurveCard
          large
          title="Pace"
          question="How fast — and what did stopping cost?"
          context="Moving = pedaling only. Elapsed includes stops. The gap is bikepacking reality."
          series={[
            ...(data.speedMoving.available
              ? [{ label: "Moving", color: MOVING, points: data.speedMoving.points }]
              : []),
            ...(data.speedElapsed.available
              ? [{ label: "Elapsed", color: ELAPSED, points: data.speedElapsed.points }]
              : []),
          ]}
          unit=" km/h"
          height={300}
          format={(v) => v.toFixed(1)}
          preferDuration={3600}
          metaFor={speedGapMeta(data.speedMoving, data.speedElapsed)}
          hint={`Best average from ${data.speedMinDurationS ?? 5}s up — shorter GPS spikes are ignored. On a fully moving stretch the lines meet.`}
        />
      )}

      <div className="curve-grid">
        {hasNp && (
          <CurveCard
            title="Normalized Power"
            question="Hardest physiological effort?"
            context="NP weights surges. Use it (not avg watts) for intensity on variable terrain."
            series={[{ label: "Best NP", color: NP, points: data.np.points }]}
            unit=" W"
            preferDuration={1200}
          />
        )}
        {hasClimb && (
          <CurveCard
            title="Climbing rate"
            question="How fast uphill?"
            context="VAM in m/h — packed climbing, not just total metres. Ultras live here."
            series={[{ label: "Climbing rate", color: ELEV, points: climbRate }]}
            unit=" m/h"
            preferDuration={3600}
            format={(v) => `${Math.round(v)}`}
          />
        )}
        {hasHr && (
          <CurveCard
            title="Heart rate"
            question="Highest sustained HR?"
            context="Long-duration HR should stay controlled. Spikes early often mean you went out too hard."
            series={[{ label: "Best HR", color: HR, points: data.hr.points }]}
            unit=" bpm"
            preferDuration={3600}
          />
        )}
        {hasCad && (
          <CurveCard
            title="Cadence"
            question="Highest sustained spin?"
            context="Useful for training form; less critical than power/pace on long days."
            series={[{ label: "Cadence", color: CAD, points: data.cadence.points }]}
            unit=" rpm"
            preferDuration={300}
          />
        )}
      </div>

      {(fatigue.available || data.fade.available || data.hrDrift.available) && (
        <div className="curve-card curve-card--large">
          <div className="curve-card__head">
            <div>
              <div className="curve-card__q">Did the engine hold?</div>
              <div className="curve-card__title">
                Durability
                <span className="curve-card__unit">% of hour 1</span>
              </div>
              <p className="curve-card__context">
                Best short effort each hour vs your first hour — 100% means you still match that
                early punch. Below 100% is the fade.
              </p>
            </div>
            {fatigue.available && fatigueNorm.metric ? (
              <span className="pill-muted">
                {fatigueNorm.metric}
                {fatigueNorm.baselineAbs != null
                  ? ` · hour 1 = ${fatigueNorm.baselineAbs} ${fatigueNorm.absUnit}`
                  : ""}
              </span>
            ) : null}
          </div>
          {fatigue.available && fatigueSeries.length >= 2 && (
            <DurabilityChart
              series={fatigueSeries}
              absUnit={fatigueNorm.absUnit}
              baselineAbs={fatigueNorm.baselineAbs}
              height={240}
              color={POWER}
            />
          )}
          {fatigue.insight && <div className="curve-card__hint">{fatigue.insight}</div>}
          {!fatigue.available && (
            <div className="curve-card__hint">
              Need ~2+ hours with power (or speed + HR) for the durability curve. Half-ride fade
              and HR drift still summarise the day below.
            </div>
          )}
          <div className="mini-metrics">
            {data.fade.available && (
              <div className="mini-metric">
                <span className="mini-metric__v">
                  {data.fade.pct != null && data.fade.pct > 0 ? "−" : ""}
                  {Math.abs(data.fade.pct ?? 0)}%
                </span>
                <span className="mini-metric__l">
                  power fade
                  {data.fade.firstHalf != null && data.fade.secondHalf != null
                    ? ` (${data.fade.firstHalf}→${data.fade.secondHalf} W)`
                    : ""}
                </span>
              </div>
            )}
            {data.hrDrift.available && (
              <div className="mini-metric">
                <span className="mini-metric__v">{data.hrDrift.pct}%</span>
                <span className="mini-metric__l">
                  HR drift
                  {data.hrDrift.firstHalfHr != null && data.hrDrift.secondHalfHr != null
                    ? ` (${data.hrDrift.firstHalfHr}→${data.hrDrift.secondHalfHr} bpm)`
                    : (data.hrDrift.pct ?? 0) >= 6
                      ? " · rising cost late"
                      : " · aerobic hold"}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {temp.available && temp.series && temp.series.length > 0 && (
        <div className="curve-card">
          <div className="curve-card__head">
            <div>
              <div className="curve-card__q">What conditions?</div>
              <div className="curve-card__title">
                Temperature
                <span className="curve-card__unit">°C</span>
              </div>
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
          <div className="curve-card__axis-note">Distance (km) →</div>
        </div>
      )}

      {(data.zones.power.available || data.zones.hr.available) && (
        <div className="curve-grid">
          {data.zones.power.available && (
            <div className="curve-card">
              <div className="curve-card__head">
                <div>
                  <div className="curve-card__q">Where did watts live?</div>
                  <div className="curve-card__title">Power zones</div>
                  <p className="curve-card__context">
                    Estimated from this ride’s best 20 min (FTP ≈ 95%). Endurance days should stack
                    Z2.
                  </p>
                </div>
              </div>
              <ZoneBars set={data.zones.power} accent={POWER} />
            </div>
          )}
          {data.zones.hr.available && (
            <div className="curve-card">
              <div className="curve-card__head">
                <div>
                  <div className="curve-card__q">Where did heart rate live?</div>
                  <div className="curve-card__title">HR zones</div>
                  <p className="curve-card__context">
                    Based on max HR seen today — honest, not a lab test. Useful for pacing checks.
                  </p>
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
