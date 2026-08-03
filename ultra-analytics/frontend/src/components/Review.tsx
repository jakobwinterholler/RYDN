import { useCallback, useEffect, useMemo, useState } from "react";
import type { Report } from "../types";
import { coachFromReport } from "../coach/rideCoach";
import RideHeader, { type ReviewTab } from "./RideHeader";
import OverviewPage from "./review/OverviewPage";
import CurvesPage from "./review/CurvesPage";
import AnalysisPage from "./review/AnalysisPage";
import RideCoachCard from "./review/RideCoachCard";
import RideShareScreen from "./review/RideShareScreen";
import RydnMark from "./ui/RydnMark";
import Icon from "./ui/Icon";

interface Props {
  report: Report;
  onBack: () => void;
  backLabel?: string;
}

export default function Review({ report, onBack, backLabel }: Props) {
  const [tab, setTab] = useState<ReviewTab>("overview");
  const [shareOpen, setShareOpen] = useState(false);

  const closeShare = useCallback(() => setShareOpen(false), []);

  const coachTips = useMemo(
    () =>
      coachFromReport({
        distanceKm: report.overview.distanceKm,
        elevationGainM: report.overview.elevationGainM,
        movingPct: report.overview.movingPct,
        avgHr: report.performance.hr?.avg ?? null,
        avgCadence: report.performance.cadence?.avg ?? null,
        hrDriftPct: report.curves.hrDrift?.available ? report.curves.hrDrift.pct ?? null : null,
        fadePct: report.curves.fade?.available ? report.curves.fade.pct ?? null : null,
        fatigueInsight: report.curves.fatigue?.available
          ? report.curves.fatigue.insight ?? null
          : null,
        climbWalkPct: report.climbs.pctClimbingOnFoot ?? report.overview.pctClimbOnFoot ?? null,
      }),
    [report],
  );

  useEffect(() => {
    if (!shareOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeShare();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [shareOpen, closeShare]);

  return (
    <div className="review">
      <header className="ride-nav">
        <button
          type="button"
          className="icon-btn"
          onClick={onBack}
          aria-label={`Back to ${backLabel || "Library"}`}
        >
          <Icon name="chevronLeft" size={22} />
        </button>
        <div className="ride-header__brand" aria-label="RYDN">
          <RydnMark size={18} />
          <span>RYDN</span>
        </div>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setShareOpen(true)}
          aria-label="Share ride card"
          title="Share"
        >
          <Icon name="share" size={20} />
        </button>
      </header>

      <RideShareScreen report={report} />

      <RideHeader tab={tab} onTab={setTab} />

      <main
        className="review__main"
        id={`review-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`review-tab-${tab}`}
      >
        {tab === "overview" && (
          <>
            <OverviewPage data={report.overview} />
            <RideCoachCard tips={coachTips} title="After this day" />
          </>
        )}
        {tab === "curves" && <CurvesPage data={report.curves} />}
        {tab === "analysis" && <AnalysisPage report={report} />}
      </main>

      {shareOpen && (
        <div className="ride-share-overlay" role="dialog" aria-modal="true" aria-label="Share ride">
          <div className="ride-share-overlay__chrome">
            <button type="button" className="icon-btn" onClick={closeShare} aria-label="Close share">
              <Icon name="close" size={22} />
            </button>
            <p className="ride-share-overlay__hint">Screenshot to share</p>
            <span className="ride-share-overlay__spacer" aria-hidden />
          </div>
          <div className="ride-share-overlay__card">
            <RideShareScreen report={report} staticReveal shareSurface />
          </div>
        </div>
      )}
    </div>
  );
}
