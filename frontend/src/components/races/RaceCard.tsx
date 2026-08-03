import type { RaceSummary } from "../../races/api";
import type { SyncIndicator } from "@shared/ui/SyncStatusBadge";
import { RaceProjectCard } from "@shared/ui/RaceProjectCard";
import { metricsFromDashboardStats } from "@shared/ui/raceCardMetrics";
import { RaceManageMenu, type RaceManageAction } from "./RaceManageMenu";

export { PreparationProgress } from "./RaceCardPreparation";

interface RaceCardProps {
  race: RaceSummary;
  onOpen: (raceId: string) => void;
  onManage: (raceId: string, action: RaceManageAction) => void;
  syncStatus?: SyncIndicator | null;
  staggerIndex?: number;
}

export function RaceCard({ race, onOpen, onManage, syncStatus, staggerIndex = 0 }: RaceCardProps) {
  const metrics = metricsFromDashboardStats(race.dashboard_stats, race.has_analysis);

  return (
    <RaceProjectCard
      name={race.name}
      distanceKm={race.distance_km}
      elevationGainM={race.elevation_gain_m}
      verificationPercent={metrics.verificationPercent}
      suggestedStops={metrics.suggestedStops}
      corosReady={metrics.corosReady}
      syncStatus={syncStatus ?? null}
      lastUpdated={race.updated_at}
      archived={Boolean(race.archived_at)}
      subtitle={race.gpx_original_name}
      staggerIndex={staggerIndex}
      onOpen={() => onOpen(race.id)}
      trailing={
        <RaceManageMenu
          archived={Boolean(race.archived_at)}
          hasAnalysis={race.has_analysis}
          onAction={(action) => {
            if (action === "open") {
              onOpen(race.id);
              return;
            }
            onManage(race.id, action);
          }}
        />
      }
    />
  );
}
