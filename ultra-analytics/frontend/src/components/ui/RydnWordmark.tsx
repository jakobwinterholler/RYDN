/** RYDN.BIKE wordmark — user's exported Subtract.svg paths (currentColor fill only). */

import wordmarkSvg from "../../assets/rydn-wordmark.svg?raw";

interface Props {
  className?: string;
  title?: string;
  /** Intrinsic width hint; height follows viewBox aspect. */
  width?: number;
}

export default function RydnWordmark({
  className,
  title = "RYDN.BIKE",
  width = 187,
}: Props) {
  const height = Math.round((width * 60) / 374);
  return (
    <span
      className={className}
      role="img"
      aria-label={title}
      style={{ display: "inline-flex", width, height, color: "currentColor" }}
      dangerouslySetInnerHTML={{
        __html: wordmarkSvg.replace(
          /<svg\b([^>]*)>/,
          `<svg$1 width="${width}" height="${height}" aria-hidden="true">`,
        ),
      }}
    />
  );
}
