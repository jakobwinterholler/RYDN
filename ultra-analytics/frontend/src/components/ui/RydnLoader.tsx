/** Calm editorial loading mark — route-line drawing to a terminal dot. */

interface Props {
  label?: string;
  className?: string;
}

/** Horizontal route with the R-leg’s S-jog — draws left → terminal. */
const ROUTE =
  "M14 24 H52 C60 24 64 18 72 20 C80 22 84 24 106 24";

export default function RydnLoader({ label = "Loading…", className = "" }: Props) {
  return (
    <div className={`rydn-loader ${className}`.trim()} role="status" aria-live="polite">
      <svg
        className="rydn-loader__svg"
        viewBox="0 0 120 48"
        width="120"
        height="48"
        aria-hidden
      >
        {/* Ghost trail + end terminal */}
        <circle className="rydn-loader__end" cx="106" cy="24" r="3.1" fill="currentColor" />
        <path
          className="rydn-loader__trail"
          d={ROUTE}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={100}
        />
        {/* Drawn route */}
        <path
          className="rydn-loader__draw"
          d={ROUTE}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.85"
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={100}
        />
        {/* Start terminal — always present */}
        <circle className="rydn-loader__start" cx="14" cy="24" r="3.1" fill="currentColor" />
        {/* Arriving terminal pulse */}
        <circle className="rydn-loader__arrive" cx="106" cy="24" r="3.1" fill="currentColor" />
      </svg>
      {label ? <p className="rydn-loader__label">{label}</p> : null}
    </div>
  );
}
