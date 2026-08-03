import { useEffect, useMemo, useState, type ReactNode } from "react";
import CurveChart, { type CurveSeries } from "../ui/CurveChart";
import {
  anchorDurations,
  defaultDuration,
  fmtDur,
  nearestDuration,
  valueAt,
} from "../ui/curveChartModel";

interface Props {
  title: string;
  /** Short plain-language question above the title. */
  question?: string;
  /** One-line endurance context — what “good” looks like. */
  context?: string;
  hint?: string;
  series: CurveSeries[];
  unit?: string;
  height?: number;
  format?: (v: number) => string;
  footer?: ReactNode;
  large?: boolean;
  /** Preferred default duration (seconds), e.g. 3600 for ultra pace. */
  preferDuration?: number;
  /** Extra meta under a series value. */
  metaFor?: (label: string, d: number, v: number | null) => string | null;
  /** Show clickable duration chips from the primary series. */
  showAnchors?: boolean;
}

/** Framed best-effort curve with sticky duration selection and glanceable readout. */
export default function CurveCard({
  title,
  question,
  context,
  hint,
  series,
  unit,
  height,
  format,
  footer,
  large,
  preferDuration,
  metaFor,
  showAnchors = true,
}: Props) {
  const hasData = series.some((s) => s.points.length > 0);
  const primary = series[0]?.points ?? [];
  const anchors = useMemo(() => anchorDurations(primary), [primary]);

  const [selected, setSelected] = useState<number | null>(() => {
    const prefer = preferDuration != null ? [preferDuration] : undefined;
    return defaultDuration(
      anchors.length ? anchors : primary.map((p) => p.d),
      prefer,
    );
  });

  useEffect(() => {
    const prefer = preferDuration != null ? [preferDuration] : undefined;
    const pool = anchors.length ? anchors : primary.map((p) => p.d).filter((d) => d >= 5);
    if (selected == null) {
      setSelected(defaultDuration(pool, prefer));
      return;
    }
    // Keep free scrub positions (any duration in the curve span), not only chips.
    const span = primary.filter((p) => p.d >= 5).map((p) => p.d);
    if (span.length === 0) return;
    const lo = Math.min(...span);
    const hi = Math.max(...span);
    if (selected >= lo && selected <= hi) return;
    setSelected(defaultDuration(pool, prefer));
  }, [anchors, preferDuration, primary, selected]);

  const fmtV = format ?? ((v: number) => `${Math.round(v)}`);
  const activeAnchor = selected != null ? nearestDuration(anchors, selected) : null;

  return (
    <div className={`curve-card${large ? " curve-card--large" : ""}`}>
      <div className="curve-card__head">
        <div>
          {question && <div className="curve-card__q">{question}</div>}
          <div className="curve-card__title">
            {title}
            {unit ? <span className="curve-card__unit">{unit.trim()}</span> : null}
          </div>
          {context && <p className="curve-card__context">{context}</p>}
        </div>
        {series.length > 1 && (
          <div className="curve-card__legend">
            {series.map((s) => (
              <span key={s.label} className="legend-item">
                <span className="legend-swatch" style={{ background: s.color }} />
                {s.label}
              </span>
            ))}
          </div>
        )}
      </div>

      {hasData ? (
        <>
          <CurveChart
            series={series}
            unit={unit}
            height={height}
            format={format}
            selectedDuration={selected}
            onSelectDuration={setSelected}
            preferDuration={preferDuration}
            metaFor={metaFor}
          />
          {showAnchors && anchors.length > 0 && (
            <div className="chips curve-anchors" role="list" aria-label="Duration sets">
              {anchors.map((d) => {
                const v = valueAt(primary, d);
                const active = activeAnchor === d;
                return (
                  <button
                    key={d}
                    type="button"
                    role="listitem"
                    className={`chip curve-chip${active ? " curve-chip--active" : ""}`}
                    aria-pressed={active}
                    onClick={() => setSelected(d)}
                  >
                    <span className="chip__k">{fmtDur(d)}</span>
                    <span className="chip__v">
                      {v != null ? fmtV(v) : "—"}
                      {unit && v != null ? (
                        <span className="chip__unit">{unit.trim()}</span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <div className="curve-empty">
          Needs recorded sensor data for this day. Open Analysis once power, heart rate, or speed
          streams are present on the activity.
        </div>
      )}

      {hint && hasData && <div className="curve-card__hint">{hint}</div>}
      {footer && hasData && <div className="curve-card__footer">{footer}</div>}
    </div>
  );
}
