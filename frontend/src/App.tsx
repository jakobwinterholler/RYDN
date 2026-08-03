import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createInitialAnalysisState,
  reduceAnalysisState,
} from "./analysis/analysisState";
import { fetchAnalysisSteps, type AppTab, type RoadbookResult } from "./api";
import Header from "./components/Header";
import TabBar from "./components/TabBar";
import { PlanningProvider, planningDefaults } from "./planning/PlanningContext";
import type { ResupplyPageFilters, ResupplySortMode } from "./planning/types";
import { DEFAULT_RESUPPLY_FILTERS } from "./planning/types";
import type { PlanningIntent } from "./planning/planningIntent";
import type { ZoneDensityMode } from "./planning/types";
import ClimbsPage from "./pages/ClimbsPage";
import DashboardPage from "./pages/OverviewPage";
import ExportPage from "./pages/ExportPage";
import MyRacesPage from "./pages/MyRacesPage";
import ResupplyPage from "./pages/ResupplyPage";
import SettingsPage from "./pages/SettingsPage";
import StopVerificationPage from "./pages/StopVerificationPage";
import SurfacePage from "./pages/SurfacePage";
import RoutePage from "./pages/RoutePage";
import RoutePreviewPage from "./pages/RoutePreviewPage";
import UnsupportedPage from "./pages/UnsupportedPage";
import { RaceProvider, useRace } from "./races/RaceContext";
import { analyzeRaceStream } from "./races/api";
import { SettingsProvider } from "./settings/SettingsContext";
import { useSettings } from "./settings/SettingsContext";
import RacePreparingView from "./views/RacePreparingView";

type AppView = "races" | "preparing" | "workspace" | "settings";

const CLIENT_STALL_TIMEOUT_MS = 3 * 60 * 1000;

function AppContent() {
  const {
    activeRace,
    activeRaceId,
    roadbook,
    openRace,
    closeRace,
    refreshRaces,
    setRoadbook,
  } = useRace();
  const { settings } = useSettings();

  const [view, setView] = useState<AppView>("races");
  const [activeTab, setActiveTab] = useState<AppTab>("route");
  const [returnView, setReturnView] = useState<AppView>("races");
  const [error, setError] = useState<string | null>(null);
  const [analysisStartedAt, setAnalysisStartedAt] = useState(0);
  const [analysisState, setAnalysisState] = useState(createInitialAnalysisState);
  const [analyzingRaceName, setAnalyzingRaceName] = useState("");

  const [overlay, setOverlay] = useState(planningDefaults.overlay);
  const [zoneDensity, setZoneDensity] = useState(planningDefaults.zoneDensity);
  const [resupplyFilters, setResupplyFilters] = useState<ResupplyPageFilters>(DEFAULT_RESUPPLY_FILTERS);
  const [resupplySort, setResupplySort] = useState<ResupplySortMode>(planningDefaults.resupplySort);
  const [timelineLayers, setTimelineLayers] = useState(planningDefaults.timelineLayers);
  const [selectedSurfaceType, setSelectedSurfaceType] = useState<string | null>(
    planningDefaults.selectedSurfaceType,
  );
  const [planningIntent, setPlanningIntent] = useState<PlanningIntent>(planningDefaults.planningIntent);

  useEffect(() => {
    const defaultDensity = settings?.planning.default_zone_density as ZoneDensityMode | undefined;
    if (defaultDensity) {
      setZoneDensity(defaultDensity);
    }
  }, [activeRaceId, settings?.planning.default_zone_density]);

  const consumePlanningIntent = useCallback(() => {
    setPlanningIntent(null);
  }, []);

  useEffect(() => {
    void fetchAnalysisSteps();
  }, []);

  const planningValue = useMemo(
    () => ({
      overlay,
      setOverlay,
      timeMode: planningDefaults.timeMode,
      setTimeMode: () => {},
      zoneDensity,
      setZoneDensity,
      resupplyFilters,
      setResupplyFilters,
      resupplySort,
      setResupplySort,
      timelineLayers,
      setTimelineLayers,
      selectedSurfaceType,
      setSelectedSurfaceType,
      planningIntent,
      setPlanningIntent,
      consumePlanningIntent,
    }),
    [
      overlay,
      zoneDensity,
      resupplyFilters,
      resupplySort,
      timelineLayers,
      selectedSurfaceType,
      planningIntent,
      consumePlanningIntent,
    ],
  );

  const finishAnalysis = useCallback(
    async (data: RoadbookResult) => {
      setRoadbook(data);
      setActiveTab("route");
      setView("workspace");
      await refreshRaces();
    },
    [refreshRaces, setRoadbook],
  );

  const startAnalysis = useCallback(
    async (raceId: string, raceName: string) => {
      setAnalysisState(createInitialAnalysisState());
      setView("preparing");
      setAnalysisStartedAt(Date.now());
      setAnalyzingRaceName(raceName);
      setError(null);

      try {
        const data = await analyzeRaceStream(raceId, (event) => {
          setAnalysisState((current) => reduceAnalysisState(current, event));
        });
        await finishAnalysis(data);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Something went wrong.";
        setAnalysisState((current) => ({
          ...current,
          error: message,
          currentLabel: message,
        }));
      }
    },
    [finishAnalysis, setRoadbook],
  );

  const handleOpenRace = useCallback(
    async (raceId: string) => {
      setError(null);
      try {
        const summary = await openRace(raceId);
        if (summary.has_analysis) {
          setView("workspace");
          setActiveTab("route");
        } else {
          await startAnalysis(raceId, summary.name);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to open race.");
      }
    },
    [openRace, startAnalysis],
  );

  const handleRaceCreated = useCallback(
    async (raceId: string) => {
      setError(null);
      try {
        const summary = await openRace(raceId);
        await startAnalysis(raceId, summary.name);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to start race.");
      }
    },
    [openRace, startAnalysis],
  );

  const handleMyRaces = useCallback(() => {
    closeRace();
    setView("races");
    setError(null);
    void refreshRaces();
  }, [closeRace, refreshRaces]);

  const handleOpenSettings = useCallback(() => {
    setReturnView(view === "settings" ? "races" : view);
    setView("settings");
  }, [view]);

  const handleCloseSettings = useCallback(() => {
    setView(returnView === "settings" ? "races" : returnView);
  }, [returnView]);

  useEffect(() => {
    if (view !== "preparing" || analysisState.error) {
      return undefined;
    }

    const interval = window.setInterval(() => {
      setAnalysisState((current) => {
        if (current.error) {
          return current;
        }
        if (Date.now() - current.lastEventAt < CLIENT_STALL_TIMEOUT_MS) {
          return current;
        }
        return {
          ...current,
          error: `Analysis stopped responding during “${current.currentLabel}”. The server may be waiting on OpenStreetMap data. Try again in a few minutes or use cached data if available.`,
          currentLabel: "Analysis stalled",
        };
      });
    }, 5000);

    return () => window.clearInterval(interval);
  }, [view, analysisState.error, analysisState.lastEventAt]);

  function handleClimbsUpdated(
    climbs: RoadbookResult["climbs"],
    climbCandidates: RoadbookResult["climb_candidates"],
    climbCount: number,
  ) {
    setRoadbook((current) =>
      current
        ? {
            ...current,
            climbs,
            climb_candidates: climbCandidates,
            summary: { ...current.summary, climb_count: climbCount },
          }
        : current,
    );
  }

  function renderTabContent() {
    if (!roadbook || !activeRaceId) {
      return null;
    }

    switch (activeTab) {
      case "dashboard":
        return (
          <DashboardPage
            result={roadbook}
            raceId={activeRaceId}
            onNavigate={setActiveTab}
          />
        );
      case "route":
        return <RoutePage result={roadbook} />;
      case "verify":
        return (
          <StopVerificationPage
            result={roadbook}
            onNavigate={setActiveTab}
          />
        );
      case "unsupported":
        return <UnsupportedPage result={roadbook} onNavigate={setActiveTab} />;
      case "climbs":
        return (
          <ClimbsPage
            raceId={activeRaceId}
            climbs={roadbook.climbs}
            climbCandidates={roadbook.climb_candidates}
            route={roadbook.route}
            pois={roadbook.pois}
            resupplyZones={roadbook.resupply_zones}
            totalKm={roadbook.summary.distance_km}
            onClimbsUpdated={handleClimbsUpdated}
          />
        );
      case "surface":
        return <SurfacePage result={roadbook} onNavigate={setActiveTab} />;
      case "resupply":
        return <ResupplyPage result={roadbook} />;
      case "export":
        return <ExportPage result={roadbook} raceId={activeRaceId} />;
      case "preview":
        return (
          <RoutePreviewPage
            result={roadbook}
            onNavigate={setActiveTab}
          />
        );
      default:
        return null;
    }
  }

  return (
    <PlanningProvider value={planningValue}>
      <div className="min-h-screen bg-canvas">
        <Header
          mode={
            view === "workspace"
              ? "workspace"
              : view === "settings"
                ? "settings"
                : "races"
          }
          onMyRaces={handleMyRaces}
          onOpenRace={handleOpenRace}
          onOpenSettings={handleOpenSettings}
        />

        {view === "workspace" && (
          <TabBar activeTab={activeTab} onTabChange={setActiveTab} />
        )}

        {view === "races" && (
          <div key="races" className="urp-animate-fade-up">
            <MyRacesPage
              onRaceCreated={handleRaceCreated}
              onOpenRace={handleOpenRace}
            />
          </div>
        )}

        {view === "settings" && (
          <div key="settings" className="urp-animate-fade-up">
            <SettingsPage
              roadbook={roadbook}
              onBack={handleCloseSettings}
              onReanalysed={(result) => {
                setRoadbook(result);
                void refreshRaces();
              }}
            />
          </div>
        )}

        {view === "preparing" && (
          <div key="preparing" className="urp-animate-scale-in">
            <RacePreparingView
              raceName={analyzingRaceName || activeRace?.name || "New race"}
              state={analysisState}
              startedAt={analysisStartedAt}
              onCancel={handleMyRaces}
            />
          </div>
        )}

        {error && view === "races" && (
          <div className="mx-auto max-w-5xl px-6 pb-6">
            <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
          </div>
        )}

        {view === "workspace" && (
          <div key={`workspace-${activeRaceId}`} className="urp-animate-workspace-enter">
            {renderTabContent()}
          </div>
        )}
      </div>
    </PlanningProvider>
  );
}

export default function App() {
  return (
    <RaceProvider>
      <SettingsProvider>
        <AppContent />
      </SettingsProvider>
    </RaceProvider>
  );
}
