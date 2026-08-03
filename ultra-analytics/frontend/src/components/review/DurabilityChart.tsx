import { useCallback, useEffect, useId, useMemo, useState } from "react";
import type { FatiguePoint } from "../../types";
import { niceCeil, yTicks } from "../ui/curveChartModel";
import { clientXToViewBoxX, useChartScrub } from "../ui/useChartScrub";

interface Props {
  series: FatiguePoint[];
  /** Absolute unit for readout, e.g. "W". */
  absUnit?: string;
  /** First-hour baseline absolute (shown in caption / chips). */
  baselineAbs?: number;
  height?: number;
  color?: string;
}

const DESKTOP_W = 860;
const DESKTOP_PAD = { l: 40, r: 14, t: 18, b: 28 };
const MOBILE_PAD = { l: 36, r: 10, t: 16, b: 32 };
const REF = 100; // % of hour 1

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

function fmtHour(h: number): string {
  if (Number.isInteger(h)) return `${h}h`;
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  if (mins === 0) return `${whole}h`;
  if (mins === 60) return `${whole + 1}h`;
  return `${whole}h ${mins}m`;
}

function fmtAbs(v: number, unit: string): string {
  if (unit === "W") return `${Math.round(v)} ${unit}`;
  return `${v.toFixed(3)} ${unit}`;
}

function nearestSample(series: FatiguePoint[], h: number): FatiguePoint | null {
  if (!series.length) return null;
  let best = series[0];
  let bestDist = Math.abs(series[0].h - h);
  for (let i = 1; i < series.length; i++) {
    const dist = Math.abs(series[i].h - h);
    if (dist < bestDist) {
      best = series[i];
      bestDist = dist;
    }
  }
  return best;
}

function interpolateAt(series: FatiguePoint[], h: number): FatiguePoint | null {
  const pts = [...series].sort((a, b) => a.h - b.h);
  if (!pts.length) return null;
  if (h <= pts[0].h) return pts[0];
  const last = pts[pts.length - 1];
  if (h >= last.h) return last;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (h > b.h) continue;
    const t = (h - a.h) / (b.h - a.h || 1);
    const absA = a.abs;
    const absB = b.abs;
    let abs: number | null = null;
    if (absA != null && absB != null) abs = absA + t * (absB - absA);
    else abs = absA ?? absB ?? null;
    return { h, v: a.v + t * (b.v - a.v), abs };
  }
  return last;
}

/** Catmull-Rom → cubic Bézier for a few hourly points (smooth, not axis-heavy). */
function smoothLinePath(
  pts: { x: number; y: number }[],
): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  if (pts.length === 2) {
    return `M${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} L${pts[1].x.toFixed(1)} ${pts[1].y.toFixed(1)}`;
  }
  let d = `M${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

/** Hours → % of hour 1, with scrubbing and a subtle 100% guide. */
export default function DurabilityChart({
  series,
  absUnit = "W",
  baselineAbs,
  height = 220,
  color = "#1a1a18",
}: Props) {
  const narrow = useIsNarrow();
  const fillId = `durability-fill-${useId().replace(/:/g, "")}`; // unique gradient per mount

  const layout = useMemo(() => {
    const pad = narrow ? MOBILE_PAD : DESKTOP_PAD;
    const chartH = narrow ? Math.max(210, Math.min(height, 260)) : height;
    return { pad, chartH, W: DESKTOP_W, stroke: narrow ? 3.2 : 2.6 };
  }, [narrow, height]);

  const sorted = useMemo(() => [...series].sort((a, b) => a.h - b.h), [series]);

  const [selectedH, setSelectedH] = useState<number | null>(() =>
    sorted.length ? sorted[Math.floor(sorted.length / 2)].h : null,
  );

  useEffect(() => {
    if (!sorted.length) {
      setSelectedH(null);
      return;
    }
    if (selectedH == null) {
      setSelectedH(sorted[Math.floor(sorted.length / 2)].h);
      return;
    }
    const lo = sorted[0].h;
    const hi = sorted[sorted.length - 1].h;
    if (selectedH < lo || selectedH > hi) {
      setSelectedH(sorted[Math.floor(sorted.length / 2)].h);
    }
  }, [sorted, selectedH]);

  const model = useMemo(() => {
    if (sorted.length < 2) return null;
    const { pad, chartH, W } = layout;
    const hLo = sorted[0].h;
    const hHi = sorted[sorted.length - 1].h;
    const vals = sorted.map((p) => p.v);
    const rawMin = Math.min(REF, ...vals);
    const rawMax = Math.max(REF, ...vals);
    const span = Math.max(8, rawMax - rawMin);
    const vLo = Math.max(0, rawMin - span * 0.14);
    const vHi = niceCeil(rawMax + span * 0.1);
    const sx = (h: number) =>
      pad.l + ((h - hLo) / (hHi - hLo || 1)) * (W - pad.l - pad.r);
    const sy = (v: number) =>
      pad.t + (1 - (v - vLo) / (vHi - vLo || 1)) * (chartH - pad.t - pad.b);
    return {
      hLo,
      hHi,
      vLo,
      vHi,
      sx,
      sy,
      ticks: yTicks(vLo, vHi, narrow ? 3 : 4),
      pad,
      chartH,
      W,
    };
  }, [sorted, layout, narrow]);

  const hourChips = useMemo(() => {
    if (!model) return [] as number[];
    const { hLo, hHi } = model;
    const whole = new Set<number>();
    for (const p of sorted) {
      const h = Math.round(p.h);
      if (h >= Math.ceil(hLo) && h <= Math.floor(hHi)) whole.add(h);
    }
    whole.add(Math.round(hLo));
    whole.add(Math.round(hHi));
    return Array.from(whole)
      .filter((h) => h >= hLo - 0.01 && h <= hHi + 0.01)
      .sort((a, b) => a - b);
  }, [sorted, model]);

  const onScrub = useCallback(
    (clientX: number, surface: HTMLElement) => {
      if (!model) return;
      const { pad, W, hLo, hHi } = model;
      const px = clientXToViewBoxX(clientX, surface, W);
      if (px == null) return;
      const innerW = W - pad.l - pad.r;
      const t = Math.max(0, Math.min(1, (px - pad.l) / (innerW || 1)));
      setSelectedH(hLo + t * (hHi - hLo));
    },
    [model],
  );

  const { surfaceRef, scrubHandlers } = useChartScrub(onScrub);

  if (!model) {
    return (
      <div className="curve-empty">
        Need at least two hours of continuous data to plot durability vs the first hour.
      </div>
    );
  }

  const { hLo, hHi, sx, sy, ticks, pad, chartH, W } = model;
  const plotTop = pad.t;
  const plotBot = chartH - pad.b;

  const xy = sorted.map((p) => ({ x: sx(p.h), y: sy(p.v) }));
  const linePath = smoothLinePath(xy);
  const area =
    xy.length >= 2
      ? `${linePath} L${xy[xy.length - 1].x.toFixed(1)} ${plotBot} L${xy[0].x.toFixed(1)} ${plotBot} Z`
      : "";

  const selectedPx = selectedH != null ? sx(selectedH) : null;
  const sample = selectedH != null ? interpolateAt(sorted, selectedH) : null;
  const xticks = hourChips.filter((h) => h >= hLo && h <= hHi);
  // Sparse x labels on mobile so hours don't crowd.
  const xLabelEvery = narrow && xticks.length > 6 ? 2 : 1;
  const activeChipH =
    selectedH != null
      ? hourChips.reduce<number | null>((best, h) => {
          if (best == null) return h;
          return Math.abs(h - selectedH) < Math.abs(best - selectedH) ? h : best;
        }, null)
      : null;

  return (
    <div className={`curve durability-chart${narrow ? " curve--mobile" : ""}`}>
      {sample && (
        <div className="curve-hero" role="status">
          <div className="curve-hero__main">
            <span className="curve-hero__num">{Math.round(sample.v)}</span>
            <span className="curve-hero__unit">%</span>
          </div>
          <div className="curve-hero__dur">
            <span className="curve-hero__dur-label">At</span>
            <span className="curve-hero__dur-value">{fmtHour(sample.h)}</span>
          </div>
          <p className="curve-hero__meta">
            {sample.abs != null
              ? `${fmtAbs(sample.abs, absUnit)}${
                  baselineAbs != null ? ` · hour 1 was ${fmtAbs(baselineAbs, absUnit)}` : ""
                }`
              : "vs first-hour punch"}
          </p>
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
            <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.2} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>

          {/* Minimal guides — not an axis-heavy mess */}
          {ticks.map((v, i) => {
            const showLabel = i === 0 || i === ticks.length - 1 || Math.abs(v - REF) < 0.01;
            return (
              <g key={i}>
                <line
                  x1={pad.l}
                  x2={W - pad.r}
                  y1={sy(v)}
                  y2={sy(v)}
                  stroke="rgba(26,26,24,0.05)"
                  strokeWidth={1}
                />
                {showLabel && (
                  <text x={pad.l - 6} y={sy(v) + 4} className="curve-axis" textAnchor="end">
                    {Math.round(v)}%
                  </text>
                )}
              </g>
            );
          })}

          {/* 100% = first-hour baseline — subtle */}
          <line
            x1={pad.l}
            x2={W - pad.r}
            y1={sy(REF)}
            y2={sy(REF)}
            stroke="rgba(47,93,80,0.4)"
            strokeWidth={1.25}
            strokeDasharray="4 5"
          />
          <text
            x={W - pad.r}
            y={sy(REF) - 7}
            className="curve-axis durability-chart__ref"
            textAnchor="end"
          >
            100%
          </text>

          {xticks.map((h, i) =>
            i % xLabelEvery === 0 ? (
              <text key={h} x={sx(h)} y={chartH - 8} className="curve-axis" textAnchor="middle">
                {fmtHour(h)}
              </text>
            ) : null,
          )}

          {area && <path d={area} fill={`url(#${fillId})`} stroke="none" />}
          <path
            d={linePath}
            fill="none"
            stroke={color}
            strokeWidth={layout.stroke}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

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

          {sample && selectedH != null && (
            <g>
              <circle
                cx={sx(selectedH)}
                cy={sy(sample.v)}
                r={(narrow ? 7 : 5.5) + 4}
                fill={color}
                opacity={0.16}
              />
              <circle
                cx={sx(selectedH)}
                cy={sy(sample.v)}
                r={narrow ? 7 : 5.5}
                fill={color}
                stroke="#F7F6F3"
                strokeWidth={2}
              />
            </g>
          )}
        </svg>

        <div
          ref={surfaceRef}
          className="curve__scrub"
          {...scrubHandlers}
          role="slider"
          aria-label="Scrub durability through the ride"
          aria-valuemin={hLo}
          aria-valuemax={hHi}
          aria-valuenow={selectedH ?? hLo}
          aria-valuetext={sample ? `${Math.round(sample.v)}% at ${fmtHour(sample.h)}` : undefined}
          tabIndex={0}
          onKeyDown={(e) => {
            if (selectedH == null) return;
            const step = (hHi - hLo) * (e.shiftKey ? 0.08 : 0.03);
            if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
              e.preventDefault();
              setSelectedH(Math.max(hLo, selectedH - step));
            } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
              e.preventDefault();
              setSelectedH(Math.min(hHi, selectedH + step));
            } else if (e.key === "Home") {
              e.preventDefault();
              setSelectedH(hLo);
            } else if (e.key === "End") {
              e.preventDefault();
              setSelectedH(hHi);
            }
          }}
        />
      </div>

      <p className="curve-scrub-hint">Drag to scrub hours · 100% = first-hour baseline</p>

      {hourChips.length > 0 && (
        <div className="chips curve-anchors" role="list" aria-label="Hours into ride">
          {hourChips.map((h) => {
            const p = nearestSample(sorted, h);
            const active = activeChipH === h;
            return (
              <button
                key={h}
                type="button"
                role="listitem"
                className={`chip curve-chip${active ? " curve-chip--active" : ""}`}
                aria-pressed={active}
                onClick={() => setSelectedH(h)}
              >
                <span className="chip__k">{fmtHour(h)}</span>
                <span className="chip__v">
                  {p != null ? Math.round(p.v) : "—"}
                  {p != null ? <span className="chip__unit">%</span> : null}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
