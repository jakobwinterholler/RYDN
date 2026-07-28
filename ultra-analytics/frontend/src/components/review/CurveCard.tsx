import type { ReactNode } from "react";
import CurveChart, { type CurveSeries } from "../ui/CurveChart";

interface Props {
  title: string;
  question?: string;
  hint?: string;
  series: CurveSeries[];
  unit?: string;
  height?: number;
  format?: (v: number) => string;
  footer?: ReactNode;
  large?: boolean;
}

/** A framed best-effort curve with its question and a takeaway hint. */
export default function CurveCard({
  title,
  question,
  hint,
  series,
  unit,
  height,
  format,
  footer,
  large,
}: Props) {
  const hasData = series.some((s) => s.points.length > 0);
  return (
    <div className={`curve-card${large ? " curve-card--large" : ""}`}>
      <div className="curve-card__head">
        <div>
          {question && <div className="curve-card__q">{question}</div>}
          <div className="curve-card__title">{title}</div>
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
        <CurveChart series={series} unit={unit} height={height} format={format} />
      ) : (
        <div className="curve-empty">
          This curve needs recorded sensor data for this day. Open Analysis once power, heart rate, or
          speed streams are present on the activity.
        </div>
      )}
      {hint && hasData && <div className="curve-card__hint">{hint}</div>}
      {footer && hasData && <div className="curve-card__footer">{footer}</div>}
    </div>
  );
}
