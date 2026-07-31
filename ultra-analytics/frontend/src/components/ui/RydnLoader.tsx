import RydnWordmark from "./RydnWordmark";

/** Calm ~1s loader: route line draws, then resolves into RYDN.BIKE wordmark. */

interface Props {
  label?: string;
  className?: string;
}

/** Soft route path — elevation-like journey, not a spinner. */
const ROUTE = "M14 28 C36 28 42 18 62 22 C82 26 88 32 118 28 C132 26 140 28 154 28";

export default function RydnLoader({ label = "Loading…", className = "" }: Props) {
  return (
    <div className={`rydn-loader ${className}`.trim()} role="status" aria-live="polite">
      <div className="rydn-loader__stage">
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
        </svg>
        <div className="rydn-loader__wordmark">
          <RydnWordmark width={150} />
        </div>
      </div>
      {label ? <p className="rydn-loader__label">{label}</p> : null}
    </div>
  );
}
