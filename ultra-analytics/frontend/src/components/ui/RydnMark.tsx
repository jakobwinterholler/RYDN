/** RYDN brand mark — typographic R; leg becomes a route line + terminal dot. */

interface Props {
  size?: number;
  className?: string;
  title?: string;
}

/**
 * Direction B mark. Tuned for 16×16 recognition:
 * editorial serif stem + bowl; route-leg stroke; solid terminal.
 * Uses currentColor.
 */
export default function RydnMark({ size = 24, className, title = "RYDN" }: Props) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M5.4 3.35H17.5c4.85 0 8.05 2.85 8.05 7.1 0 3.9-2.75 6.55-7.15 7H9.85V27.15h1.7v1.3H5.4v-1.3h1.65V4.65H5.4V3.35zm4.45 2.45v8.35h7.1c2.55 0 4.1-1.45 4.1-3.7 0-2.3-1.55-3.65-4.1-3.65h-7.1z"
      />
      <path
        d="M15.2 17.45c2.05 1.75 2.9 4.35 4.35 6.3 1.45 2 3.85 3.1 6.95 2.3"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="26.6" cy="25.9" r="2.15" fill="currentColor" />
    </svg>
  );
}
