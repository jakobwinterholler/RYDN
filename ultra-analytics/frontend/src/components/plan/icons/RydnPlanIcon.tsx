/** React SVG icons for Quick Actions + sheets — same family as map sprites. */

import type { PlanIconId, PlanIconVariant } from "./types";
import { PLAN_ICON_MODE, PLAN_ICON_PATHS } from "./glyphs";

interface Props {
  id: PlanIconId;
  size?: number;
  variant?: PlanIconVariant;
  className?: string;
  title?: string;
}

export default function RydnPlanIcon({
  id,
  size = 18,
  variant = "outlined",
  className = "",
  title,
}: Props) {
  const paths = PLAN_ICON_PATHS[id] || PLAN_ICON_PATHS.pin;
  const mode = PLAN_ICON_MODE[id] || "stroke";
  const selected = variant === "selected";
  const filled = variant === "filled" || selected;
  const solid = mode === "solid";

  // Solid primary icons (Water/Shop/Sleep): fill on selected — evenodd for bag handle.
  // Stroke secondary icons: never fill; bold weight outdoors.
  const useFill = filled && solid;
  const stroke = variant === "outlined" ? (solid ? 1.7 : 1.85) : selected ? 2.1 : 2;

  return (
    <svg
      className={`rydn-plan-icon rydn-plan-icon--${variant} ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={useFill ? "currentColor" : "none"}
      fillRule="evenodd"
      clipRule="evenodd"
      stroke={useFill ? "none" : "currentColor"}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title ? <title>{title}</title> : null}
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
