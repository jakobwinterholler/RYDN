export type ReviewTab = "overview" | "curves" | "analysis";

const TABS: { id: ReviewTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "curves", label: "Curves" },
  { id: "analysis", label: "Analysis" },
];

interface Props {
  tab: ReviewTab;
  onTab: (t: ReviewTab) => void;
}

/** Sticky tab strip below the shareable first screen. */
export default function RideHeader({ tab, onTab }: Props) {
  return (
    <nav className="ride-tabs ride-tabs--sticky" role="tablist" aria-label="Day review">
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
  );
}
