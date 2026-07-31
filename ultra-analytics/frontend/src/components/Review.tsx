import { useState } from "react";
import type { Report } from "../types";
import RideHeader, { type ReviewTab } from "./RideHeader";
import OverviewPage from "./review/OverviewPage";
import CurvesPage from "./review/CurvesPage";
import AnalysisPage from "./review/AnalysisPage";
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
      </header>

      <RideShareScreen report={report} />

      <RideHeader tab={tab} onTab={setTab} />

      <main
        className="review__main"
        id={`review-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`review-tab-${tab}`}
      >
        {tab === "overview" && <OverviewPage data={report.overview} />}
        {tab === "curves" && <CurvesPage data={report.curves} />}
        {tab === "analysis" && <AnalysisPage report={report} />}
      </main>
    </div>
  );
}
