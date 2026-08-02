import { useEffect, useState } from "react";
import { getUltra, getUltraAnalysis } from "../api";
import type {
  UltraAnalysis,
  UltraAggregation,
  UltraDayHours,
  UltraDetail,
} from "../types";
import CurveCard from "./review/CurveCard";
import Icon from "./ui/Icon";
import LineChart from "./ui/LineChart";
import MetricCard from "./ui/MetricCard";
import RydnLoader from "./ui/RydnLoader";
import { cleanDayTitle, cleanUltraTitle } from "./ui/titles";
import { fmtDuration, fmtNumber } from "./ui/format";

interface Props {
  ultraId: string;
  onBack: () => void;
  onOpenRide: (rideId: string) => void;
}

/**
 * How did I ride this expedition?
 * One stitched Ultra — not N separate day reviews (those stay one tap away).
 */
export default function UltraAnalyticsPage({ ultraId, onBack, onOpenRide }: Props) {
  const [detail, setDetail] = useState<UltraDetail | null>(null);
  const [analysis, setAnalysis] = useState<UltraAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([getUltra(ultraId), getUltraAnalysis(ultraId)])
      .then(([d, a]) => {
        if (cancelled) return;
        setDetail(d);
        setAnalysis(a);
      })
      .catch((e) => !cancelled && setError((e as Error).message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [ultraId]);

  if (error && !analysis) {
    return (
      <div className="ultra-page ultra-analytics">
        <header className="ultra-page__nav">
          <button type="button" className="icon-btn" onClick={onBack} aria-label="Back">
            <Icon name="chevronLeft" size={22} />
          </button>
        </header>
        <div className="space-loading">{error}</div>
      </div>
    );
  }

  if (loading || !detail || !analysis) {
    return (
      <div className="app-loading">
        <RydnLoader label="Building trip analytics…" />
      </div>
    );
  }

  const title = cleanUltraTitle(detail.ultra.name);
  const agg = analysis.aggregation;
  const avail = analysis.availability || {};

  return (
    <div className="ultra-page ultra-analytics">
      <header className="ultra-page__nav">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="Back to trip">
          <Icon name="chevronLeft" size={22} />
        </button>
      </header>

      <header className="ultra-analytics__head">
        <p className="ultra-analytics__eyebrow">{title}</p>
        <h1 className="ultra-analytics__title">Analytics</h1>
        <p className="ultra-analytics__lead">How you rode this expedition.</p>
      </header>

      {analysis.status === "empty" && (
        <p className="ua-empty">
          {analysis.message ||
            "Add at least one day to this trip, then open Analytics again — reports build from member rides."}
        </p>
      )}

      {analysis.status === "needs_data" && (
        <div className="ua-empty ua-empty--box">
          <p>{analysis.message}</p>
          <ul className="ua-empty__days">
            {(analysis.missingActivityIds || []).map((id) => {
              const day = detail.days.find((d) => d.id === id);
              return (
                <li key={id}>
                  <button type="button" className="btn btn--secondary" onClick={() => onOpenRide(id)}>
                    Open {day ? `Day ${day.dayIndex}` : "day"}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {(analysis.status === "ready" || analysis.status === "ready_with_warnings") && agg && (
        <>
          {analysis.status === "ready_with_warnings" && analysis.message && (
            <p className="ua-warn" role="status">
              {analysis.message}
            </p>
          )}

          <OverviewSection agg={agg} />
          <PacingSection analysis={analysis} />
          <ElevationSection analysis={analysis} agg={agg} />
          <PerformanceSection analysis={analysis} avail={avail} />

          <section className="ua-block">
            <h2 className="ua-block__title">Days</h2>
            <p className="ua-block__lead">Open a single day only when you need its detail.</p>
            <ul className="analytics-day-list">
              {analysis.dayHours.map((day) => (
                <li key={`day-${day.dayIndex}-${(day.activityIds || [day.activityId]).join("-")}`}>
                  <button type="button" className="analytics-day" onClick={() => onOpenRide(day.activityId)}>
                    <span className="analytics-day__day">Day {day.dayIndex}</span>
                    <span className="analytics-day__name">{cleanDayTitle(day.name)}</span>
                    <span className="analytics-day__meta">
                      {day.date || "—"} · {fmtDuration(day.movingTimeS)} moving
                      {(day.recordingCount ?? 1) > 1
                        ? ` · ${day.recordingCount} recordings`
                        : ""}
                    </span>
                    <Icon name="chevronRight" size={18} className="analytics-day__chevron" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

function OverviewSection({ agg }: { agg: UltraAggregation }) {
  return (
    <section className="ua-block">
      <h2 className="ua-block__title">Overview</h2>
      <p className="ua-block__lead">
        {agg.ridingDays} riding day{agg.ridingDays === 1 ? "" : "s"}
        {agg.startDate && agg.finishDate ? ` · ${agg.startDate} → ${agg.finishDate}` : ""}
      </p>
      <div className="ua-metrics">
        <MetricCard label="Distance" value={fmtNumber(Math.round(agg.distanceKm))} unit="km" />
        <MetricCard label="Elevation" value={fmtNumber(agg.elevationGainM)} unit="m" />
        <MetricCard
          label="Trip elapsed"
          value={fmtDuration(agg.elapsedTimeS)}
          sub="first start → last finish"
        />
        <MetricCard
          label="Ride elapsed"
          value={fmtDuration(agg.rideElapsedTimeS ?? 0)}
          sub="sum of day elapsed"
        />
        <MetricCard label="Moving time" value={fmtDuration(agg.movingTimeS)} sub="sum of moving" />
        <MetricCard
          label="Avg speed"
          value={agg.avgSpeedKmh.toFixed(1)}
          unit="km/h"
          sub="vs trip elapsed"
        />
        <MetricCard
          label="Moving average"
          value={agg.avgMovingSpeedKmh.toFixed(1)}
          unit="km/h"
          sub="riding only"
        />
        <MetricCard label="Stopped" value={fmtDuration(agg.stoppedTimeS)} sub="Trip elapsed − moving" />
        <MetricCard
          label="Avg gradient"
          value={agg.avgGradientPct.toFixed(2)}
          unit="%"
          sub="ascent / distance"
        />
        {agg.maxElevationM != null && (
          <MetricCard label="Max elevation" value={fmtNumber(agg.maxElevationM)} unit="m" />
        )}
        {agg.minElevationM != null && (
          <MetricCard label="Min elevation" value={fmtNumber(agg.minElevationM)} unit="m" />
        )}
      </div>
    </section>
  );
}

function PacingSection({ analysis }: { analysis: UltraAnalysis }) {
  const ledger = analysis.timeLedger;
  const days = analysis.dayHours;
  const maxMoving = Math.max(...days.map((d) => d.movingTimeS), 1);

  return (
    <section className="ua-block">
      <h2 className="ua-block__title">Pacing</h2>
      <p className="ua-block__lead">
        Moving across the trip. Trip elapsed includes overnight; ride elapsed is day totals only.
      </p>

      {ledger && ledger.buckets?.length > 0 ? (
        <div className="ua-ledger">
          <div className="ledger-bar" aria-hidden>
            {ledger.buckets.map((b) => (
              <div
                key={b.label}
                className="ledger-seg"
                style={{ width: `${b.pct}%`, background: b.color }}
                title={`${b.label} — ${b.label_duration}`}
              />
            ))}
          </div>
          <div className="ledger-list">
            {ledger.buckets.map((b) => (
              <div className="ledger-item" key={b.label}>
                <span className="ledger-swatch" style={{ background: b.color }} />
                <span className="ledger-item__label">{b.label}</span>
                <span className="ledger-item__t">{b.label_duration}</span>
                <span className="ledger-item__pct">{b.pct}%</span>
              </div>
            ))}
          </div>
          {ledger.insight && <p className="ua-insight">{ledger.insight}</p>}
        </div>
      ) : (
        <p className="ua-empty">
          Not enough timing data to build a time ledger. Days need moving and elapsed times from synced
          or uploaded activities.
        </p>
      )}

      {days.length > 0 && (
        <div className="ua-dayhours">
          <h3 className="ua-block__sub">Riding hours per day</h3>
          {days.map((d) => (
            <DayHourRow key={d.activityId} day={d} maxMoving={maxMoving} />
          ))}
        </div>
      )}

      {analysis.availability?.stops && analysis.stops && analysis.stops.count > 0 ? (
        <div className="ua-stops">
          <h3 className="ua-block__sub">Stops</h3>
          <p className="ua-insight">
            {analysis.stops.count} stops · {fmtDuration(analysis.stops.totalStoppedS)} stopped
            {analysis.stops.insight ? ` — ${analysis.stops.insight}` : ""}
          </p>
        </div>
      ) : (
        <p className="ua-empty">
          No significant stops were classified. Longer rests appear after day streams are analyzed —
          open a day Review to inspect stop detail.
        </p>
      )}
    </section>
  );
}

function DayHourRow({ day, maxMoving }: { day: UltraDayHours; maxMoving: number }) {
  const pct = Math.max(4, Math.round((day.movingTimeS / maxMoving) * 100));
  return (
    <div className="ua-dayhour">
      <div className="ua-dayhour__label">
        <span>Day {day.dayIndex}</span>
        <span>{fmtDuration(day.movingTimeS)}</span>
      </div>
      <div className="ua-dayhour__track" aria-hidden>
        <div className="ua-dayhour__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function ElevationSection({
  analysis,
  agg,
}: {
  analysis: UltraAnalysis;
  agg: UltraAggregation;
}) {
  const perf = analysis.performance;
  const elev = perf?.elevation?.series;
  const axis = perf?.axisKm;
  const climbs = analysis.climbs?.climbs || [];
  const hasProfile = Boolean(axis && elev && elev.some((v) => v != null));

  return (
    <section className="ua-block">
      <h2 className="ua-block__title">Elevation</h2>
      <p className="ua-block__lead">
        {fmtNumber(agg.elevationGainM)} m ascent · {fmtNumber(agg.elevationLossM)} m descent
      </p>

      {hasProfile && axis && elev ? (
        <div className="ua-chart">
          <LineChart x={axis} y={elev} color="#1a1a18" height={160} fill unit="m" />
        </div>
      ) : (
        <p className="ua-empty">
          No elevation profile was recorded. Re-sync days that include altitude, or upload FIT / GPX
          with elevation.
        </p>
      )}

      {climbs.length > 0 ? (
        <div className="ua-climbs">
          <h3 className="ua-block__sub">Climbing distribution</h3>
          <p className="ua-insight">
            {climbs.length} classified climb{climbs.length === 1 ? "" : "s"} across the expedition.
          </p>
          <ul className="ua-climb-list">
            {climbs.slice(0, 8).map((c, i) => (
              <li key={`${c.startKm}-${i}`} className="ua-climb">
                <span>
                  {c.startKm.toFixed(0)}–{c.endKm.toFixed(0)} km
                </span>
                <span>{fmtNumber(c.gainM)} m</span>
                <span>{c.avgGradient != null ? `${c.avgGradient.toFixed(1)}%` : "—"}</span>
              </li>
            ))}
          </ul>
          {climbs.length > 8 && (
            <p className="ua-empty">+{climbs.length - 8} more climbs in the full dataset.</p>
          )}
        </div>
      ) : (
        <p className="ua-empty">
          No climbs met the significance threshold across these days. Sustained rises show once elevation
          streams are present.
        </p>
      )}
    </section>
  );
}

function PerformanceSection({
  analysis,
  avail,
}: {
  analysis: UltraAnalysis;
  avail: Record<string, boolean>;
}) {
  const curves = analysis.curves;
  const speed = curves?.speedMoving;
  const power = curves?.power;
  const hr = curves?.hr;
  const cadence = curves?.cadence;

  return (
    <section className="ua-block">
      <h2 className="ua-block__title">Performance</h2>
      <p className="ua-block__lead">Best efforts across the whole trip.</p>

      {speed?.available && speed.points.length > 0 ? (
        <CurveCard
          title="Speed duration"
          question="How fast could you sustain?"
          series={[{ label: "Moving", color: "#1a1a18", points: speed.points }]}
          unit="km/h"
          height={180}
          format={(v) => v.toFixed(1)}
        />
      ) : (
        <p className="ua-empty">
          No speed duration curve yet. Speed comes from GPS or wheel sensors on member days — re-sync if
          streams are missing.
        </p>
      )}

      {avail.power && power?.available && power.points.length > 0 ? (
        <CurveCard
          title="Power duration"
          question="What power could you hold?"
          series={[{ label: "Power", color: "#1a1a18", points: power.points }]}
          unit="W"
          height={180}
          format={(v) => `${Math.round(v)}`}
        />
      ) : (
        <p className="ua-empty">
          No power data on these days. Pair a power meter on future rides, or re-import activities that
          include watts.
        </p>
      )}

      {avail.heartRate && hr?.available && hr.points.length > 0 ? (
        <CurveCard
          title="Heart rate duration"
          series={[{ label: "HR", color: "#1a1a18", points: hr.points }]}
          unit="bpm"
          height={160}
          format={(v) => `${Math.round(v)}`}
        />
      ) : (
        <p className="ua-empty">
          No heart rate data on these days. Wear a strap or optical sensor on future rides, then re-sync.
        </p>
      )}

      {avail.cadence && cadence?.available && cadence.points.length > 0 ? (
        <CurveCard
          title="Cadence duration"
          series={[{ label: "Cadence", color: "#1a1a18", points: cadence.points }]}
          unit="rpm"
          height={160}
          format={(v) => `${Math.round(v)}`}
        />
      ) : (
        <p className="ua-empty">
          No cadence data on these days. Cadence sensors or pedals with cadence unlock this curve after
          re-sync.
        </p>
      )}
    </section>
  );
}
