/// <reference types="vite/client" />

/** Canonical metric order: distance → elevation → elapsed (RYDN_DESIGN §0.1 / §11). */
export interface ScoreLineProps {
  distanceKm: number;
  elevationGainM: number;
  durationS: number;
  className?: string;
  /** Planned routes have no elapsed time — hide the third metric. */
  hideDuration?: boolean;
}

function fmtKm(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function fmtElev(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** Race / Ultra elapsed on the score line — for Ultras this is wall-clock
 * (first start → last finish), never the sum of ride elapsed or moving time. */
export function fmtElapsed(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h >= 24) {
    const d = Math.floor(h / 24);
    return `${d}d ${h % 24}h ${m.toString().padStart(2, "0")}m`;
  }
  if (h >= 1) return `${h}h ${m.toString().padStart(2, "0")}m`;
  return `${m}m`;
}

/**
 * Score line — the only way primary metrics may appear together.
 * Order is locked: distance · elevation · elapsed.
 */
export default function ScoreLine({
  distanceKm,
  elevationGainM,
  durationS,
  className = "",
  hideDuration = false,
}: ScoreLineProps) {
  return (
    <div
      className={`score-line ${className}`.trim()}
      aria-label={
        hideDuration ? "Distance and elevation" : "Distance, elevation, and elapsed time"
      }
    >
      <span className="score-line__item">
        <span className="score-line__v">{fmtKm(distanceKm)}</span>
        <span className="score-line__u">km</span>
      </span>
      <span className="score-line__sep" aria-hidden="true">
        ·
      </span>
      <span className="score-line__item">
        <span className="score-line__v">{fmtElev(elevationGainM)}</span>
        <span className="score-line__u">m</span>
      </span>
      {!hideDuration && (
        <>
          <span className="score-line__sep" aria-hidden="true">
            ·
          </span>
          <span className="score-line__item">
            <span className="score-line__v">{fmtElapsed(durationS)}</span>
          </span>
        </>
      )}
    </div>
  );
}
