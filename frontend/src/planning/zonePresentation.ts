import type { ResupplyZone } from "../api";
import { zoneHasCategory } from "../components/routeInsights";
import { selectPlanningHubs } from "./planningHubSelection";
import type { TimeMode, ZoneDensityMode } from "./types";

const MEDIUM_DETOUR_M = 150;
const VERY_SMALL_DETOUR_M = 75;

const ACCESSIBILITY_SCORE: Record<string, number> = {
  good: 4,
  caution: 3,
  warning: 2,
  bad: 1,
};

export function zoneScore(zone: ResupplyZone): number {
  let score = zone.poi_count * 2;
  score += ACCESSIBILITY_SCORE[zone.accessibility_tone] ?? 0;
  if (zoneHasCategory(zone, "food")) score += 25;
  if (zoneHasCategory(zone, "water")) score += 20;
  if (zoneHasCategory(zone, "fuel")) score += 10;
  return score;
}

export function zoneIsNightUseful(zone: ResupplyZone): boolean {
  return zone.categories.some((category) => {
    if (!category.primary) {
      return false;
    }
    if (category.key === "water") {
      return true;
    }
    return (
      category.primary.night_usability === "usually_available" ||
      category.primary.night_usability === "depends_on_hours"
    );
  });
}

export function zoneMinDetourM(zone: ResupplyZone): number {
  const distances = zone.categories
    .flatMap((category) => [category.primary, ...category.alternatives])
    .filter((option) => option !== null)
    .map((option) => option!.distance_off_route_m);
  return distances.length > 0 ? Math.min(...distances) : 9999;
}

function isEasyMinimalStop(zone: ResupplyZone): boolean {
  const detour = zoneMinDetourM(zone);
  if (detour >= MEDIUM_DETOUR_M) {
    return false;
  }
  if (zone.accessibility_tone === "bad" || zone.accessibility_tone === "warning") {
    return false;
  }
  if (detour < VERY_SMALL_DETOUR_M) {
    return true;
  }
  return zone.accessibility_tone === "good";
}

function compareMinimalCandidates(left: ResupplyZone, right: ResupplyZone): number {
  const detourDiff = zoneMinDetourM(left) - zoneMinDetourM(right);
  if (detourDiff !== 0) {
    return detourDiff;
  }
  return zoneScore(right) - zoneScore(left);
}

function pickBestZone(cluster: ResupplyZone[]): ResupplyZone {
  return [...cluster].sort((left, right) => compareMinimalCandidates(left, right))[0];
}

function applyMinimalMode(zones: ResupplyZone[], totalKm: number): ResupplyZone[] {
  const sorted = [...zones].sort(
    (left, right) => left.distance_along_km - right.distance_along_km,
  );
  if (sorted.length === 0) {
    return sorted;
  }

  const minSpacingKm = Math.max(20, totalKm / 30);
  const maxGapKm = Math.max(minSpacingKm * 2.5, totalKm / 8, 40);

  const easyZones = sorted.filter(isEasyMinimalStop);
  const rankedEasy = [...easyZones].sort(compareMinimalCandidates);

  const picked: ResupplyZone[] = [];
  for (const zone of rankedEasy) {
    const tooClose = picked.some(
      (existing) => Math.abs(existing.distance_along_km - zone.distance_along_km) < minSpacingKm,
    );
    if (!tooClose) {
      picked.push(zone);
    }
  }

  picked.sort((left, right) => left.distance_along_km - right.distance_along_km);

  const gapWindows: { startKm: number; endKm: number }[] = [];
  const routeStart = sorted[0].distance_along_km;
  const routeEnd = sorted[sorted.length - 1].distance_along_km;

  if (picked.length === 0) {
    gapWindows.push({ startKm: routeStart, endKm: routeEnd });
  } else {
    if (picked[0].distance_along_km - routeStart > maxGapKm) {
      gapWindows.push({ startKm: routeStart, endKm: picked[0].distance_along_km });
    }
    for (let index = 0; index < picked.length - 1; index += 1) {
      const gapKm = picked[index + 1].distance_along_km - picked[index].distance_along_km;
      if (gapKm > maxGapKm) {
        gapWindows.push({
          startKm: picked[index].distance_along_km,
          endKm: picked[index + 1].distance_along_km,
        });
      }
    }
    if (routeEnd - picked[picked.length - 1].distance_along_km > maxGapKm) {
      gapWindows.push({
        startKm: picked[picked.length - 1].distance_along_km,
        endKm: routeEnd,
      });
    }
  }

  for (const window of gapWindows) {
    const inGap = sorted.filter(
      (zone) => zone.distance_along_km > window.startKm && zone.distance_along_km < window.endKm,
    );
    if (inGap.length === 0) {
      continue;
    }
    if (inGap.some(isEasyMinimalStop)) {
      continue;
    }
    const fallback = pickBestZone(inGap);
    if (!picked.some((zone) => zone.zone_id === fallback.zone_id)) {
      picked.push(fallback);
    }
  }

  if (picked.length === 0) {
    return [pickBestZone(sorted)];
  }

  return picked.sort((left, right) => left.distance_along_km - right.distance_along_km);
}

export function applyTimeModeFilter(zones: ResupplyZone[], timeMode: TimeMode): ResupplyZone[] {
  if (timeMode === "day") {
    return zones;
  }
  return zones.filter(zoneIsNightUseful);
}

export function applyZoneDensity(
  zones: ResupplyZone[],
  mode: ZoneDensityMode,
  totalKm: number,
  route?: import("../api").RouteVisualization,
): ResupplyZone[] {
  if (mode === "detailed" || zones.length === 0) {
    return zones;
  }

  const sorted = [...zones].sort(
    (left, right) => left.distance_along_km - right.distance_along_km,
  );

  if (mode === "planning" && route) {
    return selectPlanningHubs(sorted, route, totalKm);
  }

  if (mode === "planning") {
    mode = "balanced";
  }

  if (mode === "balanced") {
    const merged: ResupplyZone[] = [];
    let cluster: ResupplyZone[] = [];
    const mergeGapKm = Math.max(3, totalKm / 200);

    for (const zone of sorted) {
      if (cluster.length === 0) {
        cluster.push(zone);
        continue;
      }

      const last = cluster[cluster.length - 1];
      if (zone.distance_along_km - last.distance_along_km <= mergeGapKm) {
        cluster.push(zone);
      } else {
        merged.push(pickBestZone(cluster));
        cluster = [zone];
      }
    }

    if (cluster.length > 0) {
      merged.push(pickBestZone(cluster));
    }

    return merged;
  }

  return applyMinimalMode(sorted, totalKm);
}

export function presentZones(
  zones: ResupplyZone[],
  timeMode: TimeMode,
  _density?: ZoneDensityMode,
  _totalKm?: number,
  _route?: import("../api").RouteVisualization,
): ResupplyZone[] {
  const afterTime = applyTimeModeFilter(zones, timeMode);
  return afterTime;
}
