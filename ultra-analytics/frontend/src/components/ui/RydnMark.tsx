/** RYDN brand mark — user's HighQuality square logo (img, not redrawn paths). */

interface Props {
  size?: number;
  className?: string;
  title?: string;
}

export default function RydnMark({ size = 24, className, title = "RYDN" }: Props) {
  return (
    <img
      className={className}
      src="/brand/mark-192.png"
      width={size}
      height={size}
      alt={title}
      draggable={false}
    />
  );
}
