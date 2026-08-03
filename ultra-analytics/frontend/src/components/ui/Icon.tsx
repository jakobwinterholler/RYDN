/** Thin SF-style line icons — one visual language, no emoji / clipart. */

import type { ReactNode } from "react";

export type IconName =
  | "trophy"
  | "mountain"
  | "summit"
  | "road"
  | "flag"
  | "tent"
  | "hotel"
  | "water"
  | "sunrise"
  | "moon"
  | "route"
  | "pin"
  | "pinPlus"
  | "check"
  | "plus"
  | "minus"
  | "edit"
  | "search"
  | "close"
  | "chevronLeft"
  | "chevronRight"
  | "trash"
  | "grip"
  | "share";

interface Props {
  name: IconName;
  size?: number;
  /** Visual weight — cabinet identity marks use medium/semibold. */
  weight?: "regular" | "medium" | "semibold";
  className?: string;
  title?: string;
}

const paths: Record<IconName, ReactNode> = {
  mountain: (
    <path d="M2.5 16.5L8.2 6.8c.3-.5 1-.6 1.4-.2L12 9.2l2.2-2.8c.4-.5 1.2-.4 1.5.2L21.5 16.5H2.5zM9 16.5l3-4.5 3 4.5" />
  ),
  summit: (
    <>
      <path d="M3 18.5L10.2 6.2c.4-.7 1.4-.7 1.8 0L19.5 18.5H3z" />
      <path d="M11.1 9.2l1.4-2.4 1.4 2.4" />
    </>
  ),
  trophy: (
    <>
      <path d="M8 4.5h8v3.2a4 4 0 01-8 0V4.5z" />
      <path d="M8 6H5.5A2.5 2.5 0 008 8.5M16 6h2.5A2.5 2.5 0 0116 8.5" />
      <path d="M12 11.5V14M9.5 19.5h5M10.5 14h3v5.5h-3V14z" />
    </>
  ),
  road: (
    <>
      <path d="M8 3.5L5.5 20.5M16 3.5l2.5 17" />
      <path d="M12 5v2.5M12 11v2.5M12 17v2" />
    </>
  ),
  flag: (
    <>
      <path d="M6 3.5v17" />
      <path d="M6 4.5h9.5l-2 3.2 2 3.3H6" />
    </>
  ),
  /**
   * Bikepacking — bold A-frame tent only (ground + roof + door).
   * Tuned for ~13–16px card labels: thick silhouette, no bedroll/pole clutter.
   */
  tent: (
    <>
      <path d="M3 19.5h18" />
      <path d="M5 19.5L12 4.5l7 15" />
      <path d="M9.75 19.5V13h4.5v6.5" />
    </>
  ),
  hotel: (
    <>
      <path d="M4 19.5V6.5a1 1 0 011-1h8a1 1 0 011 1v13" />
      <path d="M14 10.5h4.5a1 1 0 011 1v8" />
      <path d="M3 19.5h18" />
      <path d="M7.5 9v.01M10.5 9v.01M7.5 12.5v.01M10.5 12.5v.01" />
    </>
  ),
  water: (
    <path d="M12 3.5c0 0-5.5 6.2-5.5 10a5.5 5.5 0 0011 0c0-3.8-5.5-10-5.5-10z" />
  ),
  sunrise: (
    <>
      <path d="M4 16.5h16" />
      <path d="M12 12.5V7M7.5 14.5l-2-2M16.5 14.5l2-2M4.5 19h15" />
      <path d="M7 12.5a5 5 0 0110 0" />
    </>
  ),
  moon: <path d="M16.5 13.2A6.2 6.2 0 019.2 5.2 6.5 6.5 0 1016.5 13.2z" />,
  route: (
    <>
      <circle cx="6" cy="6" r="2.2" />
      <circle cx="18" cy="18" r="2.2" />
      <path d="M8 7.2c2.8 0 3.2 3.3 6 3.3 1.6 0 2.7-.8 4-2" />
    </>
  ),
  pin: (
    <>
      <path d="M12 20.5s-6-5.4-6-10a6 6 0 1112 0c0 4.6-6 10-6 10z" />
      <circle cx="12" cy="10.5" r="2" />
    </>
  ),
  /** Map pin with plus — add/place POI; distinct from zoom + */
  pinPlus: (
    <>
      <path d="M12 20.5s-6-5.4-6-10a6 6 0 1112 0c0 4.6-6 10-6 10z" />
      <path d="M12 7.6v5.8M9.1 10.5h5.8" />
    </>
  ),
  check: <path d="M5 12.5l4.2 4.2L19 7" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  edit: (
    <>
      <path d="M4.5 16.8V19.5H7.2L18.4 8.3a1.9 1.9 0 00-2.7-2.7L4.5 16.8z" />
      <path d="M14.2 6.8l2.7 2.7" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="5.5" />
      <path d="M16 16l3.5 3.5" />
    </>
  ),
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  chevronLeft: <path d="M14.5 5.5L8.5 12l6 6.5" />,
  chevronRight: <path d="M9.5 5.5L15.5 12l-6 6.5" />,
  trash: (
    <>
      <path d="M5 8h14M9.5 8V5.5h5V8M7.5 8l.8 11h7.4l.8-11" />
    </>
  ),
  grip: (
    <>
      <path d="M9 7.5h.01M15 7.5h.01M9 12h.01M15 12h.01M9 16.5h.01M15 16.5h.01" />
    </>
  ),
  share: (
    <>
      <circle cx="18" cy="5.5" r="2.2" />
      <circle cx="6" cy="12" r="2.2" />
      <circle cx="18" cy="18.5" r="2.2" />
      <path d="M8.1 11.1l7.8-4.2M8.1 12.9l7.8 4.2" />
    </>
  ),
};

export default function Icon({ name, size = 20, weight = "regular", className = "", title }: Props) {
  const strokeWidth = weight === "semibold" ? 2.15 : weight === "medium" ? 1.9 : 1.55;
  return (
    <svg
      className={`icon ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title ? <title>{title}</title> : null}
      {paths[name]}
    </svg>
  );
}
