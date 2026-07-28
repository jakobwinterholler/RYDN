import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import type { CurvePoint } from "../../types";

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
}

const DESKTOP_W = 860;
const DESKTOP_PAD = { l: 46, r: 16, t: 14, b: 30 };
const MOBILE_PAD = { l: 42, r: 12, t: 12, b: 36 };

function fmtDur(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  const h = s / 3600;
  return Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`;
}

/** Round a positive ceiling up to a clean axis bound (e.g. 47 → 50, 12.3 → 15). */
function niceCeil(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 1;
  const exp = Math.floor(Math.log10(v));
  const f = v / 10 ** exp;
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nf * 10 ** exp;
}

function yTicks(vLo: number, vHi: number, count = 4): number[] {
  if (vHi <= vLo) return [vLo];
  const step = (vHi - vLo) / (count - 1);
  return Array.from({ length: count }, (_, i) => vLo + step * i).reverse();
}

/** Canonical axis labels — matches backend DURATIONS (5s → 8h). */
const TICK_D = [5, 15, 30, 60, 300, 1200, 3600, 7200, 14400, 28800];

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

/** A log-time best-effort curve. Multiple series overlay (e.g. moving vs elapsed
 * speed); pointer reveals every series' value at that duration. Mobile-first:
 * larger type, sticky readouts, and touch-friendly hit targets. */
export default function CurveChart({ series, unit = "", height = 300, format }: Props) {
  const ref = useRef<SVGSVGElement>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [pinned, setPinned] = useState(false);
  const narrow = useIsNarrow();
  const fmtV = format ?? ((v: number) => `${Math.round(v)}`);

  const layout = useMemo(() => {
    const pad = narrow ? MOBILE_PAD : DESKTOP_PAD;
    const chartH = narrow ? Math.max(280, height) : height;
    const W = DESKTOP_W;
    return { pad, chartH, W, stroke: narrow ? 3 : 2.4, hitR: narrow ? 14 : 8 };
  }, [narrow, height]);

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
    const vHi = niceCeil(rawMax * 1.05 || 1);
    const lx = (d: number) => Math.log10(Math.max(1, d));
    const sx = (d: number) =>
      pad.l + ((lx(d) - lx(dLo)) / (lx(dHi) - lx(dLo) || 1)) * (W - pad.l - pad.r);
    const sy = (v: number) =>
      pad.t + (1 - (v - vLo) / (vHi - vLo || 1)) * (chartH - pad.t - pad.b);
    return { dLo, dHi, vLo, vHi, sx, sy, ticks: yTicks(vLo, vHi), pad, chartH, W };
  }, [series, layout]);

  if (!model) {
    return (
      <div className="curve-empty">
        Nothing to plot yet — this ride has no samples for this metric. Re-sync the activity or upload a
        file that includes the stream.
      </div>
    );
  }

  const { dLo, dHi, sx, sy, ticks, pad, chartH, W } = model;
  const xticks = TICK_D.filter((d) => d >= dLo && d <= dHi);

  const allD = Array.from(
    new Set(series.flatMap((s) => s.points.map((p) => p.d)).filter((d) => d >= 5)),
  ).sort((a, b) => a - b);

  const pickDuration = (clientX: number) => {
    const svg = ref.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * W;
    let best = allD[0];
    let bestDist = Infinity;
    for (const d of allD) {
      const dist = Math.abs(sx(d) - px);
      if (dist < bestDist) {
        bestDist = dist;
        best = d;
      }
    }
    setHoverX(best);
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === "touch" && pinned) return;
    pickDuration(e.clientX);
  };

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    pickDuration(e.clientX);
    if (e.pointerType === "touch") setPinned(true);
  };

  const onPointerLeave = () => {
    if (!pinned) setHoverX(null);
  };

  const hoverPx = hoverX != null ? sx(hoverX) : null;
  const tipLeftPct = hoverPx != null ? Math.min(92, Math.max(8, (hoverPx / W) * 100)) : 50;

  return (
    <div className={`curve${narrow ? " curve--mobile" : ""}`}>
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${chartH}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerMove={onPointerMove}
        onPointerDown={onPointerDown}
        onPointerLeave={onPointerLeave}
        role="img"
        className="curve__svg"
      >
        {/* Invisible hit area for easier touch */}
        <rect
          x={pad.l}
          y={pad.t}
          width={W - pad.l - pad.r}
          height={chartH - pad.t - pad.b}
          fill="transparent"
        />

        {ticks.map((v, i) => (
          <g key={i}>
            <line
              x1={pad.l}
              x2={W - pad.r}
              y1={sy(v)}
              y2={sy(v)}
              stroke="rgba(26,26,24,0.08)"
              strokeWidth={1}
            />
            <text x={pad.l - 8} y={sy(v) + 4} className="curve-axis" textAnchor="end">
              {fmtV(v)}
            </text>
          </g>
        ))}

        {xticks.map((d) => (
          <text key={d} x={sx(d)} y={chartH - 10} className="curve-axis" textAnchor="middle">
            {fmtDur(d)}
          </text>
        ))}

        {hoverPx != null && (
          <line
            x1={hoverPx}
            x2={hoverPx}
            y1={pad.t}
            y2={chartH - pad.b}
            stroke="rgba(26,26,24,0.28)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}

        {series.map((s) => {
          const pts = [...s.points].filter((p) => p.d >= 5).sort((a, b) => a.d - b.d);
          if (pts.length === 0) return null;
          const d = pts
            .map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.d).toFixed(1)} ${sy(p.v).toFixed(1)}`)
            .join(" ");
          return (
            <g key={s.label}>
              <path
                d={d}
                fill="none"
                stroke={s.color}
                strokeWidth={layout.stroke}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {/* Wider invisible stroke for touch targeting */}
              <path
                d={d}
                fill="none"
                stroke="transparent"
                strokeWidth={layout.hitR}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {hoverX != null &&
                (() => {
                  const hp = pts.find((p) => p.d === hoverX);
                  if (!hp) return null;
                  return (
                    <circle
                      cx={sx(hp.d)}
                      cy={sy(hp.v)}
                      r={narrow ? 6 : 4}
                      fill={s.color}
                      stroke="#F7F6F3"
                      strokeWidth={1.5}
                    />
                  );
                })()}
            </g>
          );
        })}
      </svg>

      {hoverX != null && (
        <div
          className={`curve-tip${narrow ? " curve-tip--docked" : ""}`}
          style={narrow ? undefined : { left: `${tipLeftPct}%` }}
          role="status"
        >
          <div className="curve-tip__d">{fmtDur(hoverX)}</div>
          {series.map((s) => {
            const hp = s.points.find((p) => p.d === hoverX);
            return (
              <div key={s.label} className="curve-tip__series">
                <div className="curve-tip__label">
                  <span className="curve-tip__dot" style={{ background: s.color }} aria-hidden />
                  {s.label}
                </div>
                <div className="curve-tip__value">
                  {hp ? (
                    <>
                      <span className="curve-tip__num">{fmtV(hp.v)}</span>
                      {unit ? <span className="curve-tip__unit">{unit}</span> : null}
                    </>
                  ) : (
                    <span className="curve-tip__num">—</span>
                  )}
                </div>
                <div className="curve-tip__meta">Best effort</div>
              </div>
            );
          })}
          {narrow && pinned && (
            <button
              type="button"
              className="curve-tip__clear"
              onClick={() => {
                setPinned(false);
                setHoverX(null);
              }}
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}
