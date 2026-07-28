import type { Report } from "../types";
import { fmtDate } from "./ui/format";
import RydnMark from "./ui/RydnMark";

export type ReviewTab = "overview" | "curves" | "analysis";

const TABS: { id: ReviewTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "curves", label: "Curves" },
  { id: "analysis", label: "Analysis" },
];

interface Props {
  report: Report;
  tab: ReviewTab;
  onTab: (t: ReviewTab) => void;
  onBack: () => void;
  backLabel?: string;
}

export default function RideHeader({
  report,
  tab,
  onTab,
  onBack,
  backLabel = "Library",
}: Props) {
  const { race, overview } = report;
  const typeLabel = race.kind === "race" ? "Ultra Race" : "Training Ride";

  return (
    <header className="ride-header">
      <div className="ride-header__bar">
        <button type="button" className="btn btn--ghost ride-header__back" onClick={onBack}>
          ← {backLabel}
        </button>
        <div className="ride-header__brand" aria-label="RYDN">
          <RydnMark size={18} />
          <span>RYDN</span>
        </div>
      </div>

      <div className="ride-header__hero">
        <div className="ride-header__eyebrow">
          {typeLabel} · {fmtDate(race.startTime)}
        </div>
        <h1 className="ride-header__title">{race.name}</h1>
        <div className="ride-header__quick">
          <span>{Math.round(overview.distanceKm)} km</span>
          <span className="sep">·</span>
          <span>{overview.elevationGainM.toLocaleString()} m</span>
          {overview.npW != null && (
            <>
              <span className="sep">·</span>
              <span>{overview.npW} W NP</span>
            </>
          )}
        </div>
      </div>

      <nav className="ride-tabs" role="tablist" aria-label="Day review">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`review-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`review-panel-${t.id}`}
            className={`ride-tab${tab === t.id ? " active" : ""}`}
            onClick={() => onTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </header>
  );
}
