/** RYDN brand mark — continuous route line terminating in a finish flag. */

interface Props {
  size?: number;
  className?: string;
  title?: string;
}

/**
 * Single-color editorial mark. Tuned for 16×16 recognition:
 * two confident curves → vertical pole → geometric pennant.
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
      {/* Route → pole (one stroke) */}
      <path
        d="M4 21.5C7.8 21.5 8.6 12.2 14.2 12.2c4.6 0 5.4 6.2 9.8 4.2V6.8"
        stroke="currentColor"
        strokeWidth="2.55"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Finish pennant — solid for micro clarity */}
      <path d="M24 6.8L29.2 10.25 24 13.7Z" fill="currentColor" />
    </svg>
  );
}
