import { useMemo, useState } from "react";
import type { AppTab, RoadbookResult } from "../api";
import { useRenderTrace } from "../debug/raceOpenTrace";
import { usePlanning } from "../planning/PlanningContext";
import { selectKmRangeIntent } from "../planning/planningIntent";
import { presentSuggestedStops } from "../planning/suggestedStops";
import { analyzeUnsupportedSections, riskTierForSection } from "../planning/unsupportedSections";
import PlanningDetailSheet from "../components/planning/PlanningDetailSheet";
import UnsupportedSectionCard from "../components/unsupported/UnsupportedSectionCard";
import UnsupportedSectionDetailContent from "../components/unsupported/UnsupportedSectionDetailContent";

interface UnsupportedPageProps {
  result: RoadbookResult;
  onNavigate?: (tab: AppTab) => void;
}

export default function UnsupportedPage({ result, onNavigate }: UnsupportedPageProps) {
  useRenderTrace("render.unsupported.start", "render.unsupported.done");
  const { timeMode, setPlanningIntent } = usePlanning();
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);

  const presentedZones = useMemo(
    () => presentSuggestedStops(result, timeMode),
    [result, timeMode],
  );

  const suggestedStopIds = useMemo(
    () => new Set(presentedZones.map((zone) => zone.zone_id)),
    [presentedZones],
  );

  const sections = useMemo(
    () =>
      analyzeUnsupportedSections(
        result.resupply_zones,
        result.route,
        result.summary.distance_km,
      ),
    [result.resupply_zones, result.route, result.summary.distance_km],
  );

  const selectedSection = useMemo(
    () => sections.find((section) => section.id === selectedSectionId) ?? null,
    [sections, selectedSectionId],
  );

  function handleSelectSection(sectionId: string) {
    setSelectedSectionId(sectionId);
  }

  function handleCloseSheet() {
    setSelectedSectionId(null);
  }

  function handleExploreOnRoute() {
    if (!selectedSection || !onNavigate) {
      return;
    }
    setPlanningIntent(
      selectKmRangeIntent(
        selectedSection.startKm,
        selectedSection.endKm,
        selectedSection.displayLabel,
        "route",
      ),
    );
    onNavigate("route");
    setSelectedSectionId(null);
  }

  return (
    <div className="mx-auto max-w-[1200px] space-y-6 px-4 py-8 pb-10 lg:px-6">
      <header className="space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight text-ink">Unsupported</h2>
        <p className="max-w-3xl text-sm text-muted">
          Stretches that deserve planning attention — ranked by how demanding they are to ride
          through without reliable support. Click a section for a quick read; open the Route tab for
          deeper exploration.
        </p>
        <p className="text-sm text-muted">
          <span className="tabular-nums font-medium text-ink">{sections.length}</span> meaningful
          unsupported {sections.length === 1 ? "section" : "sections"} detected
        </p>
      </header>

      {sections.length === 0 ? (
        <div className="rounded-2xl border border-line bg-card p-8 text-center shadow-card">
          <p className="text-lg font-semibold text-ink">No critical unsupported sections detected</p>
          <p className="mt-2 text-sm text-muted">
            Resupply coverage looks reasonable for this route. Check the Resupply tab for individual
            stop options.
          </p>
        </div>
      ) : (
        <section className="space-y-3">
          <div>
            <h3 className="text-lg font-semibold text-ink">Sections that need a plan</h3>
            <p className="mt-1 text-sm text-muted">
              Click a section to open a detail card with map, stops, and why it is difficult.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {sections.map((section) => (
              <UnsupportedSectionCard
                key={section.id}
                section={section}
                selected={selectedSectionId === section.id}
                onSelect={handleSelectSection}
              />
            ))}
          </div>
        </section>
      )}

      <PlanningDetailSheet
        open={selectedSection !== null}
        title={selectedSection?.displayLabel ?? "Unsupported section"}
        subtitle={
          selectedSection ? `${riskTierForSection(selectedSection).label} risk section` : undefined
        }
        onClose={handleCloseSheet}
        footer={
          onNavigate && selectedSection ? (
            <button
              type="button"
              onClick={handleExploreOnRoute}
              className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent/90"
            >
              Open on full route map
            </button>
          ) : undefined
        }
      >
        {selectedSection && (
          <UnsupportedSectionDetailContent
            section={selectedSection}
            route={result.route}
            allZones={result.resupply_zones}
            suggestedStopIds={suggestedStopIds}
          />
        )}
      </PlanningDetailSheet>
    </div>
  );
}
