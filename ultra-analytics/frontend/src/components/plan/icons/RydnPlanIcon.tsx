/** React SVG icons for Quick Actions + sheets — same family as map sprites. */

import type { PlanIconId, PlanIconVariant } from "./types";
import { PLAN_ICON_PATHS } from "./glyphs";

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
  const stroke = variant === "filled" ? 1.9 : variant === "selected" ? 2.05 : 1.55;
  const filled = variant === "filled" || variant === "selected";

  return (
    <svg
      className={`rydn-plan-icon rydn-plan-icon--${variant} ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled && (id === "waterFountain" || id === "verified") ? "currentColor" : "none"}
      stroke="currentColor"
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
