/** Data-driven trip traits — route character only; kind & race result live elsewhere on the card. */

import type { IconName } from "../components/ui/Icon";
import type { Ultra } from "../types";

export type TripBadgeId =
  | "multiCountry"
  | "multiDay"
  | "highElev"
  | "longDistance"
  | "alpine"
  | "heat"
  | "coastal";

export interface TripBadge {
  id: TripBadgeId;
  label: string;
  icon: IconName;
  /** Lower = higher priority when capping. */
  priority: number;
}

const ELEV_M = 8000;
const DIST_KM = 1000;
/** m of elev per km — alpine threshold. */
const ALPINE_M_PER_KM = 12;
const MULTI_DAY = 3;

function countryCount(ultra: Ultra): number {
  if (ultra.countryCodes && ultra.countryCodes.length > 0) {
    return ultra.countryCodes.filter((c) => /^[A-Za-z]{2}$/.test(c)).length;
  }
  if (ultra.countryCode && /^[A-Za-z]{2}$/.test(ultra.countryCode)) return 1;
  return 0;
}

/**
 * Character badges only — mountains/vert, borders, multi-day, distance.
 * Kind and race result are shown as dedicated card elements, not chips.
 */
export function candidateTripBadges(ultra: Ultra): TripBadge[] {
  const out: TripBadge[] = [];

  if (countryCount(ultra) >= 2) {
    out.push({ id: "multiCountry", label: "Borders", icon: "pin", priority: 50 });
  }

  const days = ultra.dayCount ?? ultra.activityIds?.length ?? 0;
  if (days >= MULTI_DAY) {
    out.push({ id: "multiDay", label: `${days} days`, icon: "sunrise", priority: 60 });
  }

  const elev = ultra.elevationGainM || 0;
  const dist = ultra.distanceKm || 0;
  if (elev >= ELEV_M) {
    out.push({ id: "highElev", label: "Vert", icon: "summit", priority: 70 });
  }
  if (dist >= DIST_KM) {
    out.push({ id: "longDistance", label: "1000+", icon: "road", priority: 80 });
  }
  if (dist > 0 && elev / dist >= ALPINE_M_PER_KM && elev >= 3000) {
    out.push({ id: "alpine", label: "Alpine", icon: "mountain", priority: 90 });
  }

  // Deferred: coastal (needs geometry), heat (needs member temps on cabinet).
  return out;
}

/** Cap 3 character traits. */
export function selectTripBadges(ultra: Ultra, max = 3): TripBadge[] {
  const candidates = candidateTripBadges(ultra);
  candidates.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  return candidates.slice(0, max);
}
