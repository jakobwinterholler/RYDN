import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppTab, RoadbookResult } from "../api";
import StopVerificationCard from "../components/verification/StopVerificationCard";
import StopVerificationActions from "../components/verification/StopVerificationActions";
import StopVerificationComplete from "../components/verification/StopVerificationComplete";
import StopVerificationProgress from "../components/verification/StopVerificationProgress";
import StopRejectReasonSheet from "../components/verification/StopRejectReasonSheet";
import VerifiedPlanOverview from "../components/verification/VerifiedPlanOverview";
import VerificationOverviewHub from "../components/verification/VerificationOverviewHub";
import { usePlanning } from "../planning/PlanningContext";
import { usePlanningAssumptions } from "../planning/usePlanningAssumptions";
import { presentSuggestedStops } from "../planning/suggestedStops";
import {
  batchIsComplete,
  countBatchPending,
  firstPendingInList,
  nextPendingInList,
  remainingCandidateCount,
  selectNextBatch,
  VERIFICATION_BATCH_SIZE,
} from "../planning/stopVerification/batchSelection";
import {
  buildVerificationRoute,
  isStopPending,
  verificationProgress,
} from "../planning/stopVerification/priority";
import { buildVerifiedPlan } from "../planning/stopVerification/verifiedPlan";
import { verifiedStopContext } from "../planning/stopVerification/verifiedStopContext";
import { buildRejectFeedbackContext } from "../planning/stopVerification/buildRejectFeedback";
import {
  findNearbyAlternativeStops,
  hasNearbyAlternatives,
  type NearbyAlternativeStop,
} from "../planning/stopVerification/nearbyAlternatives";
import type { PrioritizedStop } from "../planning/stopVerification/priority";
import type { StopRejectReason, VerifiedStopRecord } from "../planning/stopVerification/types";
import { verifiedStopKey } from "../planning/stopVerification/types";
import { buildHubRecommendations } from "../planning/hubRecommendations";
import { updateRacePreparation } from "../races/api";
import { useRace } from "../races/RaceContext";

interface StopVerificationPageProps {
  result: RoadbookResult;
  onNavigate: (tab: AppTab) => void;
}

function poiKeyFromZone(osmType: string, osmId: number): string {
  return `${osmType}-${osmId}`;
}

type VerifyViewMode = "overview" | "cards";

interface AlternativeBranch {
  anchorName: string;
  alternatives: NearbyAlternativeStop[];
  index: number;
  resumeBatchIndex: number;
}

export default function StopVerificationPage({ result, onNavigate }: StopVerificationPageProps) {
  const { timeMode } = usePlanning();
  const { arrivalTimeWindow } = usePlanningAssumptions();
  const { verifiedStops, saveVerifiedStop, markPreparation, activeRaceId } = useRace();
  const [rejectingZoneId, setRejectingZoneId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [activeBatch, setActiveBatch] = useState<PrioritizedStop[] | null>(null);
  const [roundNumber, setRoundNumber] = useState(0);
  const [planFinished, setPlanFinished] = useState(false);
  const [viewMode, setViewMode] = useState<VerifyViewMode>("overview");
  const [alternativeBranch, setAlternativeBranch] = useState<AlternativeBranch | null>(null);
  const [lastUndo, setLastUndo] = useState<{
    zoneId: number;
    previous: VerifiedStopRecord | null;
    batchIndex: number;
  } | null>(null);
  const batchInitRef = useRef(false);

  const suggestedStops = useMemo(
    () => presentSuggestedStops(result, timeMode),
    [result, timeMode],
  );

  const fullRoute = useMemo(
    () =>
      buildVerificationRoute(
        suggestedStops,
        result.route,
        result.summary.distance_km,
        arrivalTimeWindow,
        timeMode,
      ),
    [suggestedStops, result.route, result.summary.distance_km, arrivalTimeWindow, timeMode],
  );

  const verifiedPlan = useMemo(
    () =>
      buildVerifiedPlan(
        fullRoute,
        verifiedStops,
        result.route,
        result.summary.distance_km,
        suggestedStops,
      ),
    [fullRoute, verifiedStops, result.route, result.summary.distance_km, suggestedStops],
  );

  const progress = useMemo(
    () => verificationProgress(suggestedStops, verifiedStops),
    [suggestedStops, verifiedStops],
  );

  const remainingCandidates = useMemo(
    () => remainingCandidateCount(suggestedStops, verifiedStops),
    [suggestedStops, verifiedStops],
  );

  const batchActive = activeBatch !== null && activeBatch.length > 0;
  const batchComplete = batchActive && batchIsComplete(activeBatch, verifiedStops);
  const batchPending = batchActive ? countBatchPending(activeBatch, verifiedStops) : 0;
  const reviewingBatch = batchActive && !batchComplete;

  const effectiveCurrent = useMemo((): PrioritizedStop | null => {
    if (alternativeBranch) {
      return alternativeBranch.alternatives[alternativeBranch.index]?.stop ?? null;
    }
    if (reviewingBatch && activeBatch) {
      return activeBatch[currentIndex] ?? null;
    }
    return null;
  }, [alternativeBranch, reviewingBatch, activeBatch, currentIndex]);

  const currentPending = effectiveCurrent
    ? isStopPending(effectiveCurrent.zone.zone_id, verifiedStops)
    : false;

  const showAlternativeActions = useMemo(
    () =>
      effectiveCurrent !== null &&
      alternativeBranch === null &&
      hasNearbyAlternatives(effectiveCurrent, result.resupply_zones, verifiedStops),
    [effectiveCurrent, alternativeBranch, result.resupply_zones, verifiedStops],
  );

  const showingVerificationCard =
    viewMode === "cards" && batchActive && effectiveCurrent !== null && (alternativeBranch !== null || reviewingBatch);

  const rejectedCount = useMemo(
    () =>
      suggestedStops.filter((zone) => {
        const status = verifiedStops[verifiedStopKey(zone.zone_id)]?.status;
        return status === "rejected" || status === "deferred";
      }).length,
    [suggestedStops, verifiedStops],
  );

  useEffect(() => {
    batchInitRef.current = false;
    setActiveBatch(null);
    setRoundNumber(0);
    setPlanFinished(false);
    setCurrentIndex(0);
    setViewMode("overview");
    setAlternativeBranch(null);
  }, [activeRaceId]);

  useEffect(() => {
    if (batchComplete && viewMode === "cards" && !alternativeBranch) {
      setViewMode("overview");
    }
  }, [batchComplete, viewMode, alternativeBranch]);

  useEffect(() => {
    if (!reviewingBatch || batchInitRef.current) {
      return;
    }
    const startIndex = firstPendingInList(activeBatch!, verifiedStops);
    setCurrentIndex(startIndex >= 0 ? startIndex : 0);
    batchInitRef.current = true;
  }, [activeBatch, reviewingBatch, verifiedStops]);

  useEffect(() => {
    if (reviewingBatch && activeBatch && currentIndex >= activeBatch.length) {
      setCurrentIndex(Math.max(0, activeBatch.length - 1));
    }
  }, [currentIndex, activeBatch, reviewingBatch]);

  const handleStartBatch = useCallback(() => {
    const batch = selectNextBatch(
      suggestedStops,
      result.route,
      result.summary.distance_km,
      verifiedStops,
      arrivalTimeWindow,
      timeMode,
      VERIFICATION_BATCH_SIZE,
    );
    if (batch.length === 0) {
      return;
    }
    batchInitRef.current = false;
    setActiveBatch(batch);
    setRoundNumber((round) => round + 1);
    setCurrentIndex(0);
  }, [
    suggestedStops,
    result.route,
    result.summary.distance_km,
    verifiedStops,
    arrivalTimeWindow,
    timeMode,
  ]);

  const handleFinishPlan = useCallback(() => {
    setPlanFinished(true);
    setActiveBatch(null);
    setViewMode("overview");
    void markPreparation("stops_verified", true);
  }, [markPreparation]);

  const handleContinueVerification = useCallback(() => {
    if (!batchActive || batchComplete) {
      handleStartBatch();
    } else {
      batchInitRef.current = false;
    }
    setViewMode("cards");
  }, [batchActive, batchComplete, handleStartBatch]);

  const handleBackToOverview = useCallback(() => {
    setViewMode("overview");
    setAlternativeBranch(null);
  }, []);

  const startAlternativeBranch = useCallback(
    (
      anchor: PrioritizedStop,
      resumeBatchIndex: number,
      updatedStops: Record<string, import("../races/api").VerifiedStopRecord>,
    ): boolean => {
      const alternatives = findNearbyAlternativeStops(
        anchor,
        result.resupply_zones,
        fullRoute,
        updatedStops,
        arrivalTimeWindow,
        timeMode,
      );
      if (alternatives.length === 0) {
        return false;
      }
      setAlternativeBranch({
        anchorName: anchor.zone.name,
        alternatives,
        index: 0,
        resumeBatchIndex,
      });
      return true;
    },
    [result.resupply_zones, fullRoute, arrivalTimeWindow, timeMode],
  );

  const exitAlternativeBranch = useCallback(
    (updatedStops: Record<string, import("../races/api").VerifiedStopRecord>) => {
      if (!alternativeBranch || !activeBatch) {
        setAlternativeBranch(null);
        return;
      }
      const resumeAt = alternativeBranch.resumeBatchIndex;
      setAlternativeBranch(null);
      if (batchIsComplete(activeBatch, updatedStops)) {
        setViewMode("overview");
        return;
      }
      const nextIndex = nextPendingInList(activeBatch, updatedStops, resumeAt);
      if (nextIndex >= 0) {
        setCurrentIndex(nextIndex);
      }
    },
    [alternativeBranch, activeBatch],
  );

  const advanceAfterDecision = useCallback(
    (
      fromIndex: number,
      updatedStops: Record<string, import("../races/api").VerifiedStopRecord>,
    ) => {
      if (!activeBatch) {
        return;
      }
      if (alternativeBranch) {
        const nextAlternative = alternativeBranch.index + 1;
        if (nextAlternative < alternativeBranch.alternatives.length) {
          setAlternativeBranch({ ...alternativeBranch, index: nextAlternative });
          return;
        }
        exitAlternativeBranch(updatedStops);
        return;
      }
      const nextIndex = nextPendingInList(activeBatch, updatedStops, fromIndex);
      if (nextIndex >= 0) {
        setCurrentIndex(nextIndex);
      }
    },
    [activeBatch, alternativeBranch, exitAlternativeBranch],
  );

  const goPrevious = useCallback(() => {
    if (alternativeBranch) {
      setAlternativeBranch({
        ...alternativeBranch,
        index: Math.max(0, alternativeBranch.index - 1),
      });
      return;
    }
    setCurrentIndex((index) => Math.max(0, index - 1));
  }, [alternativeBranch]);

  const goNext = useCallback(() => {
    if (alternativeBranch) {
      setAlternativeBranch({
        ...alternativeBranch,
        index: Math.min(alternativeBranch.alternatives.length - 1, alternativeBranch.index + 1),
      });
      return;
    }
    if (!activeBatch) {
      return;
    }
    setCurrentIndex((index) => Math.min(activeBatch.length - 1, index + 1));
  }, [activeBatch, alternativeBranch]);

  const persistDecision = useCallback(
    async (
      zoneId: number,
      status: "verified" | "rejected" | "deferred",
      rejectReason?: StopRejectReason,
      rejectNotes?: string,
      batchIndex?: number,
    ) => {
      setSaving(true);
      try {
        const previous = verifiedStops[verifiedStopKey(zoneId)] ?? null;
        if (batchIndex !== undefined) {
          setLastUndo({ zoneId, previous, batchIndex });
        }
        const zone = suggestedStops.find((entry) => entry.zone_id === zoneId);
        const best = zone ? buildHubRecommendations(zone).best : null;
        await saveVerifiedStop(zoneId, {
          status,
          rejectReason,
          rejectNotes,
          feedbackContext:
            status === "rejected" && zone && rejectReason
              ? buildRejectFeedbackContext(zone, best, rejectReason)
              : undefined,
          poiKey: best ? poiKeyFromZone(best.poi.osm_type, best.poi.osm_id) : undefined,
          updatedAt: new Date().toISOString(),
        });
        return true;
      } finally {
        setSaving(false);
      }
    },
    [suggestedStops, saveVerifiedStop, verifiedStops],
  );

  const handleVerify = useCallback(async () => {
    if (!effectiveCurrent || saving || !currentPending) {
      return;
    }
    const zoneId = effectiveCurrent.zone.zone_id;
    const batchIndex = alternativeBranch ? alternativeBranch.resumeBatchIndex : currentIndex;
    await persistDecision(zoneId, "verified", undefined, undefined, batchIndex);
    const updatedStops = {
      ...verifiedStops,
      [verifiedStopKey(zoneId)]: {
        status: "verified" as const,
        updatedAt: new Date().toISOString(),
      },
    };
    advanceAfterDecision(batchIndex, updatedStops);
  }, [
    effectiveCurrent,
    saving,
    currentPending,
    alternativeBranch,
    currentIndex,
    persistDecision,
    verifiedStops,
    advanceAfterDecision,
  ]);

  const handleVerifyAndAlternatives = useCallback(async () => {
    if (!effectiveCurrent || saving || !currentPending || alternativeBranch) {
      return;
    }
    const anchor = effectiveCurrent;
    const zoneId = anchor.zone.zone_id;
    await persistDecision(zoneId, "verified", undefined, undefined, currentIndex);
    const updatedStops = {
      ...verifiedStops,
      [verifiedStopKey(zoneId)]: {
        status: "verified" as const,
        updatedAt: new Date().toISOString(),
      },
    };
    const started = startAlternativeBranch(anchor, currentIndex, updatedStops);
    if (!started) {
      advanceAfterDecision(currentIndex, updatedStops);
    }
  }, [
    effectiveCurrent,
    saving,
    currentPending,
    alternativeBranch,
    currentIndex,
    persistDecision,
    verifiedStops,
    startAlternativeBranch,
    advanceAfterDecision,
  ]);

  const handleDontVerifyAndAlternatives = useCallback(async () => {
    if (!effectiveCurrent || saving || !currentPending || alternativeBranch) {
      return;
    }
    const anchor = effectiveCurrent;
    const zoneId = anchor.zone.zone_id;
    await persistDecision(zoneId, "deferred", undefined, undefined, currentIndex);
    const updatedStops = {
      ...verifiedStops,
      [verifiedStopKey(zoneId)]: {
        status: "deferred" as const,
        updatedAt: new Date().toISOString(),
      },
    };
    const started = startAlternativeBranch(anchor, currentIndex, updatedStops);
    if (!started) {
      advanceAfterDecision(currentIndex, updatedStops);
    }
  }, [
    effectiveCurrent,
    saving,
    currentPending,
    alternativeBranch,
    currentIndex,
    persistDecision,
    verifiedStops,
    startAlternativeBranch,
    advanceAfterDecision,
  ]);

  const handleSkip = useCallback(async () => {
    if (!effectiveCurrent || saving || !currentPending) {
      return;
    }
    const zoneId = effectiveCurrent.zone.zone_id;
    const batchIndex = alternativeBranch ? alternativeBranch.resumeBatchIndex : currentIndex;
    await persistDecision(zoneId, "rejected", "not_practical", undefined, batchIndex);
    const updatedStops = {
      ...verifiedStops,
      [verifiedStopKey(zoneId)]: {
        status: "rejected" as const,
        rejectReason: "not_practical" as const,
        updatedAt: new Date().toISOString(),
      },
    };
    advanceAfterDecision(batchIndex, updatedStops);
  }, [
    effectiveCurrent,
    saving,
    currentPending,
    alternativeBranch,
    currentIndex,
    persistDecision,
    verifiedStops,
    advanceAfterDecision,
  ]);

  const handleUndo = useCallback(async () => {
    if (!lastUndo || !activeRaceId || saving) {
      return;
    }
    setSaving(true);
    try {
      const key = verifiedStopKey(lastUndo.zoneId);
      if (lastUndo.previous) {
        await saveVerifiedStop(lastUndo.zoneId, lastUndo.previous);
      } else {
        await updateRacePreparation(activeRaceId, {
          verifiedStops: { [key]: { _delete: true } },
        });
      }
      setCurrentIndex(lastUndo.batchIndex);
      setLastUndo(null);
    } finally {
      setSaving(false);
    }
  }, [lastUndo, activeRaceId, saving, saveVerifiedStop]);

  const handleRejectConfirm = useCallback(
    async (reason: StopRejectReason, notes?: string) => {
      if (rejectingZoneId === null) {
        return;
      }
      const zoneId = rejectingZoneId;
      setRejectingZoneId(null);
      const batchIndex = alternativeBranch ? alternativeBranch.resumeBatchIndex : currentIndex;
      await persistDecision(zoneId, "rejected", reason, notes, batchIndex);
      const zone = suggestedStops.find((entry) => entry.zone_id === zoneId);
      const best = zone ? buildHubRecommendations(zone).best : null;
      const updatedStops = {
        ...verifiedStops,
        [verifiedStopKey(zoneId)]: {
          status: "rejected" as const,
          rejectReason: reason,
          rejectNotes: notes,
          feedbackContext:
            zone ? buildRejectFeedbackContext(zone, best, reason) : undefined,
          updatedAt: new Date().toISOString(),
        },
      };
      advanceAfterDecision(batchIndex, updatedStops);
    },
    [rejectingZoneId, persistDecision, verifiedStops, advanceAfterDecision, currentIndex, suggestedStops, alternativeBranch],
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (rejectingZoneId !== null) {
        if (event.key === "Escape") {
          setRejectingZoneId(null);
        }
        return;
      }

      if (!showingVerificationCard || viewMode !== "cards") {
        return;
      }

      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }

      switch (event.key) {
        case "ArrowLeft":
          event.preventDefault();
          goPrevious();
          break;
        case "ArrowRight":
          event.preventDefault();
          goNext();
          break;
        case "Enter":
          event.preventDefault();
          void handleVerify();
          break;
        case "Delete":
        case "Backspace":
          event.preventDefault();
          void handleSkip();
          break;
        default:
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [rejectingZoneId, showingVerificationCard, viewMode, goPrevious, goNext, handleVerify, handleSkip]);

  const currentStatus = effectiveCurrent
    ? verifiedStops[verifiedStopKey(effectiveCurrent.zone.zone_id)]?.status
    : undefined;

  const neighborContext = useMemo(
    () => verifiedStopContext(fullRoute, verifiedStops, fullRoute.findIndex(
      (item) => item.zone.zone_id === effectiveCurrent?.zone.zone_id,
    )),
    [fullRoute, verifiedStops, effectiveCurrent],
  );

  const alternativeCardContext = useMemo(() => {
    if (!alternativeBranch) {
      return undefined;
    }
    const entry = alternativeBranch.alternatives[alternativeBranch.index];
    if (!entry) {
      return undefined;
    }
    return {
      anchorName: alternativeBranch.anchorName,
      positionLabel: entry.positionLabel,
      index: alternativeBranch.index + 1,
      total: alternativeBranch.alternatives.length,
    };
  }, [alternativeBranch]);

  const rejectingStopBest = useMemo(() => {
    if (rejectingZoneId === null || !effectiveCurrent) {
      return null;
    }
    return buildHubRecommendations(effectiveCurrent.zone).best;
  }, [rejectingZoneId, effectiveCurrent]);

  const displayRoundNumber = roundNumber > 0 ? roundNumber : 1;

  if (planFinished) {
    return (
      <div className="mx-auto max-w-xl px-6 py-10">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Stop verification</h1>
        </header>
        <VerifiedPlanOverview
          route={result.route}
          plan={verifiedPlan}
          planningHubs={suggestedStops}
          verifiedRecords={verifiedStops}
        />
        <div className="mt-6">
          <StopVerificationComplete
            verified={progress.verified}
            rejected={rejectedCount}
            onReviewResupply={() => onNavigate("resupply")}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl px-6 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Stop verification</h1>
        <p className="mt-2 text-base text-muted">
          {viewMode === "overview"
            ? "Your verified resupply plan — review gaps, then verify more stops when ready."
            : "One stop at a time — build a race plan you trust."}
        </p>
      </header>

      {viewMode === "overview" ? (
        <>
          <VerifiedPlanOverview
            route={result.route}
            plan={verifiedPlan}
            planningHubs={suggestedStops}
            verifiedRecords={verifiedStops}
          />

          <div className="mt-6">
            <StopVerificationProgress
              verified={progress.verified}
              total={progress.total}
              remaining={remainingCandidates}
              estimatedMinutes={Math.max(1, Math.ceil((Math.min(VERIFICATION_BATCH_SIZE, remainingCandidates) * 25) / 60))}
            />
          </div>

          <div className="mt-6">
            <VerificationOverviewHub
              verifiedCount={progress.verified}
              remainingCandidates={remainingCandidates}
              batchPending={batchPending}
              batchActive={batchActive}
              batchComplete={batchComplete}
              roundNumber={displayRoundNumber}
              plan={verifiedPlan}
              onContinue={handleContinueVerification}
              onFinishPlan={handleFinishPlan}
            />
          </div>
        </>
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={handleBackToOverview}
              className="text-sm font-medium text-accent hover:text-accent/80"
            >
              ← Back to overview
            </button>
            <p className="text-xs tabular-nums text-muted">
              Round {displayRoundNumber}
              {alternativeBranch
                ? ` · Nearby ${alternativeBranch.index + 1} of ${alternativeBranch.alternatives.length}`
                : showingVerificationCard && effectiveCurrent
                  ? ` · Stop ${currentIndex + 1} of ${activeBatch!.length}`
                  : ""}
            </p>
          </div>

          {showingVerificationCard && effectiveCurrent ? (
            <>
              <div className="mb-3 flex items-center justify-end gap-1">
                <button
                  type="button"
                  onClick={goPrevious}
                  disabled={
                    alternativeBranch
                      ? alternativeBranch.index === 0
                      : currentIndex === 0
                  }
                  className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-muted transition hover:text-ink disabled:opacity-40"
                  aria-label="Previous stop"
                >
                  ← Previous
                </button>
                <button
                  type="button"
                  onClick={goNext}
                  disabled={
                    alternativeBranch
                      ? alternativeBranch.index >= alternativeBranch.alternatives.length - 1
                      : currentIndex >= activeBatch!.length - 1
                  }
                  className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-muted transition hover:text-ink disabled:opacity-40"
                  aria-label="Next stop"
                >
                  Next →
                </button>
              </div>

              <StopVerificationCard
                item={effectiveCurrent}
                route={result.route}
                totalKm={result.summary.distance_km}
                timeWindowId={arrivalTimeWindow}
                timeMode={timeMode}
                decisionStatus={currentStatus}
                verifiedContext={neighborContext}
                alternativeContext={alternativeCardContext}
              />

              <div className="mt-6">
                <StopVerificationActions
                  saving={saving}
                  currentPending={currentPending}
                  canUndo={lastUndo !== null}
                  showAlternatives={showAlternativeActions}
                  inAlternativeBranch={alternativeBranch !== null}
                  onVerify={() => void handleVerify()}
                  onSkip={() => void handleSkip()}
                  onUndo={() => void handleUndo()}
                  onVerifyAndAlternatives={() => void handleVerifyAndAlternatives()}
                  onDontVerifyAndAlternatives={() => void handleDontVerifyAndAlternatives()}
                />
              </div>
            </>
          ) : (
            <div className="rounded-2xl border border-line bg-card p-6 text-center shadow-card">
              <p className="text-sm text-muted">Loading next stops…</p>
            </div>
          )}
        </>
      )}

      {rejectingZoneId !== null && effectiveCurrent && viewMode === "cards" && (
        <StopRejectReasonSheet
          stopName={effectiveCurrent.zone.name}
          poiCategory={rejectingStopBest?.poi.poi_category}
          categoryKey={rejectingStopBest?.categoryKey}
          onSelect={(reason, notes) => void handleRejectConfirm(reason, notes)}
          onCancel={() => setRejectingZoneId(null)}
        />
      )}
    </div>
  );
}
