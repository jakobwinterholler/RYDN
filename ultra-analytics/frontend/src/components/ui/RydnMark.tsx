import { RYDN_FAV_R } from "../../assets/rydn-paths";

/** RYDN brand mark — Figma notched geometric italic R. */

interface Props {
  size?: number;
  className?: string;
  title?: string;
}

/**
 * Standalone notched R. Favicon-tuned path for 16×16 recognition:
 * forward lean, heavy stems, open bowl, horizontal right-side notch.
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
      <path fill="currentColor" fillRule="evenodd" d={RYDN_FAV_R} />
    </svg>
  );
}
