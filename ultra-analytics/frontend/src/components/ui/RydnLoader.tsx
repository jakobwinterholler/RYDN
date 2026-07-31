/** Calm ~1s loader: route line draws, then resolves into RYDN wordmark. */

interface Props {
  label?: string;
  className?: string;
}

/** Soft route path — elevation-like journey, not a spinner. */
const ROUTE = "M14 28 C36 28 42 18 62 22 C82 26 88 32 118 28 C132 26 140 28 154 28";

/**
 * Direction #9 secondary wordmark paths (from assets/brand/wordmark.svg).
 * viewBox-aligned via transform for the loader canvas.
 */
const WM = {
  r: "M0 0L50 0C74 0 83.88 12 80.36 32C77.54 48 64.13 56 40.13 56L54.37 100L30.37 100L17.07 62L9.07 62L2.37 100L-17.63 100ZM17.53 14L45.53 14C59.53 14 62.47 20 60.36 32C58.24 44 53.54 48 39.54 48L11.54 48Z",
  y: "M74 0L98 0L105.18 50L142 0L166 0L115.77 58L108.37 100L88.37 100L95.77 58Z",
  d: "M154 0L200 0C232 0 244.47 20 239.18 50C233.89 80 214.37 100 182.37 100L136.37 100ZM171.18 16L197.18 16C221.18 16 222.71 30 219.18 50C215.66 70 209.19 84 185.19 84L159.19 84Z",
  n: "M236 0L256 0L246.83 52L304 0L324 0L306.37 100L286.37 100L295.54 48L238.37 100L218.37 100Z",
};

export default function RydnLoader({ label = "Loading…", className = "" }: Props) {
  return (
    <div className={`rydn-loader ${className}`.trim()} role="status" aria-live="polite">
      <svg
        className="rydn-loader__svg"
        viewBox="0 0 168 56"
        width="168"
        height="56"
        aria-hidden
      >
        <path
          className="rydn-loader__trail"
          d={ROUTE}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle className="rydn-loader__end" cx="154" cy="28" r="2.8" fill="currentColor" />

        <path
          className="rydn-loader__draw"
          d={ROUTE}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={100}
        />
        <circle className="rydn-loader__start" cx="14" cy="28" r="2.8" fill="currentColor" />
        <circle className="rydn-loader__arrive" cx="154" cy="28" r="2.8" fill="currentColor" />

        <g className="rydn-loader__wordmark" transform="translate(6,8) scale(0.45)">
          <path fill="currentColor" fillRule="evenodd" d={WM.r} />
          <path fill="currentColor" fillRule="evenodd" d={WM.y} />
          <path fill="currentColor" fillRule="evenodd" d={WM.d} />
          <path fill="currentColor" fillRule="evenodd" d={WM.n} />
        </g>
      </svg>
      {label ? <p className="rydn-loader__label">{label}</p> : null}
    </div>
  );
}
