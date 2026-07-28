/** Calm editorial loading mark — tiny bike tracing a hand-drawn route. */

interface Props {
  label?: string;
  className?: string;
}

const ROUTE =
  "M8 34 C 28 34, 34 14, 52 14 C 70 14, 74 34, 92 30 C 100 28, 106 22, 112 18";

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
        <path
          className="rydn-loader__trail"
          d={ROUTE}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.35"
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={100}
        />
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
        <g className="rydn-loader__bike">
          <animateMotion
            dur="4.2s"
            repeatCount="indefinite"
            rotate="auto"
            path={ROUTE}
            calcMode="spline"
            keyTimes="0;1"
            keySplines="0.4 0 0.2 1"
          />
          <g className="rydn-loader__bike-inner" transform="translate(0,-1)">
            <circle
              className="rydn-loader__wheel"
              cx="-6.5"
              cy="2"
              r="3.1"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
            />
            <circle
              className="rydn-loader__wheel"
              cx="6.5"
              cy="2"
              r="3.1"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
            />
            <path
              d="M-6.5 2 L-1.2 -3.2 L4.2 -3.2 L6.5 2 M-1.2 -3.2 L1.4 0.6 L-6.5 2 M1.4 0.6 L4.2 -3.2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="1.4" cy="0.6" r="1" fill="currentColor" />
          </g>
        </g>
      </svg>
      {label ? <p className="rydn-loader__label">{label}</p> : null}
    </div>
  );
}
