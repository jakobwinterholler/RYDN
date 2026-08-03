import { useMemo, useState } from "react";
import type { ResupplyZone, RoadbookResult } from "../api";
import ResupplyZoneCard from "../components/ResupplyZoneCard";
import PlanningDetailSheet from "../components/planning/PlanningDetailSheet";
import ResupplyHubDetailContent from "../components/resupply/ResupplyHubDetailContent";
import { usePlanning } from "../planning/PlanningContext";
import { usePlanningAssumptions } from "../planning/usePlanningAssumptions";
import {
  filterResupplyZonesForView,
} from "../planning/resupplyView";
import {
  filterResupplyZones,
  sortResupplyZones,
} from "../planning/viewModel";
import { presentSuggestedStops } from "../planning/suggestedStops";
import type { DetourFilter, ResupplyCategoryFilter } from "../planning/types";
import type { StopSelection } from "../planning/stopSelection";
import { zoneAvailability } from "../planning/stopAvailability";
import { useRace } from "../races/RaceContext";

interface ResupplyPageProps {
  result: RoadbookResult;
}

const CATEGORY_OPTIONS: { id: ResupplyCategoryFilter; label: string }[] = [
  { id: "food", label: "Food" },
  { id: "water", label: "Water" },
  { id: "fuel", label: "Fuel" },
  { id: "dining", label: "Dining" },
];

const DETOUR_OPTIONS: { id: DetourFilter; label: string }[] = [
  { id: "on_route", label: "0–20 m off route" },
  { id: "very_small", label: "20–75 m" },
  { id: "small", label: "75–150 m" },
  { id: "medium", label: "150–300 m" },
  { id: "large", label: "300+ m" },
];

const SORT_OPTIONS = [
  { id: "along_route" as const, label: "Along route" },
  { id: "best_reliability" as const, label: "Best Ultra Stop Score" },
  { id: "closest_to_route" as const, label: "Closest to route" },
  { id: "least_detour" as const, label: "Least detour" },
];

function toggleValue<T>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

export default function ResupplyPage({ result }: ResupplyPageProps) {
  const {
    resupplyFilters,
    setResupplyFilters,
    resupplySort,
    setResupplySort,
    timeMode,
  } = usePlanning();
  const { arrivalTimeWindow } = usePlanningAssumptions();
  const { verifiedStops } = useRace();
  const [showVerifiedOnly, setShowVerifiedOnly] = useState(false);
  const [detailSelection, setDetailSelection] = useState<StopSelection>(null);
  const [selectedZoneId, setSelectedZoneId] = useState<number | null>(null);

  const planningZones = useMemo(
    () => presentSuggestedStops(result, timeMode),
    [result, timeMode],
  );

  const visibleZones = useMemo(() => {
    const verifiedFiltered = filterResupplyZonesForView(
      planningZones,
      result,
      verifiedStops,
      showVerifiedOnly,
    );
    const filtered = filterResupplyZones(verifiedFiltered, resupplyFilters);
    return sortResupplyZones(filtered, resupplySort);
  }, [planningZones, result, verifiedStops, showVerifiedOnly, resupplyFilters, resupplySort]);

  function handleSelectZone(zone: ResupplyZone) {
    setSelectedZoneId(zone.zone_id);
    setDetailSelection({ kind: "zone", zone });
  }

  function handleCloseDetail() {
    setDetailSelection(null);
    setSelectedZoneId(null);
  }

  const sheetTitle =
    detailSelection?.kind === "zone"
      ? detailSelection.zone.name
      : detailSelection?.kind === "poi"
        ? detailSelection.poi.name ?? detailSelection.poi.brand ?? "Stop detail"
        : "Resupply stop";

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-8 py-12 sm:px-10">
      <div>
        <h2 className="text-display font-semibold tracking-tight text-ink">Resupply</h2>
        <p className="mt-2 text-sm text-muted">
          {visibleZones.length} {showVerifiedOnly ? "verified" : "suggested"} stops along your route
        </p>
      </div>

      <div className="flex gap-2">
        {(["all", "verified"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setShowVerifiedOnly(value === "verified")}
            className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
              (value === "verified") === showVerifiedOnly
                ? "bg-accent text-white"
                : "border border-line bg-card text-ink"
            }`}
          >
            {value === "all" ? "All stops" : "Verified only"}
          </button>
        ))}
      </div>

      <details className="rounded-2xl border border-line bg-card shadow-card">
        <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-ink sm:px-6">
          Filter stops
        </summary>
        <div className="space-y-4 border-t border-line px-5 py-5 sm:px-6">
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted">Services</p>
              <div className="flex flex-wrap gap-2">
                {CATEGORY_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() =>
                      setResupplyFilters({
                        ...resupplyFilters,
                        categories: toggleValue(resupplyFilters.categories, option.id),
                      })
                    }
                    className={`rounded-lg px-3 py-1.5 text-sm ${
                      resupplyFilters.categories.includes(option.id)
                        ? "bg-accent text-white"
                        : "bg-canvas text-ink"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-muted">
                Sort by
                <select
                  value={resupplySort}
                  onChange={(event) => setResupplySort(event.target.value as typeof resupplySort)}
                  className="mt-2 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink"
                >
                  {SORT_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted">Off-route distance</p>
            <div className="flex flex-wrap gap-2">
              {DETOUR_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() =>
                    setResupplyFilters({
                      ...resupplyFilters,
                      detourBands: toggleValue(resupplyFilters.detourBands, option.id),
                    })
                  }
                  className={`rounded-lg px-3 py-1.5 text-sm ${
                    resupplyFilters.detourBands.includes(option.id)
                      ? "bg-accent text-white"
                      : "bg-canvas text-ink"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </details>

      <div className="overflow-hidden rounded-2xl border border-line bg-card shadow-card">
        {visibleZones.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-muted">No resupply zones match the current filters.</p>
          </div>
        ) : (
          visibleZones.map((zone) => {
            const availability = zoneAvailability(zone, arrivalTimeWindow, timeMode);
            return (
              <ResupplyZoneCard
                key={zone.zone_id}
                zone={zone}
                selected={selectedZoneId === zone.zone_id}
                dimmed={availability?.status === "closed"}
                onSelect={handleSelectZone}
              />
            );
          })
        )}
      </div>

      <PlanningDetailSheet
        open={detailSelection !== null}
        title={sheetTitle}
        subtitle="Resupply stop"
        onClose={handleCloseDetail}
      >
        {detailSelection && (
          <ResupplyHubDetailContent
            selection={detailSelection}
            route={result.route}
            timeWindowId={arrivalTimeWindow}
            timeMode={timeMode}
            onSelectPoi={(poi) =>
              setDetailSelection({
                kind: "poi",
                poi,
                zone: detailSelection.kind === "zone" ? detailSelection.zone : detailSelection.zone,
              })
            }
            onBackToZone={
              detailSelection.kind === "poi" && detailSelection.zone
                ? () => setDetailSelection({ kind: "zone", zone: detailSelection.zone! })
                : undefined
            }
          />
        )}
      </PlanningDetailSheet>
    </div>
  );
}
