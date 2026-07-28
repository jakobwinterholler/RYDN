import type { ReactNode } from "react";

interface Props {
  title?: string;
  hint?: string;
  legend?: { label: string; color: string }[];
  children: ReactNode;
}

/** Frames any chart with a title, optional legend and a one-line hint that tells
 * the rider what to look for — the chart never stands alone without meaning. */
export default function ChartContainer({ title, hint, legend, children }: Props) {
  return (
    <div className="chart-frame">
      {(title || legend) && (
        <div className="chart-frame__top">
          {title && <div className="chart-frame__title">{title}</div>}
          {legend && (
            <div className="chart-frame__legend">
              {legend.map((l) => (
                <span key={l.label} className="legend-item">
                  <span className="legend-swatch" style={{ background: l.color }} />
                  {l.label}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      {children}
      {hint && <div className="chart-frame__hint">{hint}</div>}
    </div>
  );
}
