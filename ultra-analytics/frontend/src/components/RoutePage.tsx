/** Planned Route — map-first planning workspace (Analytics untouched). */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  deleteRoute,
  getRoute,
  getRouteAnalysis,
  patchRoute,
  preloadRoutePois,
  searchRouteViewportPois,
} from "../api";
import type {
  CriticalDecision,
  PlannedRouteDetail,
  RecommendedStop,
  RouteAnalysis,
  RouteClimb,
  RoutePreparation,
  RouteRemoteGap,
} from "../types";
import { fmtDuration } from "./ui/format";
import Icon from "./ui/Icon";
import RydnLoader from "./ui/RydnLoader";
import ScoreLine from "./ui/ScoreLine";
import PlanMap, { type PlanMapBBox, PLAN_MAP_STYLE_NOTE } from "./plan/PlanMap";
import { RydnPlanIcon, iconForCategory } from "./plan/icons";
import {
  DEFAULT_LAYERS,
  LAYER_TOGGLES,
  QA_NEAREST_N,
  QUICK_ACTIONS,
  RIDE_LAYERS,
  applyQuickActionEmphasis,
  markerVisible,
  nearestOf,
  pointAlongRoute,
  searchLimitForQa,
  stopMatchesLayer,
  type PlanLayerId,
  type PlanMarker,
  type QuickActionId,
} from "./plan/planLayers";
import {
  bboxSpanTooLarge,
  isZoomInSearchError,
  resolvePlanSearchChip,
} from "./plan/planSearchUi";
import {
  isAbortError,
  resolveSearchOutcome,
  SEARCH_FAIL_TOAST,
  SEARCH_TIMEOUT_MS,
} from "./plan/planSearchLifecycle";
import {
  promoteToVerified,
  removeFromSearchResults,
  replaceSearchResults,
  verifiedIdSet,
} from "./plan/workspaceLayers";

function mapViewportPoi(p: {
  id: string;
  osmId: number;
  osmType: string;
  name: string | null;
  category: string;
  group: string;
  lat: number;
  lon: number;
  distanceAlongKm: number;
  distanceOffRouteM: number;
  openingHours?: string | null;
  website?: string | null;
  is24h?: boolean;
  hasShop?: boolean;
  googleMapsUrl?: string | null;
  qualityStars?: number;
  qualityLabel?: string;
  qualityScore?: number;
  resupplyScore?: number;
  storeSize?: string;
  services?: string[];
}): RecommendedStop {
  return {
    id: p.id,
    osmId: p.osmId,
    osmType: p.osmType,
    name: p.name,
    category: p.category,
    group: p.group,
    lat: p.lat,
    lon: p.lon,
    distanceAlongKm: p.distanceAlongKm,
    distanceOffRouteM: p.distanceOffRouteM,
    openingHours: p.openingHours,
    website: p.website,
    is24h: p.is24h,
    hasShop: p.hasShop,
    qualityStars: p.qualityStars ?? 3,
    qualityLabel: p.qualityLabel || "Area find",
    qualityScore: p.qualityScore,
    resupplyScore: p.resupplyScore,
    storeSize: p.storeSize,
    services: p.services,
    reviewStatus: "unreviewed",
    googleMapsUrl: p.googleMapsUrl,
  };
}

function mapsLinks(lat: number, lon: number, name?: string | null) {
  const q = encodeURIComponent(name || `${lat},${lon}`);
  return {
    google: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=bicycling`,
    apple: `https://maps.apple.com/?daddr=${lat},${lon}&dirflg=c`,
    place: `https://www.google.com/maps/search/?api=1&query=${q}`,
    streetView: `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lon}`,
  };
}

function fmtEtaFromKm(km: number, speedKmh = 22): string {
  if (!Number.isFinite(km) || km < 0) return "—";
  const hours = km / speedKmh;
  if (hours < 1) return `~${Math.max(1, Math.round(hours * 60))} min`;
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m > 0 ? `~${h}h ${m}m` : `~${h}h`;
}

interface Props {
  routeId: string;
  onBack: () => void;
  onDeleted?: () => void;
}

type Mode = "plan" | "ride";
type ReviewStatus = "verified" | "rejected" | "skipped";
type ReviewMotion = {
  stopId: string;
  status: ReviewStatus;
  phase: "confirming" | "exiting" | "done";
};
type BriefingTab = "critical" | "stops" | "climbs" | "stages" | "verify" | "prep";

const REVIEW_FEEDBACK_MS = 220;
const REVIEW_EXIT_MS = 260;

const REVIEW_LABELS: Record<
  ReviewStatus,
  { idle: string; pending: string; done: string }
> = {
  verified: { idle: "Verify", pending: "Verifying…", done: "✓ Verified" },
  rejected: { idle: "Reject", pending: "Rejecting…", done: "Rejected" },
  skipped: { idle: "Save for later", pending: "Saving…", done: "Saved" },
};

function applyStopReview(
  analysis: RouteAnalysis,
  stopId: string,
  status: ReviewStatus | "unreviewed",
): RouteAnalysis {
  const stops = (analysis.recommendedStops || []).map((s) =>
    s.id === stopId ? { ...s, reviewStatus: status } : s,
  );
  const verified = stops.filter((s) => s.reviewStatus === "verified").length;
  const nextReviews = { ...(analysis.stopReviews || {}) };
  if (status === "unreviewed") delete nextReviews[stopId];
  else nextReviews[stopId] = status;
  return {
    ...analysis,
    recommendedStops: stops,
    stopReviews: nextReviews,
    summary: {
      ...analysis.summary,
      verifiedStopCount: verified,
      recommendedStopCount: stops.filter((s) => s.reviewStatus !== "rejected").length,
    },
  };
}

const CHECKS: {
  key: keyof Omit<RoutePreparation, "notes">;
  label: string;
  doneHint: (a: RouteAnalysis | null) => string;
}[] = [
  {
    key: "routeUnderstood",
    label: "Route understood",
    doneHint: (a) =>
      a
        ? `${Math.round(a.summary.distanceKm)} km · ${a.summary.elevationGainM.toLocaleString("en-US")} m`
        : "Confirm the course shape and totals",
  },
  {
    key: "stopsVerified",
    label: "Stops reviewed",
    doneHint: (a) =>
      a
        ? `${a.summary.recommendedStopCount ?? 0} recommended · ${a.summary.verifiedStopCount ?? 0} verified`
        : "Review recommended stops",
  },
  {
    key: "keyClimbsReviewed",
    label: "Climbs reviewed",
    doneHint: (a) => (a ? `${a.summary.climbCount} climbs detected` : "Review major climbs"),
  },
  {
    key: "stagesPlanned",
    label: "Stages reviewed",
    doneHint: (a) => (a ? `${a.summary.stageCount} suggested days` : "Review stage breaks"),
  },
];

function recommendWhy(stop: RecommendedStop): string {
  const parts: string[] = [];
  if (stop.qualityStars >= 5) parts.push("Top reliability for ultra resupply");
  else if (stop.qualityStars >= 4) parts.push("Strong reliability on this stretch");
  else parts.push(`${stop.qualityLabel} option where coverage is thin`);
  if (stop.is24h) parts.push("open around the clock");
  if (stop.distanceOffRouteM <= 80) parts.push("essentially on the course");
  else if (stop.distanceOffRouteM <= 250) parts.push("short detour off the line");
  if (stop.group === "water") parts.push("water coverage for the next gap");
  else if (stop.group === "sleep") parts.push("sleep option near a stage break");
  else if (stop.category === "24h Shop" || stop.category === "Fuel shop" || stop.category === "Gas station")
    parts.push("fuel, water, and late hours in one stop");
  else if (stop.category === "Supermarket") parts.push("full resupply without hunting side streets");
  return `${parts.join(" · ")}.`;
}

function qaToOverpassGroup(qa: QuickActionId | null): string {
  if (!qa) return "all";
  if (qa === "water") return "water";
  if (qa === "food") return "resupply";
  if (qa === "h24") return "fuel";
  if (qa === "sleep") return "sleep";
  return "all";
}

function searchStatusForQa(qa: QuickActionId | null, step: number): string {
  const finding =
    qa === "water"
      ? "Finding water…"
      : qa === "food"
        ? "Finding markets…"
        : qa === "h24"
          ? "Finding 24h shops…"
          : qa === "sleep"
            ? "Finding sleep…"
            : "Finding stops…";
  const steps = ["Searching visible area…", finding, "Ranking best stops…"];
  return steps[Math.min(step, steps.length - 1)] || steps[0];
}

type PeekPayload =
  | { kind: "climb"; climb: RouteClimb }
  | { kind: "remote"; gap: RouteRemoteGap }
  | { kind: "decision"; decision: CriticalDecision };

export default function RoutePage({ routeId, onBack, onDeleted }: Props) {
  const [route, setRoute] = useState<PlannedRouteDetail | null>(null);
  const [analysis, setAnalysis] = useState<RouteAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [analyzing, setAnalyzing] = useState(true);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [mode, setMode] = useState<Mode>("plan");
  const [layers, setLayers] = useState<Record<PlanLayerId, boolean>>(DEFAULT_LAYERS);
  const [qa, setQa] = useState<QuickActionId | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [verifyIndex, setVerifyIndex] = useState(0);
  const [targetKm, setTargetKm] = useState(250);
  const [rideKm, setRideKm] = useState(0);
  const [reviewMotion, setReviewMotion] = useState<ReviewMotion | null>(null);
  const [briefingOpen, setBriefingOpen] = useState(false);
  const [briefingTab, setBriefingTab] = useState<BriefingTab>("critical");
  const [layersOpen, setLayersOpen] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [mapCenter, setMapCenter] = useState<{ lat: number; lon: number } | null>(null);
  const [mapBbox, setMapBbox] = useState<PlanMapBBox | null>(null);
  /** User moved map since last finished search — gates Google Maps-style chip. */
  const [searchPrompted, setSearchPrompted] = useState(false);
  const [searchingArea, setSearchingArea] = useState(false);
  const [searchStatus, setSearchStatus] = useState<string | null>(null);
  /** TEMPORARY search workspace — replaced on every new search. */
  const [searchResults, setSearchResults] = useState<RecommendedStop[]>([]);
  /** PERMANENT verified layer — survives every search. */
  const [verifiedStops, setVerifiedStops] = useState<RecommendedStop[]>([]);
  /** Transient toast (errors) — never a permanent banner for search. */
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const reviewTimers = useRef<number[]>([]);
  const analysisRef = useRef<RouteAnalysis | null>(null);
  const routeRef = useRef<PlannedRouteDetail | null>(null);
  const searchGenRef = useRef(0);
  const searchStatusTimerRef = useRef<number | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);

  const showToast = (message: string) => {
    setToast(message);
    if (toastTimerRef.current != null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 3200);
  };

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setAnalyzing(true);
    Promise.all([getRoute(routeId), getRouteAnalysis(routeId)])
      .then(([r, a]) => {
        if (cancelled) return;
        setRoute(r);
        setName(r.name);
        setNotes(r.preparation?.notes || "");
        setDateStart(r.dateStart || "");
        setDateEnd(r.dateEnd || "");
        setAnalysis(a);
        if (a.targetStageKm) setTargetKm(Math.round(a.targetStageKm));
        // Restore permanently saved verified finds (never disappear on re-search).
        const saved = Object.values(r.savedStops || {}) as RecommendedStop[];
        const fromRec = (a.recommendedStops || []).filter((s) => s.reviewStatus === "verified");
        const byId = new Map<string, RecommendedStop>();
        for (const s of [...fromRec, ...saved]) {
          byId.set(s.id, { ...s, reviewStatus: "verified" });
        }
        setVerifiedStops(Array.from(byId.values()));
        setSearchResults([]);
        // Warm Search corridor in background (Option A) — never blocks UI.
        void preloadRoutePois(routeId).then((pre) => {
          if (cancelled || !pre.ok) return;
          console.info("[rydn.search.preload]", {
            poiCount: pre.poiCount,
            cache: pre.cache,
            ms: pre.timings?.totalMs,
          });
        });
      })
      .catch((e) => !cancelled && setError((e as Error).message))
      .finally(() => !cancelled && setAnalyzing(false));
    return () => {
      cancelled = true;
    };
  }, [routeId]);

  useEffect(() => {
    analysisRef.current = analysis;
  }, [analysis]);

  useEffect(() => {
    routeRef.current = route;
  }, [route]);

  useEffect(() => {
    return () => {
      for (const id of reviewTimers.current) window.clearTimeout(id);
      reviewTimers.current = [];
      if (searchStatusTimerRef.current != null) {
        window.clearInterval(searchStatusTimerRef.current);
        searchStatusTimerRef.current = null;
      }
      searchAbortRef.current?.abort();
      searchAbortRef.current = null;
      if (toastTimerRef.current != null) {
        window.clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    setLayers(mode === "ride" ? RIDE_LAYERS : DEFAULT_LAYERS);
    setQa(null);
    setSelectedId(null);
    setOverflowOpen(false);
    setSearchPrompted(false);
    if (mode === "ride") {
      setSearchResults([]);
      setLayersOpen(false);
      setBriefingOpen(false);
    }
  }, [mode]);

  const loadAnalysis = async (opts: { refresh?: boolean; targetStageKm?: number } = {}) => {
    setAnalyzing(true);
    setError(null);
    try {
      const a = await getRouteAnalysis(routeId, {
        refresh: opts.refresh,
        targetStageKm: opts.targetStageKm ?? targetKm,
      });
      setAnalysis(a);
      if (a.targetStageKm) setTargetKm(Math.round(a.targetStageKm));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAnalyzing(false);
    }
  };

  const saveName = async () => {
    if (!route || !name.trim() || name.trim() === route.name) return;
    setBusy(true);
    try {
      setRoute(await patchRoute(route.id, { name: name.trim() }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveDates = async () => {
    if (!route) return;
    const nextStart = dateStart || null;
    const nextEnd = dateEnd || null;
    if ((route.dateStart || null) === nextStart && (route.dateEnd || null) === nextEnd) return;
    setBusy(true);
    try {
      setRoute(await patchRoute(route.id, { dateStart: nextStart, dateEnd: nextEnd }));
      await loadAnalysis({ refresh: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveNotes = async () => {
    if (!route) return;
    if ((route.preparation?.notes || "") === notes) return;
    setBusy(true);
    try {
      setRoute(await patchRoute(route.id, { notes }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleCheck = async (key: keyof Omit<RoutePreparation, "notes">) => {
    if (!route) return;
    setBusy(true);
    try {
      setRoute(await patchRoute(route.id, { preparation: { [key]: !route.preparation[key] } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reviewStop = (stopId: string, status: ReviewStatus) => {
    const currentRoute = routeRef.current;
    const currentAnalysis = analysisRef.current;
    if (!currentRoute || !currentAnalysis || reviewMotion) return;

    const list = currentAnalysis.recommendedStops || [];
    const currentIdx = list.findIndex((s) => s.id === stopId);
    const tempStop = searchResults.find((s) => s.id === stopId);
    const alreadyVerified = verifiedStops.find((s) => s.id === stopId);
    // Temp search finds can be verified before they are in recommendedStops.
    if (currentIdx < 0 && !tempStop && !alreadyVerified) return;

    const fromList =
      currentIdx >= 0 ? list[currentIdx] : tempStop || alreadyVerified!;
    const rawPrev = fromList?.reviewStatus || "unreviewed";
    const previousStatus: ReviewStatus | "unreviewed" =
      rawPrev === "verified" || rawPrev === "rejected" || rawPrev === "skipped"
        ? rawPrev
        : "unreviewed";
    const previousReviews = { ...(currentRoute.stopReviews || {}) };
    const previousSaved = { ...(currentRoute.savedStops || {}) };
    const previousVerified = verifiedStops;
    const previousSearch = searchResults;
    const snapshotAnalysis = currentAnalysis;
    const hasNext = currentIdx >= 0 && currentIdx < list.length - 1;
    const advanceTo = currentIdx >= 0 ? Math.min(currentIdx + 1, Math.max(0, list.length - 1)) : 0;
    const nextStopId = hasNext ? list[advanceTo]?.id ?? null : null;

    setError(null);
    if (currentIdx >= 0) {
      setAnalysis(applyStopReview(currentAnalysis, stopId, status));
    }

    const snap = tempStop || alreadyVerified || fromList;
    if (status === "verified" && snap) {
      // Promote out of temp workspace into permanent verified layer.
      setSearchResults((prev) => removeFromSearchResults(prev, stopId));
      setVerifiedStops((prev) => promoteToVerified(snap, prev));
      if (currentIdx < 0 && tempStop) {
        setAnalysis(
          applyStopReview(
            {
              ...currentAnalysis,
              recommendedStops: [
                ...(currentAnalysis.recommendedStops || []),
                { ...tempStop, reviewStatus: "verified" },
              ],
            },
            stopId,
            "verified",
          ),
        );
      }
    } else {
      setVerifiedStops((prev) => prev.filter((s) => s.id !== stopId));
      setSearchResults((prev) =>
        prev.map((s) => (s.id === stopId ? { ...s, reviewStatus: status } : s)),
      );
    }

    setRoute({
      ...currentRoute,
      stopReviews: { ...previousReviews, [stopId]: status },
    });
    setReviewMotion({ stopId, status, phase: "confirming" });

    for (const id of reviewTimers.current) window.clearTimeout(id);
    reviewTimers.current = [];

    const exitTimer = window.setTimeout(() => {
      setReviewMotion({ stopId, status, phase: hasNext ? "exiting" : "done" });
    }, REVIEW_FEEDBACK_MS);

    const advanceTimer = window.setTimeout(() => {
      if (hasNext && briefingOpen && briefingTab === "verify") {
        setVerifyIndex(advanceTo);
        setSelectedId(nextStopId);
        setReviewMotion(null);
      } else {
        setReviewMotion(null);
      }
    }, hasNext && briefingOpen && briefingTab === "verify"
      ? REVIEW_FEEDBACK_MS + REVIEW_EXIT_MS
      : REVIEW_FEEDBACK_MS + 160);

    reviewTimers.current = [exitTimer, advanceTimer];

    const patchBody: Parameters<typeof patchRoute>[1] = {
      stopReviews: { [stopId]: status },
    };
    if (status === "verified" && snap) {
      patchBody.savedStops = { [stopId]: { ...snap, reviewStatus: "verified" } };
    } else if (status !== "verified") {
      patchBody.savedStops = { [stopId]: null };
    }

    void patchRoute(currentRoute.id, patchBody)
      .then((updated) => {
        setRoute((prev) => {
          if (!prev || prev.id !== updated.id) return prev;
          return {
            ...prev,
            stopReviews: updated.stopReviews ?? prev.stopReviews,
            savedStops: updated.savedStops ?? prev.savedStops,
            preparation: updated.preparation ?? prev.preparation,
            status: updated.status ?? prev.status,
            updatedAt: updated.updatedAt ?? prev.updatedAt,
          };
        });
      })
      .catch(() => {
        for (const id of reviewTimers.current) window.clearTimeout(id);
        reviewTimers.current = [];
        setReviewMotion(null);
        const latest = analysisRef.current || snapshotAnalysis;
        if (currentIdx >= 0) setAnalysis(applyStopReview(latest, stopId, previousStatus));
        setVerifiedStops(previousVerified);
        setSearchResults(previousSearch);
        setRoute((prev) => {
          if (!prev) return prev;
          const next = { ...(prev.stopReviews || {}) };
          if (previousStatus === "unreviewed") delete next[stopId];
          else next[stopId] = previousStatus;
          return { ...prev, stopReviews: next, savedStops: previousSaved };
        });
        if (currentIdx >= 0) setVerifyIndex(currentIdx);
        setSelectedId(stopId);
        showToast("Couldn't save verification. Please try again.");
      });
  };

  const onDelete = async () => {
    if (!route) return;
    if (!window.confirm("Delete this planned route? Completed rides are unaffected.")) return;
    setBusy(true);
    try {
      await deleteRoute(route.id);
      (onDeleted || onBack)();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const recommended = analysis?.recommendedStops || [];
  const decisions = analysis?.criticalDecisions || [];
  const verifiedCount = recommended.filter((s) => s.reviewStatus === "verified").length;
  const pendingCount = recommended.filter(
    (s) => s.reviewStatus === "unreviewed" || s.reviewStatus === "skipped",
  ).length;

  useEffect(() => {
    if (verifyIndex >= recommended.length && recommended.length > 0) {
      setVerifyIndex(recommended.length - 1);
    }
  }, [recommended.length, verifyIndex]);

  const verifyStop = recommended[Math.min(verifyIndex, Math.max(0, recommended.length - 1))] || null;

  const allMarkers: PlanMarker[] = useMemo(() => {
    if (!analysis) return [];
    const out: PlanMarker[] = [];
    const seen = new Set<string>();

    const push = (m: PlanMarker) => {
      if (seen.has(m.id)) return;
      seen.add(m.id);
      out.push(m);
    };

    // Permanent verified layer (survives every search).
    for (const s of verifiedStops) {
      push({
        id: s.id,
        lat: s.lat,
        lon: s.lon,
        kind: s.group === "sleep" ? "sleep" : "poi",
        layer: "verified",
        group: s.group,
        category: s.category,
        status: "verified",
        is24h: s.is24h,
        hasShop: s.hasShop,
        name: s.name,
        qualityStars: s.qualityStars,
        distanceOffRouteM: s.distanceOffRouteM,
      });
    }

    // Analysis corridor recommendations (system layer; verified already covered above).
    for (const s of recommended) {
      if (s.reviewStatus === "verified") {
        push({
          id: s.id,
          lat: s.lat,
          lon: s.lon,
          kind: s.group === "sleep" ? "sleep" : "poi",
          layer: "verified",
          group: s.group,
          category: s.category,
          status: "verified",
          is24h: s.is24h,
          hasShop: s.hasShop,
          name: s.name,
          qualityStars: s.qualityStars,
          distanceOffRouteM: s.distanceOffRouteM,
        });
        continue;
      }
      push({
        id: s.id,
        lat: s.lat,
        lon: s.lon,
        kind: s.group === "sleep" ? "sleep" : "poi",
        layer: "system",
        group: s.group,
        category: s.category,
        status: s.reviewStatus,
        is24h: s.is24h,
        hasShop: s.hasShop,
        name: s.name,
        qualityStars: s.qualityStars,
        distanceOffRouteM: s.distanceOffRouteM,
      });
    }

    // Temporary search workspace — replaced on every new search.
    for (const s of searchResults) {
      push({
        id: s.id,
        lat: s.lat,
        lon: s.lon,
        kind: "area",
        layer: "temp",
        group: s.group,
        category: s.category,
        status: s.reviewStatus || "unreviewed",
        is24h: s.is24h,
        hasShop: s.hasShop,
        name: s.name,
        qualityStars: s.qualityStars,
        distanceOffRouteM: s.distanceOffRouteM,
      });
    }

    for (const c of analysis.climbs) {
      if (c.startLat != null && c.startLon != null) {
        push({
          id: c.id,
          lat: c.startLat,
          lon: c.startLon,
          kind: "climb",
          layer: "system",
          name: c.name,
        });
      }
    }
    for (const g of analysis.remoteGaps) {
      if (g.midLat != null && g.midLon != null) {
        push({
          id: g.id,
          lat: g.midLat,
          lon: g.midLon,
          kind: "remote",
          layer: "system",
          name: g.label,
        });
      }
    }
    for (const s of (analysis.sleep || []).slice(0, 40)) {
      push({
        id: `sleep-${s.osmId}`,
        lat: s.lat,
        lon: s.lon,
        kind: "sleep",
        layer: "system",
        group: "sleep",
        category: s.category,
        name: s.name,
        distanceOffRouteM: s.distanceOffRouteM,
      });
    }
    for (const st of analysis.stages.slice(0, -1)) {
      const sleep = analysis.sleepPlan?.find((p) => p.stageIndex === st.index)?.suggestion;
      if (sleep) {
        push({
          id: `stage-${st.index}`,
          lat: sleep.lat,
          lon: sleep.lon,
          kind: "stage",
          layer: "system",
          name: st.label,
        });
      }
    }
    for (const d of decisions) {
      if (d.lat != null && d.lon != null) {
        push({
          id: d.id,
          lat: d.lat,
          lon: d.lon,
          kind: "decision",
          layer: "system",
          name: d.title,
        });
      }
    }
    return out;
  }, [analysis, recommended, decisions, searchResults, verifiedStops]);

  const nearestRef = useMemo(() => {
    if (mode === "ride" && route) {
      return (
        pointAlongRoute(route.points, rideKm, route.distanceKm) ||
        mapCenter ||
        (route.points?.[0] ? { lat: route.points[0][0], lon: route.points[0][1] } : null)
      );
    }
    return (
      mapCenter ||
      (route?.points?.[0] ? { lat: route.points[0][0], lon: route.points[0][1] } : null)
    );
  }, [mode, route, rideKm, mapCenter]);

  const nearestRefLive = useRef(nearestRef);
  useEffect(() => {
    nearestRefLive.current = nearestRef;
  }, [nearestRef]);

  const visibleMarkers = useMemo(() => {
    const base = allMarkers.filter((m) => markerVisible(m, layers, qa, selectedId));
    return applyQuickActionEmphasis(base, qa, nearestRef, selectedId);
  }, [allMarkers, layers, qa, nearestRef, selectedId]);

  /** Camera focus — snap once when Quick Action changes, not on every pan. */
  const [focusIds, setFocusIds] = useState<string[] | null>(null);
  useEffect(() => {
    if (!qa) {
      setFocusIds(null);
      return;
    }
    const ref = nearestRefLive.current;
    const base = allMarkers.filter((m) => markerVisible(m, layers, qa, selectedId));
    const ranked = applyQuickActionEmphasis(base, qa, ref, selectedId);
    setFocusIds(
      ranked
        .filter((m) => m.emphasize)
        .map((m) => m.id)
        .slice(0, QA_NEAREST_N),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-focus on QA toggle
  }, [qa]);

  const selectedStop: RecommendedStop | null = useMemo(() => {
    if (!selectedId) return null;
    const fromRec = recommended.find((s) => s.id === selectedId);
    if (fromRec) {
      if (fromRec.reviewStatus === "verified") return fromRec;
      const fromVerified = verifiedStops.find((s) => s.id === selectedId);
      return fromVerified || fromRec;
    }
    const fromVerified = verifiedStops.find((s) => s.id === selectedId);
    if (fromVerified) return fromVerified;
    return searchResults.find((s) => s.id === selectedId) || null;
  }, [selectedId, recommended, searchResults, verifiedStops]);

  const peek: PeekPayload | null = useMemo(() => {
    if (!selectedId || !analysis || selectedStop) return null;
    const climb = analysis.climbs.find((c) => c.id === selectedId);
    if (climb) return { kind: "climb", climb };
    const gap = analysis.remoteGaps.find((g) => g.id === selectedId);
    if (gap) return { kind: "remote", gap };
    const decision = decisions.find((d) => d.id === selectedId);
    if (decision) return { kind: "decision", decision };
    return null;
  }, [selectedId, analysis, selectedStop, decisions]);

  const nearest = useMemo(() => {
    if (!nearestRef || !qa) return null;
    // Nearest under active Quick Action — Plan: map center · Ride: route progress
    return nearestOf(allMarkers, nearestRef.lat, nearestRef.lon, (m) => stopMatchesLayer(m, qa));
  }, [allMarkers, nearestRef, qa]);

  const rideGlance = useMemo(() => {
    const verified = recommended.filter((s) => s.reviewStatus === "verified");
    const ahead = (pred: (s: RecommendedStop) => boolean) => {
      const list = verified.filter((s) => pred(s) && s.distanceAlongKm >= rideKm - 0.5);
      return list.sort((a, b) => a.distanceAlongKm - b.distanceAlongKm)[0] || null;
    };
    return {
      water: ahead((s) => s.group === "water"),
      markets: ahead(
        (s) =>
          s.category === "Supermarket" ||
          s.category === "Convenience" ||
          (s.group === "resupply" && !(s.category || "").toLowerCase().includes("gas")),
      ),
      shop24: ahead(
        (s) =>
          !!s.is24h &&
          (s.hasShop ||
            (s.category || "").toLowerCase().includes("gas") ||
            (s.category || "").toLowerCase().includes("fuel") ||
            (s.category || "").toLowerCase().includes("24h")),
      ),
      sleep: ahead((s) => s.group === "sleep"),
    };
  }, [recommended, rideKm]);

  const onSelectMarker = (id: string) => {
    if (!id) {
      setSelectedId(null);
      return;
    }
    const decision = decisions.find((d) => d.id === id);
    if (decision?.relatedStopId) {
      setSelectedId(decision.relatedStopId);
      return;
    }
    setSelectedId(id);
    const idx = recommended.findIndex((s) => s.id === id);
    if (idx >= 0) setVerifyIndex(idx);
  };

  const toggleQa = (id: QuickActionId) => {
    setQa((prev) => {
      const next = prev === id ? null : id;
      // Switching category replaces the question — clear selection if it no longer matches
      if (next && selectedId) {
        const m = allMarkers.find((x) => x.id === selectedId);
        if (m && !stopMatchesLayer(m, next)) setSelectedId(null);
      }
      return next;
    });
  };

  const onViewChange = (
    center: { lat: number; lon: number },
    bbox: PlanMapBBox,
    userMoved: boolean,
  ) => {
    setMapCenter(center);
    setMapBbox(bbox);
    // Chip appears only after the user moves the map (and a category is selected).
    if (userMoved && mode === "plan" && !searchingArea) setSearchPrompted(true);
  };

  const searchChip = resolvePlanSearchChip({
    mode,
    searching: searchingArea,
    prompted: searchPrompted,
    hasCategory: Boolean(qa),
    bbox: mapBbox,
  });

  const searchThisArea = async () => {
    if (!mapBbox || !route || searchingArea || !qa) return;
    const bbox = mapBbox;
    // Too zoomed out — never hit the API; exclusive zoomIn chip only.
    if (bboxSpanTooLarge(bbox)) {
      setSearchPrompted(true);
      return;
    }

    const gen = ++searchGenRef.current;
    searchAbortRef.current?.abort();
    const ac = new AbortController();
    searchAbortRef.current = ac;

    const SEARCH_BATCH = searchLimitForQa(qa, bbox);
    const activeQa = qa;
    const verifiedIds = verifiedIdSet([
      ...verifiedStops,
      ...(analysisRef.current?.recommendedStops || []).filter((s) => s.reviewStatus === "verified"),
    ]);

    setSearchingArea(true);
    setError((prev) => (isZoomInSearchError(prev) ? null : prev));
    let statusStep = 0;
    setSearchStatus(searchStatusForQa(activeQa, 0));
    if (searchStatusTimerRef.current != null) window.clearInterval(searchStatusTimerRef.current);
    searchStatusTimerRef.current = window.setInterval(() => {
      statusStep += 1;
      if (gen !== searchGenRef.current) return;
      setSearchStatus(searchStatusForQa(activeQa, statusStep));
    }, 900);

    const group = qaToOverpassGroup(activeQa);
    const exclude = Array.from(verifiedIds);
    const collected: RecommendedStop[] = [];
    let hardError = false;
    let thrown = false;
    let searchOk = false;
    const tClient = typeof performance !== "undefined" ? performance.now() : Date.now();

    // Abort at hard 5s — spinner must always stop; never stuck Searching.
    const timeoutId = window.setTimeout(() => {
      if (gen === searchGenRef.current) ac.abort();
    }, SEARCH_TIMEOUT_MS);

    try {
      // Single request — corridor cache makes tiling unnecessary.
      const res = await searchRouteViewportPois(route.id, bbox, {
        group,
        limit: SEARCH_BATCH,
        exclude,
        signal: ac.signal,
      });
      if (gen !== searchGenRef.current) return;
      const mapped = (res.pois || [])
        .map(mapViewportPoi)
        .sort((a, b) => (b.resupplyScore || 0) - (a.resupplyScore || 0));
      for (const s of mapped) {
        if (collected.some((c) => c.id === s.id)) continue;
        collected.push(s);
      }
      // Progressive: paint ASAP once we have results (before settle).
      if (collected.length > 0) {
        setSearchResults(replaceSearchResults(collected.slice(0, SEARCH_BATCH), verifiedIds));
        setSearchStatus(searchStatusForQa(activeQa, 2));
      }
      if (mapped.length === 0 && res.error && !isZoomInSearchError(res.error)) {
        hardError = true;
      }
      const clientMs =
        (typeof performance !== "undefined" ? performance.now() : Date.now()) - tClient;
      console.info("[rydn.search.apply]", {
        clientMs: Math.round(clientMs),
        rendered: Math.min(collected.length, SEARCH_BATCH),
        cache: res.cache,
        timings: res.timings,
      });
    } catch (err) {
      if (gen !== searchGenRef.current) return;
      if (isAbortError(err) || ac.signal.aborted) {
        // timeout / supersede — settle via outcome below
      } else {
        thrown = true;
        hardError = true;
      }
    } finally {
      window.clearTimeout(timeoutId);
      if (searchStatusTimerRef.current != null) {
        window.clearInterval(searchStatusTimerRef.current);
        searchStatusTimerRef.current = null;
      }
      if (gen !== searchGenRef.current) return;

      const outcome = resolveSearchOutcome({
        resultCount: collected.length,
        aborted: ac.signal.aborted,
        hardError,
        thrown,
      });

      if (outcome === "results" || outcome === "empty") {
        // Replace temporary workspace; verified untouched.
        setSearchResults(
          replaceSearchResults(collected.slice(0, SEARCH_BATCH), verifiedIds),
        );
        searchOk = true;
      } else {
        // Failed with zero usable POIs — keep previous temp, toast once.
        showToast(SEARCH_FAIL_TOAST);
        searchOk = false;
      }

      setSearchingArea(false);
      setSearchStatus(null);
      // Success/empty → hide until next pan. Fail → keep prompted for retry.
      setSearchPrompted(!searchOk);
      if (searchAbortRef.current === ac) searchAbortRef.current = null;
    }
  };

  if (error && !route) {
    return (
      <div className="ultra-page">
        <header className="ultra-page__nav">
          <button type="button" className="icon-btn" onClick={onBack} aria-label="Back">
            <Icon name="chevronLeft" size={22} />
          </button>
        </header>
        <div className="space-loading">{error}</div>
      </div>
    );
  }

  if (!route) {
    return (
      <div className="app-loading">
        <RydnLoader label="Opening route…" />
      </div>
    );
  }

  const prep = route.preparation;
  const done = CHECKS.filter((c) => prep[c.key]).length;
  const reviewing = reviewMotion?.stopId === selectedStop?.id ? reviewMotion : null;
  const locked = Boolean(reviewing);

  return (
    <div className={`plan-workspace${mode === "ride" ? " plan-workspace--ride" : ""}`}>
      <header className="plan-workspace__top">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="Back to Ultras">
          <Icon name="chevronLeft" size={20} />
        </button>
        <div className="plan-workspace__top-actions">
          <div className="route-mode-tabs" role="tablist" aria-label="Plan or Ride">
            <button
              type="button"
              role="tab"
              className={`chip${mode === "plan" ? " is-on" : ""}`}
              aria-selected={mode === "plan"}
              onClick={() => setMode("plan")}
            >
              Plan
            </button>
            <button
              type="button"
              role="tab"
              className={`chip${mode === "ride" ? " is-on" : ""}`}
              aria-selected={mode === "ride"}
              onClick={() => setMode("ride")}
            >
              Ride
            </button>
          </div>
        </div>
      </header>

      <div className="plan-workspace__stage">
        {/* Map paints immediately — analysis overlays in; never block with a modal */}
        <PlanMap
          points={route.points}
          markers={analysis ? visibleMarkers : []}
          selectedId={selectedId}
          fitKey={route.id}
          focusIds={focusIds}
          searching={searchingArea}
          onSelectMarker={onSelectMarker}
          onViewChange={onViewChange}
        />
        {analyzing && !analysis && (
          <div className="plan-workspace__analyzing" role="status" aria-live="polite">
            Analysing course…
          </div>
        )}

        {/* Top chrome: exclusive search chip + nearest card (never overlapping states). */}
        <div className="plan-map-top" data-testid="plan-map-top">
          {searchChip === "zoomIn" && (
            <div
              className="plan-search-chip plan-search-chip--hint"
              data-search-chip="zoomIn"
              role="status"
            >
              Zoom in to search this area
            </div>
          )}
          {searchChip === "ready" && (
            <button
              type="button"
              className="plan-search-chip plan-search-chip--action"
              data-search-chip="ready"
              onClick={() => void searchThisArea()}
            >
              Search this area
            </button>
          )}
          {searchChip === "searching" && (
            <div
              className="plan-search-chip plan-search-chip--busy"
              data-search-chip="searching"
              role="status"
              aria-live="polite"
              aria-busy="true"
            >
              <span className="plan-qa__spinner" aria-hidden />
              Searching…
            </div>
          )}

          {nearest && qa && analysis && (
            <aside className="plan-nearest" aria-label="Nearest for quick action">
              <p className="plan-nearest__label">
                Nearest {QUICK_ACTIONS.find((a) => a.id === qa)?.label || ""} ·{" "}
                {mode === "ride" ? "route progress" : "map center"}
              </p>
              <button
                type="button"
                className="plan-nearest__row"
                onClick={() => {
                  setSelectedId(nearest.marker.id);
                  setFocusIds([nearest.marker.id]);
                }}
              >
                <span>{nearest.marker.name || nearest.marker.category || "Stop"}</span>
                <span>
                  {nearest.km < 1
                    ? `${Math.round(nearest.km * 1000)} m`
                    : `${nearest.km.toFixed(1)} km`}
                </span>
              </button>
            </aside>
          )}
        </div>

        {/* Floating right stack — Layers sits with zoom controls */}
        {mode === "plan" && (
          <div className="plan-map-fab" aria-label="Map tools">
            <button
              type="button"
              className={`plan-map-fab__btn${layersOpen ? " is-on" : ""}`}
              aria-label="Layers"
              aria-pressed={layersOpen}
              onClick={() => {
                setLayersOpen((o) => !o);
                setOverflowOpen(false);
              }}
            >
              Layers
            </button>
            <button
              type="button"
              className={`plan-map-fab__btn${overflowOpen ? " is-on" : ""}`}
              aria-label="More"
              aria-pressed={overflowOpen}
              onClick={() => {
                setOverflowOpen((o) => !o);
                setLayersOpen(false);
              }}
            >
              ···
            </button>
          </div>
        )}

        {overflowOpen && mode === "plan" && (
          <aside className="plan-overflow" aria-label="More actions">
            <button
              type="button"
              className="plan-overflow__item"
              onClick={() => {
                setBriefingOpen(true);
                setOverflowOpen(false);
              }}
            >
              Briefing
            </button>
            <button
              type="button"
              className="plan-overflow__item"
              disabled={analyzing}
              onClick={() => {
                setOverflowOpen(false);
                void loadAnalysis({ refresh: true });
              }}
            >
              {analyzing ? "Refreshing…" : "Refresh"}
            </button>
            {searchChip === "ready" && (
              <button
                type="button"
                className="plan-overflow__item"
                onClick={() => {
                  setOverflowOpen(false);
                  void searchThisArea();
                }}
              >
                Search this area
              </button>
            )}
          </aside>
        )}

        {/* Quick Actions — Water / Markets / 24h / Sleep. Loading indicator inside active button. */}
        <nav className="plan-qa" aria-label="Quick actions">
          {QUICK_ACTIONS.map((a) => {
            const busy = searchingArea && qa === a.id;
            return (
              <button
                key={a.id}
                type="button"
                className={`plan-qa__btn${qa === a.id ? " is-on" : ""}${busy ? " is-loading" : ""}`}
                onClick={() => toggleQa(a.id)}
                aria-pressed={qa === a.id}
                aria-busy={busy || undefined}
                title={busy ? searchStatus || a.label : a.label}
              >
                <span className="plan-qa__icon" aria-hidden>
                  {busy ? <span className="plan-qa__spinner" /> : a.emoji}
                </span>
                <span>{a.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Layer toggles — floating panel from right FAB */}
        {layersOpen && mode === "plan" && (
          <aside className="plan-layers" aria-label="Map layers">
            <p className="plan-layers__title">Layers</p>
            <div className="plan-layers__grid">
              {LAYER_TOGGLES.map((L) => (
                <label key={L.id} className="plan-layers__item">
                  <input
                    type="checkbox"
                    checked={layers[L.id]}
                    onChange={() => setLayers((prev) => ({ ...prev, [L.id]: !prev[L.id] }))}
                  />
                  {L.label}
                </label>
              ))}
            </div>
            <div className="plan-layers__actions">
              <button
                type="button"
                className="plan-layers__link"
                onClick={() => {
                  setBriefingOpen(true);
                  setLayersOpen(false);
                }}
              >
                Briefing
              </button>
              <button
                type="button"
                className="plan-layers__link"
                disabled={analyzing}
                onClick={() => void loadAnalysis({ refresh: true })}
              >
                {analyzing ? "Refreshing…" : "Refresh"}
              </button>
            </div>
            <p className="plan-layers__note">
              Default is calm (verified + remote). Tap Water / Markets / 24h / Sleep for corridor
              POIs (~500 m). {PLAN_MAP_STYLE_NOTE}
            </p>
          </aside>
        )}

        {/* Ride Mode — position only; essentials via Quick Actions */}
        {mode === "ride" && (
          <aside className="plan-ride-panel plan-ride-panel--minimal" aria-label="Ride mode">
            <label className="field plan-ride-panel__pos">
              <span>Km {rideKm.toFixed(0)} · tap Water / Markets / 24h / Sleep</span>
              <input
                type="range"
                min={0}
                max={Math.max(1, route.distanceKm)}
                step={1}
                value={rideKm}
                onChange={(e) => setRideKm(Number(e.target.value))}
              />
            </label>
            {!qa && rideGlance.water && (
              <button
                type="button"
                className="plan-ride-panel__next"
                onClick={() => setSelectedId(rideGlance.water!.id)}
              >
                Next water · {(rideGlance.water.distanceAlongKm - rideKm).toFixed(0)} km ·{" "}
                {fmtEtaFromKm(rideGlance.water.distanceAlongKm - rideKm)}
              </button>
            )}
          </aside>
        )}

        {/* Compact stop sheet */}
        {(selectedStop || peek) && (
          <div
            className={`plan-sheet plan-sheet--compact${selectedStop?.reviewStatus === "verified" ? " plan-sheet--verified" : ""}`}
            role="dialog"
            aria-label="Selection"
          >
            <div className="plan-sheet__handle" aria-hidden />
            <button
              type="button"
              className="plan-sheet__close"
              aria-label="Close"
              onClick={() => setSelectedId(null)}
            >
              ×
            </button>
            {selectedStop && (
              <>
                <p className="plan-sheet__eyebrow">
                  <RydnPlanIcon
                    id={iconForCategory(selectedStop.category, selectedStop.group)}
                    size={14}
                    className="plan-sheet__eyebrow-icon"
                  />
                  {selectedStop.category}
                  {selectedStop.is24h ? " · 24h" : ""}
                </p>
                <h2 className="plan-sheet__title">{selectedStop.name || selectedStop.category}</h2>
                <p className="plan-sheet__rating">
                  {selectedStop.distanceOffRouteM != null
                    ? `${selectedStop.distanceOffRouteM} m off route`
                    : "On route"}
                  {selectedStop.openingHours ? ` · ${selectedStop.openingHours}` : ""}
                </p>
                <div className="plan-sheet__actions">
                  <a
                    className="btn"
                    href={mapsLinks(selectedStop.lat, selectedStop.lon, selectedStop.name).google}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Navigate
                  </a>
                  <a
                    className="btn btn--ghost"
                    href={
                      selectedStop.googleMapsUrl ||
                      mapsLinks(selectedStop.lat, selectedStop.lon, selectedStop.name).place
                    }
                    target="_blank"
                    rel="noreferrer"
                  >
                    Maps
                  </a>
                  <a
                    className="btn btn--ghost"
                    href={mapsLinks(selectedStop.lat, selectedStop.lon, selectedStop.name).streetView}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Street View
                  </a>
                  <button
                    type="button"
                    className={`btn btn--ghost${reviewing?.status === "verified" ? " btn--working" : ""}`}
                    disabled={locked && reviewing?.status !== "verified"}
                    aria-busy={reviewing?.status === "verified" || undefined}
                    onClick={() => reviewStop(selectedStop.id, "verified")}
                  >
                    {reviewing?.status === "verified" && reviewing.phase === "confirming" && (
                      <span className="btn__spinner" aria-hidden />
                    )}
                    {selectedStop.reviewStatus === "verified" ? "Verified" : "Verify"}
                  </button>
                </div>
              </>
            )}
            {peek?.kind === "climb" && (
              <>
                <p className="plan-sheet__eyebrow">Climb</p>
                <h2 className="plan-sheet__title">
                  {peek.climb.name || `Climb · km ${peek.climb.startKm.toFixed(0)}`}
                </h2>
                <p className="plan-sheet__rating">
                  km {peek.climb.startKm.toFixed(0)}–{peek.climb.endKm.toFixed(0)} ·{" "}
                  {peek.climb.lengthKm.toFixed(1)} km · {peek.climb.elevationGainM} m · avg{" "}
                  {peek.climb.avgGradientPct}%
                  {peek.climb.estimatedClimbTimeS
                    ? ` · ~${fmtDuration(peek.climb.estimatedClimbTimeS)}`
                    : ""}
                </p>
              </>
            )}
            {peek?.kind === "remote" && (
              <>
                <p className="plan-sheet__eyebrow">Remote · {peek.gap.riskLevel}</p>
                <h2 className="plan-sheet__title">{peek.gap.label}</h2>
                <p className="plan-sheet__why">{peek.gap.preparation}</p>
              </>
            )}
            {peek?.kind === "decision" && (
              <>
                <p className="plan-sheet__eyebrow">Critical decision</p>
                <h2 className="plan-sheet__title">{peek.decision.title}</h2>
                <p className="plan-sheet__why">
                  {peek.decision.detail} — {peek.decision.advice}
                </p>
              </>
            )}
          </div>
        )}
      </div>

      {/* Briefing drawer — secondary editorial content */}
      {briefingOpen && mode === "plan" && analysis && (
        <aside className="plan-briefing" aria-label="Planning briefing">
          <div className="plan-briefing__tabs">
            {(
              [
                ["critical", "Critical"],
                ["stops", "Stops"],
                ["climbs", "Climbs"],
                ["stages", "Stages"],
                ["verify", `Verify · ${verifiedCount}/${recommended.length || 0}`],
                ["prep", "Prep"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`chip${briefingTab === id ? " is-on" : ""}`}
                onClick={() => setBriefingTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="plan-briefing__body">
            {briefingTab === "critical" && (
              <>
                <h2 className="plan-briefing__heading">Critical decisions</h2>
                {decisions.length === 0 ? (
                  <p className="space__hint">No critical decisions yet.</p>
                ) : (
                  <div className="plan-list">
                    {decisions.map((d) => (
                      <button
                        type="button"
                        key={d.id}
                        className="plan-row plan-row--click"
                        onClick={() => {
                          setSelectedId(d.relatedStopId || d.id);
                          setBriefingOpen(false);
                        }}
                      >
                        <div className="plan-row__main">
                          <span className="plan-row__title">{d.title}</span>
                          <span className="plan-row__meta">
                            km {d.km.toFixed(0)} · {d.detail}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            {briefingTab === "stops" && (
              <>
                <h2 className="plan-briefing__heading">
                  Recommended · {pendingCount} left
                </h2>
                <div className="plan-list plan-list--compact">
                  {recommended.map((s) => (
                    <button
                      type="button"
                      key={s.id}
                      className={`plan-row plan-row--click plan-row--${s.reviewStatus}`}
                      onClick={() => {
                        setSelectedId(s.id);
                        setBriefingOpen(false);
                      }}
                    >
                      <div className="plan-row__main">
                        <span className="plan-row__title">
                          {s.name || s.category}
                          <span className="plan-pill plan-pill--quiet">{s.reviewStatus}</span>
                        </span>
                        <span className="plan-row__meta">
                          km {s.distanceAlongKm.toFixed(0)} · {s.category}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}

            {briefingTab === "climbs" && (
              <>
                <h2 className="plan-briefing__heading">Major climbs</h2>
                <div className="plan-list">
                  {analysis.climbs.map((c) => (
                    <button
                      type="button"
                      key={c.id}
                      className="plan-row plan-row--click"
                      onClick={() => {
                        setSelectedId(c.id);
                        setBriefingOpen(false);
                      }}
                    >
                      <div className="plan-row__main">
                        <span className="plan-row__title">
                          {c.name || `Climb · km ${c.startKm.toFixed(0)}`}
                        </span>
                        <span className="plan-row__meta">
                          {c.lengthKm.toFixed(1)} km · {c.elevationGainM} m · avg {c.avgGradientPct}%
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}

            {briefingTab === "stages" && (
              <>
                <h2 className="plan-briefing__heading">Stage plan</h2>
                <div className="plan-stage-controls">
                  <label className="field">
                    <span>Target km / day</span>
                    <input
                      type="number"
                      min={60}
                      max={400}
                      step={10}
                      value={targetKm}
                      onChange={(e) => setTargetKm(Number(e.target.value) || 250)}
                      disabled={analyzing}
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    disabled={analyzing}
                    onClick={() => void loadAnalysis({ targetStageKm: targetKm })}
                  >
                    Recalculate
                  </button>
                </div>
                <div className="plan-list">
                  {analysis.stages.map((s) => (
                    <div className="plan-row" key={s.index}>
                      <div className="plan-row__main">
                        <span className="plan-row__title">
                          {s.label}
                          <span className="plan-pill plan-pill--quiet">{s.distanceKm} km</span>
                        </span>
                        <span className="plan-row__meta">
                          km {s.startKm.toFixed(0)}–{s.endKm.toFixed(0)} · {s.reason}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {briefingTab === "verify" && (
              <>
                <h2 className="plan-briefing__heading">Verify deck</h2>
                <p className="ua-block__lead">
                  {verifiedCount} verified · {pendingCount} remaining. Tap Verify on the map sheet, or
                  step through here.
                </p>
                {verifyStop ? (
                  <div className="plan-verify-mini">
                    <p className="plan-sheet__eyebrow">
                      Stop {verifyIndex + 1} of {recommended.length}
                    </p>
                    <h3 className="plan-sheet__title">{verifyStop.name || verifyStop.category}</h3>
                    <p className="plan-sheet__why">{recommendWhy(verifyStop)}</p>
                    <div className="plan-sheet__actions">
                      {(["verified", "rejected", "skipped"] as ReviewStatus[]).map((status) => (
                        <button
                          key={status}
                          type="button"
                          className={`btn${status !== "verified" ? " btn--ghost" : ""}`}
                          disabled={Boolean(reviewMotion)}
                          onClick={() => reviewStop(verifyStop.id, status)}
                        >
                          {REVIEW_LABELS[status].idle}
                        </button>
                      ))}
                    </div>
                    <div className="verify-card__nav">
                      <button
                        type="button"
                        className="btn btn--ghost"
                        disabled={verifyIndex <= 0 || Boolean(reviewMotion)}
                        onClick={() => {
                          const next = Math.max(0, verifyIndex - 1);
                          setVerifyIndex(next);
                          setSelectedId(recommended[next]?.id ?? null);
                        }}
                      >
                        Previous
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost"
                        disabled={verifyIndex >= recommended.length - 1 || Boolean(reviewMotion)}
                        onClick={() => {
                          const next = Math.min(recommended.length - 1, verifyIndex + 1);
                          setVerifyIndex(next);
                          setSelectedId(recommended[next]?.id ?? null);
                        }}
                      >
                        Next
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="space__hint">No recommendations to verify yet.</p>
                )}
              </>
            )}

            {briefingTab === "prep" && (
              <>
                <h2 className="plan-briefing__heading">Preparation</h2>
                <label className="field" style={{ marginBottom: 12 }}>
                  <span>Route name</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={() => void saveName()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                    disabled={busy}
                    aria-label="Route name"
                  />
                </label>
                <div className="ultra-page__score" style={{ marginBottom: 12 }}>
                  <ScoreLine
                    distanceKm={route.distanceKm}
                    elevationGainM={route.elevationGainM}
                    durationS={0}
                    hideDuration
                  />
                </div>
                <div className="plan-dates">
                  <label className="field">
                    <span>Start</span>
                    <input
                      type="date"
                      value={dateStart}
                      onChange={(e) => setDateStart(e.target.value)}
                      onBlur={() => void saveDates()}
                      disabled={busy}
                    />
                  </label>
                  <label className="field">
                    <span>End</span>
                    <input
                      type="date"
                      value={dateEnd}
                      onChange={(e) => setDateEnd(e.target.value)}
                      onBlur={() => void saveDates()}
                      disabled={busy}
                    />
                  </label>
                </div>
                <label className="field">
                  <span className="visually-hidden">Notes</span>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    onBlur={() => void saveNotes()}
                    placeholder="Hotel bookings, customs, shops you already trust…"
                    rows={3}
                    disabled={busy}
                  />
                </label>
                <p className="ua-block__lead" style={{ marginTop: 16 }}>
                  Checklist · {done}/{CHECKS.length}
                </p>
                <ul className="verify-list">
                  {CHECKS.map((c) => (
                    <li key={c.key}>
                      <label className={`verify-row${prep[c.key] ? " is-done" : ""}`}>
                        <input
                          type="checkbox"
                          checked={!!prep[c.key]}
                          disabled={busy}
                          onChange={() => void toggleCheck(c.key)}
                        />
                        <span>
                          <span className="verify-row__label">{c.label}</span>
                          <span className="verify-row__hint">{c.doneHint(analysis)}</span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="btn btn--ghost"
                  style={{ marginTop: 16 }}
                  onClick={() => void onDelete()}
                  disabled={busy}
                >
                  Delete route
                </button>
              </>
            )}
          </div>
        </aside>
      )}

      {toast && (
        <div className="plan-toast" role="status" aria-live="polite" data-testid="plan-toast">
          {toast}
        </div>
      )}

      {error && !isZoomInSearchError(error) && (
        <div className="banner banner--err plan-workspace__err">{error}</div>
      )}
    </div>
  );
}
