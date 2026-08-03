import type { ResupplyZone, RoadbookResult, RouteVisualization } from "../../api";
import { formatKm } from "../../components/routeInsights";
import { analyzeClimbs, selectKeyClimbs } from "../climbAnalysis";
import { buildRouteHighlights } from "../routeHighlights";
import { buildWhyRecommended } from "../stopVerification/recommendations";
import { buildVerificationRoute } from "../stopVerification/priority";
import { buildVerifiedPlan, gapContainingKm } from "../stopVerification/verifiedPlan";
import type { VerifiedStopRecord } from "../stopVerification/types";
import { verifiedStopKey } from "../stopVerification/types";
import { analyzeUnsupportedSections } from "../unsupportedSections";
import type { TimeMode } from "../types";
import type { ZoneDensityMode } from "../types";
import { presentSuggestedStops } from "../suggestedStops";
import { detectScenicCandidates } from "./scenicCandidates";
import type {
  RoutePreviewCandidate,
  RoutePreviewDocument,
  RoutePreviewScene,
  RoutePreviewSceneType,
} from "./types";

const MAX_SCENES = 18;
const MAX_VERIFIED_STOPS = 4;
const MAX_TOWNS = 3;
const MAX_SCENERY = 3;
const MAX_CLIMBS = 2;
const MAX_UNSUPPORTED = 2;

const DEFAULT_SCREEN_TIME: Record<RoutePreviewSceneType, number> = {
  title: 8,
  overview: 24,
  start: 14,
  finish: 18,
  climb: 42,
  town: 28,
  verified_stop: 24,
  unsupported: 44,
  remote: 46,
  scenery: 34,
  coastline: 36,
  valley: 38,
  gravel: 26,
  highest_point: 20,
};

const DEFAULT_TRANSITION: Record<RoutePreviewSceneType, number> = {
  title: 2,
  overview: 4,
  start: 5,
  finish: 0,
  climb: 6,
  town: 5,
  verified_stop: 5,
  unsupported: 6,
  remote: 6,
  scenery: 5,
  coastline: 5,
  valley: 5,
  gravel: 5,
  highest_point: 5,
};

function targetDurationS(distanceKm: number): number {
  if (distanceKm <= 500) {
    return 480;
  }
  if (distanceKm <= 900) {
    return 600;
  }
  return 720;
}

function kmRange(startKm: number, endKm: number) {
  return {
    startKm: Math.max(0, startKm),
    endKm: Math.max(startKm, endKm),
  };
}

function overlaps(
  left: { startKm: number; endKm: number },
  right: { startKm: number; endKm: number },
  bufferKm = 10,
): boolean {
  return (
    left.startKm - bufferKm <= right.endKm && left.endKm + bufferKm >= right.startKm
  );
}

function candidateRange(candidate: RoutePreviewCandidate) {
  return { startKm: candidate.startKm, endKm: candidate.endKm };
}

function isVerifiedZone(
  zoneId: number,
  verifiedStops: Record<string, VerifiedStopRecord>,
): boolean {
  return verifiedStops[verifiedStopKey(zoneId)]?.status === "verified";
}

function buildFixedCandidates(
  raceName: string,
  roadbook: RoadbookResult,
): RoutePreviewCandidate[] {
  const totalKm = roadbook.summary.distance_km;
  return [
    {
      id: "title",
      type: "title",
      title: raceName,
      description: `${formatKm(totalKm, 0)} · +${Math.round(roadbook.summary.elevation_gain_m)} m climbing`,
      whyChosen: "Opens the film — sets scale and tone before the route story begins",
      startKm: 0,
      endKm: 0,
      focusKm: 0,
      priority: 5,
      editorialScore: 10_000,
    },
    {
      id: "overview",
      type: "overview",
      title: "Route overview",
      description: `${roadbook.summary.climb_count} climbs · ${Math.round(roadbook.summary.gravel_pct)}% gravel · ${Math.round(roadbook.summary.road_pct)}% paved`,
      whyChosen: "One calm establishing chapter — geography and character before the first beat",
      startKm: 0,
      endKm: totalKm,
      focusKm: totalKm / 2,
      priority: 4,
      editorialScore: 9_000,
    },
    {
      id: "start",
      type: "start",
      title: "Start",
      description: "Where the race begins — first impressions of terrain and rhythm",
      whyChosen: "Every documentary needs a clear departure moment",
      startKm: 0,
      endKm: Math.min(8, totalKm * 0.02),
      focusKm: 0,
      priority: 4,
      editorialScore: 8_500,
    },
    {
      id: "finish",
      type: "finish",
      title: "Finish",
      description: "The arrival — closing the story at the line",
      whyChosen: "Bookends the narrative and gives emotional closure",
      startKm: Math.max(0, totalKm - 8),
      endKm: totalKm,
      focusKm: totalKm,
      priority: 5,
      editorialScore: 8_500,
    },
  ];
}

function buildClimbCandidates(climbs: RoadbookResult["climbs"]): RoutePreviewCandidate[] {
  const analyzed = analyzeClimbs(climbs);
  const keyClimbs = selectKeyClimbs(analyzed);
  if (keyClimbs.length === 0) {
    return [];
  }

  const candidates: RoutePreviewCandidate[] = [];
  const hardest = keyClimbs[0];
  candidates.push({
    id: `climb-${hardest.id}`,
    type: "climb",
    title: "Hardest climb",
    description: `${hardest.displayName} · ${hardest.length_km.toFixed(1)} km · +${hardest.elevation_gain_m} m · ${hardest.avg_gradient_pct.toFixed(1)}% avg`,
    whyChosen: "Signature climbing challenge — highest difficulty score among key climbs",
    startKm: hardest.start_km,
    endKm: hardest.end_km,
    focusKm: (hardest.start_km + hardest.end_km) / 2,
    priority: 5,
    editorialScore: 7_000 + hardest.difficultyScore,
  });

  const longest = [...analyzed].sort((left, right) => right.length_km - left.length_km)[0];
  if (
    longest &&
    longest.id !== hardest.id &&
    longest.start_km - hardest.end_km > 40
  ) {
    candidates.push({
      id: `climb-${longest.id}`,
      type: "climb",
      title: "Longest climb",
      description: `${longest.displayName} · ${longest.length_km.toFixed(1)} km · +${longest.elevation_gain_m} m`,
      whyChosen: "Distinct from the hardest climb — sustained effort over distance",
      startKm: longest.start_km,
      endKm: longest.end_km,
      focusKm: (longest.start_km + longest.end_km) / 2,
      priority: 4,
      editorialScore: 5_500 + longest.length_km * 20,
    });
  }

  return candidates;
}

function buildUnsupportedCandidates(
  zones: ResupplyZone[],
  route: RouteVisualization,
  totalKm: number,
): RoutePreviewCandidate[] {
  const sections = analyzeUnsupportedSections(zones, route, totalKm);
  return sections.slice(0, 5).map((section) => ({
    id: section.id,
    type: section.isRemote ? "remote" : "unsupported",
    title: section.isRemote ? "Remote section" : "Unsupported section",
    description: `${section.displayLabel} · ${section.distanceKm.toFixed(0)} km · +${section.elevationGainM} m`,
    whyChosen:
      section.whyBadges.length > 0
        ? section.whyBadges.map((badge) => badge.label).join(" · ")
        : `Ranked #${section.riskRank} unsupported section by planning risk score`,
    startKm: section.startKm,
    endKm: section.endKm,
    focusKm: (section.startKm + section.endKm) / 2,
    priority: section.riskLevel === "extreme" || section.riskLevel === "critical" ? 5 : 4,
    editorialScore: section.riskScore * 10 + (section.isRemote ? 400 : 0),
  }));
}

function buildHighlightCandidates(
  highlights: ReturnType<typeof buildRouteHighlights>,
): RoutePreviewCandidate[] {
  const candidates: RoutePreviewCandidate[] = [];

  for (const highlight of highlights) {
    if (highlight.id === "hardest-climb" || highlight.id === "longest-climb") {
      continue;
    }

    const startKm = highlight.segmentStartKm ?? highlight.focusKm ?? 0;
    const endKm = highlight.segmentEndKm ?? highlight.focusKm ?? startKm;
    let type: RoutePreviewSceneType = "scenery";
    if (highlight.id === "food-gap" || highlight.id === "water-gap") {
      continue;
    }
    if (highlight.id === "gravel-section") {
      type = "gravel";
    } else if (highlight.id === "highest-point") {
      type = "highest_point";
    }

    candidates.push({
      id: highlight.id,
      type,
      title: highlight.label,
      description: `${highlight.value} · ${highlight.detail}`,
      whyChosen: highlight.insightHint ?? "Notable route extreme from briefing analysis",
      startKm,
      endKm,
      focusKm: highlight.focusKm ?? (startKm + endKm) / 2,
      priority: highlight.severity === "danger" ? 4 : 3,
      editorialScore:
        highlight.severity === "danger" ? 4_200 : highlight.severity === "warning" ? 3_600 : 3_000,
    });
  }

  return candidates;
}

function buildTownCandidates(
  zones: ResupplyZone[],
  selected: RoutePreviewCandidate[],
): RoutePreviewCandidate[] {
  const sorted = [...zones].sort((left, right) => right.poi_count - left.poi_count);
  const candidates: RoutePreviewCandidate[] = [];

  for (const zone of sorted) {
    if (zone.poi_count < 45) {
      continue;
    }

    const range = {
      startKm: Math.max(0, zone.distance_along_km - 2),
      endKm: zone.distance_along_km + 2,
    };
    if (selected.some((item) => overlaps(range, candidateRange(item), 8))) {
      continue;
    }
    if (candidates.some((item) => Math.abs(item.focusKm - zone.distance_along_km) < 120)) {
      continue;
    }

    candidates.push({
      id: `town-${zone.zone_id}`,
      type: "town",
      title: "Major resupply stop",
      description: `${zone.name} · km ${Math.round(zone.distance_along_km)} · ${zone.poi_count} nearby options`,
      whyChosen: "Dense resupply cluster — a natural story beat for towns and services",
      startKm: range.startKm,
      endKm: range.endKm,
      focusKm: zone.distance_along_km,
      priority: 3,
      editorialScore: zone.poi_count * 25,
    });
  }

  return candidates.sort((left, right) => right.editorialScore - left.editorialScore);
}

function buildVerifiedStopCandidates(
  zones: ResupplyZone[],
  route: RouteVisualization,
  totalKm: number,
  verifiedStops: Record<string, VerifiedStopRecord>,
  timeMode: TimeMode,
): RoutePreviewCandidate[] {
  const verificationRoute = buildVerificationRoute(zones, route, totalKm, null, timeMode);
  const verifiedPlan = buildVerifiedPlan(
    verificationRoute,
    verifiedStops,
    route,
    totalKm,
    zones,
  );
  const zoneById = new Map(zones.map((zone) => [zone.zone_id, zone]));

  const candidates: RoutePreviewCandidate[] = [];
  for (const item of verificationRoute) {
    const zoneId = item.zone.zone_id;
    if (!isVerifiedZone(zoneId, verifiedStops)) {
      continue;
    }

    const zone = zoneById.get(zoneId) ?? item.zone;
    const gap = gapContainingKm(verifiedPlan.gaps, zone.distance_along_km);
    const reasons = buildWhyRecommended(zone, item.context, timeMode);
    let editorialScore = item.tierScore;
    if (item.context.isLastBeforeRemote) {
      editorialScore += 900;
    }
    if (gap) {
      editorialScore += gap.weaknessScore;
    }
    if (zone.poi_count >= 50) {
      editorialScore += 180;
    }

    candidates.push({
      id: `verified-${zoneId}`,
      type: "verified_stop",
      title: "Verified stop",
      description: `${zone.name} · km ${Math.round(zone.distance_along_km)}`,
      whyChosen: reasons[0] ?? "Stop you verified during planning — anchors the resupply story",
      startKm: Math.max(0, zone.distance_along_km - 1.5),
      endKm: zone.distance_along_km + 1.5,
      focusKm: zone.distance_along_km,
      priority: item.context.isLastBeforeRemote ? 5 : 4,
      editorialScore,
    });
  }

  return candidates.sort((left, right) => right.editorialScore - left.editorialScore);
}

function selectCandidates(
  candidates: RoutePreviewCandidate[],
  limits: Partial<Record<RoutePreviewSceneType, number>>,
  combinedLimits: Array<{ types: RoutePreviewSceneType[]; max: number }> = [],
): RoutePreviewCandidate[] {
  const selected: RoutePreviewCandidate[] = [];
  const counts = new Map<RoutePreviewSceneType, number>();

  const sorted = [...candidates].sort((left, right) => {
    if (right.editorialScore !== left.editorialScore) {
      return right.editorialScore - left.editorialScore;
    }
    return left.focusKm - right.focusKm;
  });

  for (const candidate of sorted) {
    const limit = limits[candidate.type];
    const count = counts.get(candidate.type) ?? 0;
    if (limit !== undefined && count >= limit) {
      continue;
    }

    const combined = combinedLimits.find((rule) => rule.types.includes(candidate.type));
    if (combined) {
      const combinedCount = selected.filter((item) => combined.types.includes(item.type)).length;
      if (combinedCount >= combined.max) {
        continue;
      }
    }

    if (
      selected.some((item) =>
        overlaps(candidateRange(item), candidateRange(candidate), candidate.type === "scenery" ? 14 : 10),
      )
    ) {
      continue;
    }

    selected.push(candidate);
    counts.set(candidate.type, count + 1);
    if (selected.length >= MAX_SCENES) {
      break;
    }
  }

  return selected;
}

function orderScenes(candidates: RoutePreviewCandidate[]): RoutePreviewCandidate[] {
  const fixedOrder = ["title", "overview", "start"];
  const fixed = fixedOrder
    .map((id) => candidates.find((candidate) => candidate.id === id))
    .filter((candidate): candidate is RoutePreviewCandidate => candidate !== undefined);
  const finish = candidates.find((candidate) => candidate.id === "finish");
  const body = candidates
    .filter((candidate) => !fixedOrder.includes(candidate.id) && candidate.id !== "finish")
    .sort((left, right) => left.focusKm - right.focusKm);

  return finish ? [...fixed, ...body, finish] : [...fixed, ...body];
}

function toScene(candidate: RoutePreviewCandidate, order: number): RoutePreviewScene {
  return {
    id: candidate.id,
    order,
    type: candidate.type,
    title: candidate.title,
    description: candidate.description,
    whyChosen: candidate.whyChosen,
    screenTimeS: DEFAULT_SCREEN_TIME[candidate.type],
    transitionAfterS: DEFAULT_TRANSITION[candidate.type],
    kmRange: kmRange(candidate.startKm, candidate.endKm),
    priority: candidate.priority,
  };
}

function scaleScreenTimes(scenes: RoutePreviewScene[], targetDurationS: number): RoutePreviewScene[] {
  const currentDuration = scenes.reduce(
    (sum, scene) => sum + scene.screenTimeS + scene.transitionAfterS,
    0,
  );
  if (currentDuration <= 0 || Math.abs(currentDuration - targetDurationS) < 25) {
    return scenes;
  }

  const ratio = targetDurationS / currentDuration;
  return scenes.map((scene) => ({
    ...scene,
    screenTimeS: Math.max(8, Math.round(scene.screenTimeS * ratio)),
    transitionAfterS:
      scene.type === "finish" ? 0 : Math.max(2, Math.round(scene.transitionAfterS * ratio)),
  }));
}

export interface GenerateRoutePreviewInput {
  roadbook: RoadbookResult;
  raceName: string;
  verifiedStops: Record<string, VerifiedStopRecord>;
  timeMode?: TimeMode;
  zoneDensity?: ZoneDensityMode;
}

export function generateRoutePreview(input: GenerateRoutePreviewInput): RoutePreviewDocument {
  const {
    roadbook,
    raceName,
    verifiedStops,
    timeMode = "day",
  } = input;
  const totalKm = roadbook.summary.distance_km;
  const zones = presentSuggestedStops(roadbook, timeMode);
  const highlights = buildRouteHighlights(
    roadbook.climbs,
    zones,
    roadbook.route,
    totalKm,
  );

  const fixed = buildFixedCandidates(raceName, roadbook);
  const climbs = buildClimbCandidates(roadbook.climbs);
  const unsupported = buildUnsupportedCandidates(zones, roadbook.route, totalKm);
  const highlightCandidates = buildHighlightCandidates(highlights);
  const verified = buildVerifiedStopCandidates(
    zones,
    roadbook.route,
    totalKm,
    verifiedStops,
    timeMode,
  );

  const coreSelected = selectCandidates(
    [...fixed, ...climbs, ...unsupported, ...highlightCandidates, ...verified],
    {
      title: 1,
      overview: 1,
      start: 1,
      finish: 1,
      climb: MAX_CLIMBS,
      verified_stop: MAX_VERIFIED_STOPS,
      gravel: 1,
      highest_point: 1,
    },
    [{ types: ["unsupported", "remote"], max: MAX_UNSUPPORTED }],
  );

  const towns = buildTownCandidates(zones, coreSelected);
  const scenery = detectScenicCandidates(
    roadbook.route,
    coreSelected.map((item) => candidateRange(item)),
  );

  const selected = selectCandidates([...coreSelected, ...towns, ...scenery], {
    town: MAX_TOWNS,
    scenery: MAX_SCENERY,
    coastline: 1,
    valley: 1,
  });

  const ordered = orderScenes(selected);
  const target = targetDurationS(totalKm);
  const scenes = scaleScreenTimes(
    ordered.map((candidate, index) => toScene(candidate, index + 1)),
    target,
  );
  const estimatedDurationS = scenes.reduce(
    (sum, scene) => sum + scene.screenTimeS + scene.transitionAfterS,
    0,
  );

  return {
    version: 1,
    raceName,
    routeName: roadbook.summary.route_name,
    distanceKm: totalKm,
    elevationGainM: roadbook.summary.elevation_gain_m,
    targetDurationS: target,
    estimatedDurationS,
    sceneCount: scenes.length,
    generatedAt: new Date().toISOString(),
    scenes,
  };
}

export function formatRoutePreviewDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (seconds === 0) {
    return `${minutes} min`;
  }
  return `${minutes} min ${seconds}s`;
}
