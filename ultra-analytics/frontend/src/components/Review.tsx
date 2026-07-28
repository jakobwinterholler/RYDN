import { useState } from "react";
import type { Report } from "../types";
import RideHeader, { type ReviewTab } from "./RideHeader";
import OverviewPage from "./review/OverviewPage";
import CurvesPage from "./review/CurvesPage";
import AnalysisPage from "./review/AnalysisPage";

interface Props {
  report: Report;
  onBack: () => void;
  backLabel?: string;
}

export default function Review({ report, onBack, backLabel }: Props) {
  const [tab, setTab] = useState<ReviewTab>("overview");

  return (
    <div className="review">
      <RideHeader
        report={report}
        tab={tab}
        onTab={setTab}
        onBack={onBack}
        backLabel={backLabel}
      />
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
