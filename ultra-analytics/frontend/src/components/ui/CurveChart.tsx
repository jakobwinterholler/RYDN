import { useCallback, useEffect, useId, useMemo, useState } from "react";
import type { CurvePoint } from "../../types";
import {
  CURVE_ANCHORS,
  defaultDuration,
  durationFromX,
  fmtDur,
  interpolateAt,
  niceCeil,
  unionDurations,
  yTicks,
} from "./curveChartModel";
import { clientXToViewBoxX, useChartScrub } from "./useChartScrub";

export interface CurveSeries {
  label: string;
  color: string;
  points: CurvePoint[];
}

interface Props {
  series: CurveSeries[];
  unit?: string;
  height?: number;
  format?: (v: number) => string;
  /** Controlled selected duration (seconds). */
  selectedDuration?: number | null;
  onSelectDuration?: (d: number) => void;
  /** Preferred default when uncontrolled. */
  preferDuration?: number;
  /** Extra line under a series value in the readout. */
  metaFor?: (label: string, d: number, v: number | null) => string | null;
}

const DESKTOP_W = 860;
const DESKTOP_PAD = { l: 40, r: 14, t: 12, b: 28 };
const MOBILE_PAD = { l: 36, r: 10, t: 10, b: 32 };

function useIsNarrow(breakpoint = 720): boolean {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(`(max-width: ${breakpoint}px)`).matches : false,
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const onChange = () => setNarrow(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [breakpoint]);
  return narrow;
}

function fmtReadout(v: number, format?: (v: number) => string): string {
  if (format) return format(v);
  if (Number.isInteger(v) || Math.abs(v) >= 100) return `${Math.round(v)}`;
  return v.toFixed(1);
}

function areaPath(
  pts: CurvePoint[],
  sx: (d: number) => number,
  sy: (v: number) => number,
  plotBot: number,
): string {
  if (pts.length === 0) return "";
  const line = pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.d).toFixed(1)} ${sy(p.v).toFixed(1)}`)
    .join(" ");
  const first = pts[0];
  const last = pts[pts.length - 1];
  return `${line} L${sx(last.d).toFixed(1)} ${plotBot} L${sx(first.d).toFixed(1)} ${plotBot} Z`;
}

/**
 * Log-time best-effort curve with video-timeline scrubbing via an HTML overlay
 * (pointer capture + touch-action:none). Dot + playhead follow; values update live.
 */
export default function CurveChart({
  series,
  unit = "",
  height = 300,
  format,
  selectedDuration,
  onSelectDuration,
  preferDuration,
  metaFor,
}: Props) {
  const narrow = useIsNarrow();
  const gradId = useId().replace(/:/g, "");
  const controlled = selectedDuration !== undefined;

  const layout = useMemo(() => {
    const pad = narrow ? MOBILE_PAD : DESKTOP_PAD;
    const chartH = narrow ? Math.max(220, Math.min(height, 280)) : height;
    const W = DESKTOP_W;
    return { pad, chartH, W, stroke: narrow ? 3.2 : 2.6 };
  }, [narrow, height]);

  const allD = useMemo(
    () => unionDurations(series.map((s) => s.points)),
    [series],
  );

  const preferList = useMemo(
    () => (preferDuration != null ? [preferDuration, ...CURVE_ANCHORS] : undefined),
    [preferDuration],
  );

  const [internalD, setInternalD] = useState<number | null>(() => {
    if (controlled) return selectedDuration ?? null;
    return defaultDuration(allD, preferList);
  });

  useEffect(() => {
    if (controlled) return;
    if (internalD == null) {
      setInternalD(defaultDuration(allD, preferList));
      return;
    }
    if (allD.length === 0) return;
    const lo = allD[0];
    const hi = allD[allD.length - 1];
    if (internalD >= lo && internalD <= hi) return;
    setInternalD(defaultDuration(allD, preferList));
  }, [allD, controlled, internalD, preferList]);

  const selected = controlled ? selectedDuration ?? null : internalD;

  const setSelected = useCallback(
    (d: number) => {
      if (!controlled) setInternalD(d);
      onSelectDuration?.(d);
    },
    [controlled, onSelectDuration],
  );

  const model = useMemo(() => {
    const all = series.flatMap((s) => s.points).filter((p) => p.d >= 5);
    if (all.length === 0) return null;
    const { pad, chartH, W } = layout;
    const ds = all.map((p) => p.d);
    const vs = all.map((p) => p.v);
    const dLo = Math.min(...ds);
    const dHi = Math.max(...ds);
    const rawMax = Math.max(...vs);
    const rawMin = Math.min(...vs);
    const vLo = rawMin >= 0 ? 0 : rawMin;
    const vHi = niceCeil(rawMax * 1.06 || 1);
    const lx = (d: number) => Math.log10(Math.max(1, d));
    const sx = (d: number) =>
      pad.l + ((lx(d) - lx(dLo)) / (lx(dHi) - lx(dLo) || 1)) * (W - pad.l - pad.r);
    const sy = (v: number) =>
      pad.t + (1 - (v - vLo) / (vHi - vLo || 1)) * (chartH - pad.t - pad.b);
    const tickCount = narrow ? 3 : 4;
    return {
      dLo,
      dHi,
      vLo,
      vHi,
      sx,
      sy,
      ticks: yTicks(vLo, vHi, tickCount),
      pad,
      chartH,
      W,
    };
  }, [series, layout, narrow]);

  const onScrub = useCallback(
    (clientX: number, surface: HTMLElement) => {
      if (!model) return;
      const { pad, W, dLo, dHi } = model;
      const px = clientXToViewBoxX(clientX, surface, W);
      if (px == null) return;
      const innerW = W - pad.l - pad.r;
      setSelected(durationFromX(px, dLo, dHi, pad.l, innerW));
    },
    [model, setSelected],
  );

  const { surfaceRef, scrubHandlers } = useChartScrub(onScrub);

  if (!model) {
    return (
      <div className="curve-empty">
        Nothing to plot — this ride has no samples for this metric. Re-sync the activity or upload a
        file that includes the stream.
      </div>
    );
  }

  const { dLo, dHi, sx, sy, ticks, pad, chartH, W } = model;
  const xticks = CURVE_ANCHORS.filter((d) => d >= dLo && d <= dHi);
  const selectedPx = selected != null ? sx(selected) : null;
  const plotTop = pad.t;
  const plotBot = chartH - pad.b;

  const primary = series[0];
  const primaryHp =
    selected != null && primary
      ? interpolateAt(
          primary.points.filter((p) => p.d >= 5),
          selected,
        )
      : null;

  return (
    <div className={`curve${narrow ? " curve--mobile" : ""}`}>
      {selected != null && primaryHp && (
        <div className="curve-hero" role="status">
          <div className="curve-hero__main">
            <span className="curve-hero__num">{fmtReadout(primaryHp.v, format)}</span>
            {unit ? <span className="curve-hero__unit">{unit.trim()}</span> : null}
          </div>
          <div className="curve-hero__dur">
            <span className="curve-hero__dur-label">Best for</span>
            <span className="curve-hero__dur-value">{fmtDur(selected)}</span>
          </div>
          {series.length > 1 && (
            <div className="curve-hero__extra">
              {series.slice(1).map((s) => {
                const hp = interpolateAt(
                  s.points.filter((p) => p.d >= 5),
                  selected,
                );
                const meta = metaFor?.(s.label, selected, hp?.v ?? null) ?? null;
                return (
                  <div key={s.label} className="curve-hero__extra-row">
                    <span className="curve-hero__extra-label">
                      <span
                        className="curve-hero__dot"
                        style={{ background: s.color }}
                        aria-hidden
                      />
                      {s.label}
                    </span>
                    <span className="curve-hero__extra-value">
                      {hp != null ? fmtReadout(hp.v, format) : "—"}
                      {unit && hp != null ? ` ${unit.trim()}` : ""}
                    </span>
                    {meta ? <span className="curve-hero__extra-meta">{meta}</span> : null}
                  </div>
                );
              })}
            </div>
          )}
          {series.length === 1 &&
            metaFor &&
            primary &&
            (() => {
              const meta = metaFor(primary.label, selected, primaryHp.v);
              return meta ? <p className="curve-hero__meta">{meta}</p> : null;
            })()}
        </div>
      )}

      <div className="curve__plot">
        <svg
          viewBox={`0 0 ${W} ${chartH}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-hidden
          className="curve__svg"
        >
          <defs>
            {series.map((s, i) => (
              <linearGradient
                key={`grad-${s.label}`}
                id={`curve-fill-${gradId}-${i}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor={s.color} stopOpacity={0.22} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>

          {ticks.map((v, i) => (
            <g key={i}>
              <line
                x1={pad.l}
                x2={W - pad.r}
                y1={sy(v)}
                y2={sy(v)}
                stroke="rgba(26,26,24,0.06)"
                strokeWidth={1}
              />
              {(i === 0 || i === ticks.length - 1 || !narrow) && (
                <text x={pad.l - 6} y={sy(v) + 4} className="curve-axis" textAnchor="end">
                  {fmtReadout(v, format)}
                </text>
              )}
            </g>
          ))}

          {xticks.map((d) => (
            <text key={d} x={sx(d)} y={chartH - 8} className="curve-axis" textAnchor="middle">
              {fmtDur(d)}
            </text>
          ))}

          {series.map((s, si) => {
            const pts = [...s.points].filter((p) => p.d >= 5).sort((a, b) => a.d - b.d);
            if (pts.length === 0) return null;
            const path = pts
              .map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.d).toFixed(1)} ${sy(p.v).toFixed(1)}`)
              .join(" ");
            const fill = areaPath(pts, sx, sy, plotBot);
            const showFill = si === 0 || series.length === 1;
            return (
              <g key={s.label}>
                {showFill && fill && (
                  <path d={fill} fill={`url(#curve-fill-${gradId}-${si})`} stroke="none" />
                )}
                <path
                  d={path}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={layout.stroke}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </g>
            );
          })}

          {selectedPx != null && (
            <g className="curve-playhead">
              <line
                x1={selectedPx}
                x2={selectedPx}
                y1={plotTop}
                y2={plotBot}
                stroke="rgba(26,26,24,0.14)"
                strokeWidth={narrow ? 4 : 3}
              />
              <line
                x1={selectedPx}
                x2={selectedPx}
                y1={plotTop}
                y2={plotBot}
                stroke="rgba(26,26,24,0.55)"
                strokeWidth={1.25}
              />
              <rect
                x={selectedPx - (narrow ? 6 : 4.5)}
                y={plotTop - 2}
                width={narrow ? 12 : 9}
                height={narrow ? 5 : 4}
                rx={2}
                fill="rgba(26,26,24,0.55)"
              />
            </g>
          )}

          {series.map((s) => {
            const pts = s.points.filter((p) => p.d >= 5);
            const hp = selected != null ? interpolateAt(pts, selected) : null;
            if (!hp || selected == null) return null;
            const cx = sx(selected);
            const cy = sy(hp.v);
            const r = narrow ? 7 : 5.5;
            return (
              <g key={`${s.label}-dot`}>
                <circle cx={cx} cy={cy} r={r + 4} fill={s.color} opacity={0.16} />
                <circle cx={cx} cy={cy} r={r} fill={s.color} stroke="#F7F6F3" strokeWidth={2} />
              </g>
            );
          })}
        </svg>

        <div
          ref={surfaceRef}
          className="curve__scrub"
          {...scrubHandlers}
          role="slider"
          aria-label="Scrub duration on the best-effort curve"
          aria-valuemin={dLo}
          aria-valuemax={dHi}
          aria-valuenow={selected ?? dLo}
          aria-valuetext={selected != null ? `Best for ${fmtDur(selected)}` : undefined}
          tabIndex={0}
          onKeyDown={(e) => {
            if (selected == null) return;
            const span = Math.log10(dHi) - Math.log10(dLo) || 1;
            const step = span * (e.shiftKey ? 0.08 : 0.03);
            const lx = Math.log10(Math.max(1, selected));
            if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
              e.preventDefault();
              setSelected(Math.max(dLo, 10 ** (lx - step)));
            } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
              e.preventDefault();
              setSelected(Math.min(dHi, 10 ** (lx + step)));
            } else if (e.key === "Home") {
              e.preventDefault();
              setSelected(dLo);
            } else if (e.key === "End") {
              e.preventDefault();
              setSelected(dHi);
            }
          }}
        />
      </div>

      <p className="curve-scrub-hint">Drag across the chart · tap a duration below</p>
    </div>
  );
}
