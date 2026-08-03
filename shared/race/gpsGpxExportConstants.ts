/**
 * Coros GPX export v3.0 constants — keep in parity with src/race_gpx_export.py.
 *
 * Coros reads GPX `<sym>` (symbol) and `<type>` (classification) on `<wpt>` elements.
 * There is no universal GPX icon standard; Coros maps common sym strings to native icons.
 */

import {
  buildCorosWaypointLabel,
  type CorosWaypointLabelInput,
} from "./corosWaypointNaming";

export const GPS_GPX_EXPORT_VERSION = "3.0";

export const ROUTE_INTEGRITY_FAILED_MESSAGE =
  "Route integrity verification failed. Export cancelled.";

/** Maximum off-route distance (m) for exportable waypoints. */
export const MAX_WAYPOINT_OFF_ROUTE_M = 500;

export const COROS_WPT_ICONS = [
  "Water",
  "Supplies",
  "Supplies/Fuel",
  "Hazard",
  "Bathroom",
  "Hut",
  "Campsite",
  "Trailfork",
  "Pin",
] as const;

export type CorosWptIcon = (typeof COROS_WPT_ICONS)[number];

export const EXCLUDED_EXPORT_CATEGORY_KEYWORDS = [
  "climb",
  "summit",
  "unsupported",
  "analysis",
  "gap marker",
  "helper",
  "geometry",
  "planning",
  "debug",
  "skipped",
  "marker",
] as const;

export function isInvalidExportName(value: string | null | undefined): boolean {
  if (!value?.trim()) {
    return true;
  }
  const normalized = value.trim();
  const lowered = normalized.toLowerCase();
  if (["unnamed", "stop", "resupply", "resupply stop"].includes(lowered)) {
    return true;
  }
  if (/^checkpoint\s*\d+\.?$/.test(lowered)) {
    return true;
  }
  if (/^(fuel\s*)?station\s*\d+\.?$/.test(lowered)) {
    return true;
  }
  if (/^stop\s*\d+\.?$/.test(lowered)) {
    return true;
  }
  if (lowered.startsWith("carretera")) {
    return true;
  }
  return false;
}

export function resolveCorosWptIcon(input: {
  category: string;
  hasFuel?: boolean;
  hasWater?: boolean;
  hasFood?: boolean;
}): CorosWptIcon {
  const category = input.category.toLowerCase();
  if (
    category.includes("fuel") ||
    category.includes("gas station") ||
    category.includes("gas_station") ||
    input.hasFuel
  ) {
    return "Supplies/Fuel";
  }
  if (
    category.includes("water") ||
    category.includes("drinking") ||
    category.includes("fountain") ||
    input.hasWater
  ) {
    return "Water";
  }
  if (
    category.includes("supermarket") ||
    category.includes("convenience") ||
    category.includes("mini supermarket") ||
    category.includes("small supermarket") ||
    category.includes("cafe") ||
    category.includes("café") ||
    category.includes("coffee") ||
    category.includes("restaurant") ||
    category.includes("fast food") ||
    category.includes("bakery") ||
    category.includes("shop") ||
    (category.includes("bike") && category.includes("shop")) ||
    input.hasFood
  ) {
    return "Supplies";
  }
  if (category.includes("hazard") || category.includes("danger")) {
    return "Hazard";
  }
  if (category.includes("toilet") || category.includes("restroom") || category.includes("bathroom")) {
    return "Bathroom";
  }
  if (category.includes("shelter") || category.includes("hut") || category.includes("refuge")) {
    return "Hut";
  }
  if (category.includes("camp")) {
    return "Campsite";
  }
  if (
    category.includes("crossroad") ||
    category.includes("cross road") ||
    category.includes("junction") ||
    category.includes("trail fork")
  ) {
    return "Trailfork";
  }
  if (category.includes("bike") && category.includes("shop")) {
    return "Supplies";
  }
  return "Pin";
}

/** Emoji prefix for Coros `<name>` — icons use `<sym>` separately. */
export function corosWaypointEmoji(input: {
  category: string;
  hasFuel?: boolean;
  hasWater?: boolean;
  hasFood?: boolean;
}): string {
  const sym = resolveCorosWptIcon(input);
  const category = input.category.toLowerCase();
  const map: Record<CorosWptIcon, string> = {
    Water: "💧",
    Supplies: input.hasFood ? "🛒" : "📦",
    "Supplies/Fuel": "⛽",
    Hazard: "⚠️",
    Bathroom: "🚻",
    Hut: "🏠",
    Campsite: "⛺",
    Trailfork: "🔀",
    Pin: "📍",
  };
  if (sym === "Supplies" && (category.includes("fuel") || category.includes("gas") || input.hasFuel)) {
    return "⛽";
  }
  return map[sym] ?? "📍";
}

export function formatCorosWaypointName(
  input: CorosWaypointLabelInput & { isPrimary?: boolean },
): string {
  const prefix = input.isPrimary === false ? "ALT " : "";
  const emoji = corosWaypointEmoji(input);
  const label = buildCorosWaypointLabel(input);
  return `${prefix}${emoji} ${label}`.trim().slice(0, 32);
}

/** @deprecated Use buildCorosWaypointLabel — kept for tests and gradual migration. */
export function smartPoiLabel(input: CorosWaypointLabelInput): string {
  return buildCorosWaypointLabel(input);
}

export function isExcludedExportCategory(category: string): boolean {
  const lowered = category.toLowerCase();
  return EXCLUDED_EXPORT_CATEGORY_KEYWORDS.some((keyword) => lowered.includes(keyword));
}
