import { useMemo } from "react";
import type { AppTab, RoadbookResult } from "../api";
import { useRenderTrace } from "../debug/raceOpenTrace";
import DashboardBriefingCards from "../components/dashboard/DashboardBriefingCards";
import DashboardRouteOverviewMap from "../components/dashboard/DashboardRouteOverviewMap";
import { useHighlightHoverSync } from "../components/dashboard/useHighlightHoverSync";
import { formatKm } from "../components/routeInsights";
import { usePlanning } from "../planning/PlanningContext";
import { analyzeClimbs, selectKeyClimbs } from "../planning/climbAnalysis";
import { briefingHighlightIntent } from "../planning/planningIntent";
import {
  buildRouteHighlights,
  dashboardOverviewHighlights,
} from "../planning/routeHighlights";
import { presentSuggestedStops } from "../planning/suggestedStops";
import CompanionVerificationReview from "../components/verification/CompanionVerificationReview";
import { PreparationProgress } from "../components/races/RaceCard";
import { useRace } from "../races/RaceContext";
import { computeDashboardStatsFromRoadbook } from "../races/dashboardStats";
import { verifiedStopKey } from "../planning/stopVerification/types";
import type { VerifiedStopRecord } from "../planning/stopVerification/types";
import type { ResupplyZone } from "../api";
import type { StopConfidenceInput } from "@shared/race/stopConfidence";
import { StopConfidenceOverview } from "@shared/ui/StopConfidenceDisplay";
import {
  formatLastVerification,
  RaceStatsGrid,
  ReadinessReasonsList,
  ReadinessScoreBadge,
  ReadinessStatusHeader,
} from "@shared/ui/RaceReadinessDisplay";
import { useSettings } from "../settings/SettingsContext";

interface DashboardPageProps {
  result: RoadbookResult;
  raceId: string;
  onNavigate: (tab: AppTab) => void;
}

/** Climb highlights belong on Key climbs — briefing focuses on resupply, surface, and route context. */
function briefingHighlightsWithoutClimbs<T extends { id: string }>(
  highlights: T[],
  hasKeyClimbs: boolean,
): T[] {
  if (!hasKeyClimbs) {
    return highlights;
  }
  return highlights.filter(
    (highlight) => highlight.id !== "hardest-climb" && highlight.id !== "longest-climb",
  );
}

function primaryPoi(zone: ResupplyZone) {
  for (const key of ["water", "food", "fuel"] as const) {
    const group = zone.categories.find((item) => item.key === key);
    if (group?.primary) {
      return group.primary;
    }
  }
  return zone.categories.find((group) => group.primary)?.primary ?? null;
}

function stopConfidenceInputs(
  zones: ResupplyZone[],
  verifiedStops: Record<string, VerifiedStopRecord>,
): Array<StopConfidenceInput & { name: string; zoneId: number }> {
  return zones.map((zone) => {
    const poi = primaryPoi(zone);
    const record = verifiedStops[verifiedStopKey(zone.zone_id)];
    const status = record?.status;
    let verificationStatus: StopConfidenceInput["verificationStatus"] = "unverified";
    if (status === "verified") {
      verificationStatus = "verified";
    } else if (status === "rejected") {
      verificationStatus = "rejected";
    } else if (status === "deferred") {
      verificationStatus = "deferred";
    }
    return {
      zoneId: zone.zone_id,
      name: poi?.name?.trim() || zone.name || `Zone ${zone.zone_id}`,
      verificationStatus,
      verifiedAt: record?.updatedAt ?? null,
      poiScore: poi?.score ?? null,
      openingHours: poi?.opening_hours ?? null,
      website: poi?.website ?? null,
      phone: poi?.phone ?? null,
    };
  });
}

export default function DashboardPage({ result, raceId, onNavigate }: DashboardPageProps) {
  useRenderTrace("render.dashboard.start", "render.dashboard.done");
  const { activeRace, refreshRaces, verifiedStops } = useRace();
  const { settings } = useSettings();
  const { timeMode, setPlanningIntent } = usePlanning();
  const { hoveredHighlightId, setHoveredHighlightId } = useHighlightHoverSync();

  const dashboardStats = useMemo(() => {
    const assumptions = settings?.planning
      ? {
          ridingSpeedKmh: 20,
          climbingPenaltyMinPer100m: 3,
          waterMlPerHour: 500,
          carbsGPerHour: 60,
          maxGapWithoutResupplyKm: settings.planning.max_gap_without_resupply_km,
        }
      : undefined;
    return computeDashboardStatsFromRoadbook(result, verifiedStops, assumptions);
  }, [result, settings?.planning, verifiedStops]);

  const presentedZones = useMemo(
    () => presentSuggestedStops(result, timeMode),
    [result, timeMode],
  );

  const highlights = useMemo(
    () =>
      buildRouteHighlights(
        result.climbs,
        presentedZones,
        result.route,
        result.summary.distance_km,
      ),
    [result.climbs, presentedZones, result.route, result.summary.distance_km],
  );

  const overviewHighlights = useMemo(
    () => dashboardOverviewHighlights(highlights),
    [highlights],
  );

  const keyClimbs = useMemo(
    () => selectKeyClimbs(analyzeClimbs(result.climbs)),
    [result.climbs],
  );

  const briefingHighlights = useMemo(
    () => briefingHighlightsWithoutClimbs(overviewHighlights, keyClimbs.length > 0),
    [overviewHighlights, keyClimbs.length],
  );

  const stopConfidence = useMemo(
    () => stopConfidenceInputs(presentedZones, verifiedStops),
    [presentedZones, verifiedStops],
  );

  const hardestClimb = keyClimbs[0] ?? null;

  function handleSelectHighlight(highlight: (typeof highlights)[number]) {
    setPlanningIntent(briefingHighlightIntent(highlight.id, "route"));
    onNavigate("route");
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <header className="mb-10">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Dashboard</h1>
        <p className="mt-2 text-base text-muted">
          What should I know before I start planning?
        </p>
      </header>

      <CompanionVerificationReview raceId={raceId} onReviewed={() => void refreshRaces()} />

      <section className="mb-10 rounded-2xl border border-line bg-card p-6 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <ReadinessStatusHeader
              score={dashboardStats.readiness_score}
              unverifiedStops={dashboardStats.unverified_stops}
            />
            <p className="mt-2 text-sm text-muted">
              Computed from verification, resupply coverage, and opening hours.
            </p>
          </div>
          <ReadinessScoreBadge score={dashboardStats.readiness_score} />
        </div>
        <div className="mt-5">
          <RaceStatsGrid stats={dashboardStats} />
        </div>
        <ReadinessReasonsList reasons={dashboardStats.readiness_reasons} className="mt-4" />
        <p className="mt-4 text-xs text-muted">
          Last verified {formatLastVerification(dashboardStats.last_verification_at)}
        </p>
      </section>

      <section className="mb-10 rounded-2xl border border-line bg-card p-6 shadow-card">
        <h2 className="text-sm font-medium text-ink">Stop confidence</h2>
        <p className="mt-1 text-sm text-muted">
          Based on verification age, confirmations, and POI data quality.
        </p>
        <div className="mt-4">
          <StopConfidenceOverview stops={stopConfidence} />
        </div>
      </section>

      <section className="mb-10">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
          Route summary
        </h2>
        <p className="mt-2 text-lg font-medium tracking-tight text-ink">
          {result.summary.route_name}
        </p>
        <p className="mt-1 text-sm text-muted">
          {formatKm(result.summary.distance_km, 0)}
          <span className="mx-2 text-line">·</span>
          +{Math.round(result.summary.elevation_gain_m)} m
          <span className="mx-2 text-line">·</span>
          {result.summary.climb_count} climbs
        </p>
      </section>

      <section className="mb-12">
        <h2 className="text-sm font-medium text-ink">Race briefing</h2>
        <p className="mt-1 mb-4 text-sm text-muted">
          Biggest non-climb challenges — resupply gaps, surface, and route extremes.
        </p>
        <DashboardBriefingCards
          highlights={briefingHighlights}
          hardestClimb={hardestClimb}
          hoveredHighlightId={hoveredHighlightId}
          onHighlightHover={setHoveredHighlightId}
          onSelectHighlight={handleSelectHighlight}
        />
      </section>

      <section className="mb-12">
        <h2 className="text-sm font-medium text-ink">Geographic overview</h2>
        <p className="mt-1 mb-4 text-sm text-muted">
          Where challenges sit along the route — hover to locate them on the map.
        </p>
        <DashboardRouteOverviewMap
          route={result.route}
          highlights={overviewHighlights}
          hoveredHighlightId={hoveredHighlightId}
          onHighlightHover={setHoveredHighlightId}
          onSelectHighlight={handleSelectHighlight}
        />
      </section>

      <section className="mb-16">
        <div className="rounded-2xl border border-accent/20 bg-accent/[0.04] p-5 shadow-card">
          <h2 className="text-sm font-medium text-ink">Build your trusted race plan</h2>
          <p className="mt-1 text-sm text-muted">
            Verify stops one at a time — the most important decisions first.
          </p>
          <button
            type="button"
            onClick={() => onNavigate("verify")}
            className="mt-4 rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-accent/90"
          >
            Start stop verification
          </button>
        </div>
      </section>

      {activeRace && (
        <section className="mb-16">
          <h2 className="text-sm font-medium text-ink">Race preparation</h2>
          <p className="mt-1 mb-4 text-sm text-muted">
            How prepared are you for this race?
          </p>
          <div className="rounded-2xl border border-line bg-card p-5 shadow-card">
            <PreparationProgress
              race={activeRace}
              onNavigateToVerify={() => onNavigate("verify")}
            />
          </div>
        </section>
      )}

      <section className="mb-16">
        <div className="rounded-2xl border border-line bg-card p-6 shadow-card">
          <h2 className="text-lg font-semibold text-ink">Route Preview</h2>
          <p className="mt-1 text-sm text-muted">
            Ride through the route before race day — smooth flyover with brief context at key moments.
          </p>
          <button
            type="button"
            onClick={() => onNavigate("preview")}
            className="mt-5 rounded-xl bg-ink px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-ink/90"
          >
            Open Route Preview
          </button>
        </div>
      </section>
    </div>
  );
}
