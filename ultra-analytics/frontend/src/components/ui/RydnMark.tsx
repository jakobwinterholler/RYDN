/** RYDN brand mark — Direction #9 geometric italic R. */

interface Props {
  size?: number;
  className?: string;
  title?: string;
}

/**
 * Standalone R from Direction #9. Optically tuned for 16×16 recognition:
 * forward lean, heavy stems, open counter. Uses currentColor.
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
        d="M8.2 4.2H17.8c4.8 0 8.4 2.8 8.4 7.2 0 3.8-2.6 6.4-7 6.8L24.4 27.8h-5.3l-4.7-8.7h-2.8L9.5 27.8H4.8L8.2 4.2zm4 3.8v6.6h4.9c2.2 0 3.5-1.2 3.5-3.3S19.3 8 17.1 8H12.2z"
      />
    </svg>
  );
}
