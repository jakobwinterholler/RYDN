import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@shared/auth/AuthProvider";
import { cloudSyncUnavailableUserMessage } from "@shared/companion/userFacingErrors";
import { getAvatarUrl, getDisplayName } from "@shared/auth/profile";
import type { CompanionBundle, CompanionStop } from "@shared/types/sync";
import { Avatar, SessionRestoreScreen, SigningInScreen } from "@shared/ui/AuthScreens";
import { updateDeviceLastActive } from "@shared/sync/deviceProfile";
import { CompanionContext } from "./context/CompanionContext";
import BottomNav, { type CompanionTab } from "./components/BottomNav";
import AppUpdateBanner from "./components/AppUpdateBanner";
import ExecutionHeader from "./components/ExecutionHeader";
import RaceDataBanner from "./components/RaceDataBanner";
import RaceWorkspaceHeader from "./components/RaceWorkspaceHeader";
import AccountScreen from "./screens/AccountScreen";
import HomeScreen from "./screens/HomeScreen";
import RaceScreen from "./screens/RaceScreen";
import ResupplyScreen from "./screens/ResupplyScreen";
import ShareScreen from "./screens/ShareScreen";
import VerificationScreen from "./screens/VerificationScreen";
import WelcomeScreen from "./screens/WelcomeScreen";
import { saveCompanionBundle } from "./db";
import { liveBundleRef } from "./lib/liveBundleRef";
import { clearCompanionDeepLinkParams, parseCompanionDeepLink } from "./lib/deepLink";
import {
  consumeSharedGpxImport,
  queueIncomingGpxFile,
  registerLaunchQueueConsumer,
} from "./lib/incomingGpx";
import { useRaceGps } from "./lib/useRaceGps";
import { useWakeLock } from "./lib/useWakeLock";
import { useVerificationSync } from "./sync/useVerificationSync";

type AppView = "welcome" | "home" | "race";
type HomeTab = "races" | "account";

export default function App() {
  const { isRestoring, signingIn, session, user, configured } = useAuth();
  const [view, setView] = useState<AppView>("welcome");
  const [homeTab, setHomeTab] = useState<HomeTab>("races");
  const [bundle, setBundle] = useState<CompanionBundle | null>(null);
  const [bootLoading, setBootLoading] = useState(true);
  const [tab, setTab] = useState<CompanionTab>("map");
  const [autoExportDevice, setAutoExportDevice] = useState<"coros" | "garmin" | "wahoo" | null>(
    null,
  );
  const [deepLink, setDeepLink] = useState<{
    raceId: string;
    tab?: CompanionTab;
    autoExport?: "coros" | "garmin" | "wahoo";
  } | null>(() => {
    if (typeof window === "undefined") {
      return null;
    }
    const link = parseCompanionDeepLink(window.location.search);
    if (!link.raceId) {
      return null;
    }
    return {
      raceId: link.raceId,
      tab: link.tab ?? undefined,
      autoExport: link.autoExport ?? undefined,
    };
  });
  const [selectedStop, setSelectedStop] = useState<CompanionStop | null>(null);
  const [showUnverified, setShowUnverified] = useState(true);
  const [followGps, setFollowGps] = useState(true);
  const [online, setOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );

  const { gps, routeTrack } = useRaceGps({
    enabled: view === "race" && bundle !== null,
    bundle,
  });

  useWakeLock(view === "race" && bundle !== null);

  const updateBundle = useCallback((next: CompanionBundle) => {
    setBundle(next);
    void saveCompanionBundle(next).catch((err) => {
      console.error("Failed to persist companion bundle:", err);
    });
  }, []);

  liveBundleRef.current = bundle;

  useVerificationSync(online, user?.id ?? null, {
    getBundle: () => liveBundleRef.current,
    onBundleUpdate: updateBundle,
  });

  useEffect(() => {
    if (user) {
      void updateDeviceLastActive("companion");
    }
  }, [user]);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    if (isRestoring) {
      return;
    }
    if (session) {
      setView((current) => (current === "welcome" ? "home" : current));
    } else {
      setView("welcome");
      setBundle(null);
    }
    setBootLoading(false);
  }, [isRestoring, session]);

  useEffect(() => {
    registerLaunchQueueConsumer();
    void consumeSharedGpxImport().then((file) => {
      if (!file) {
        return;
      }
      queueIncomingGpxFile(file);
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.delete("import");
        url.searchParams.delete("shared");
        url.searchParams.delete("url");
        url.searchParams.delete("text");
        url.searchParams.delete("title");
        window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
      }
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const link = parseCompanionDeepLink(window.location.search);
    if (link.raceId) {
      setDeepLink({
        raceId: link.raceId,
        tab: link.tab ?? undefined,
        autoExport: link.autoExport ?? undefined,
      });
    }
    if (link.tab) {
      setTab(link.tab);
    }
    if (link.autoExport) {
      setAutoExportDevice(link.autoExport);
    }
    if (link.raceId || link.tab || link.autoExport) {
      clearCompanionDeepLinkParams();
    }
  }, []);

  function openRace(
    next: CompanionBundle,
    options?: { tab?: CompanionTab; autoExport?: "coros" | "garmin" | "wahoo" },
  ) {
    setBundle(next);
    setSelectedStop(null);
    setTab(options?.tab ?? "map");
    if (options?.autoExport) {
      setAutoExportDevice(options.autoExport);
    }
    setView("race");
  }

  const clearRace = useCallback(async () => {
    setAutoExportDevice(null);
    setBundle(null);
    setSelectedStop(null);
    setTab("map");
    setView(session ? "home" : "welcome");
  }, [session]);

  const contextValue = useMemo(
    () =>
      bundle
        ? {
            bundle,
            currentKm: gps.currentKm,
            gps,
            routeTrack,
            selectedStop,
            selectStop: setSelectedStop,
            showUnverified,
            setShowUnverified,
            followGps,
            setFollowGps,
            updateBundle,
            clearRace,
          }
        : null,
    [
      bundle,
      clearRace,
      gps,
      followGps,
      routeTrack,
      selectedStop,
      showUnverified,
      updateBundle,
    ],
  );


  if (isRestoring || bootLoading) {
    return <SessionRestoreScreen variant="dark" />;
  }

  if (signingIn) {
    return <SigningInScreen variant="dark" message="Signing you in…" />;
  }

  if (!configured) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-red-300">
        {cloudSyncUnavailableUserMessage()}
      </div>
    );
  }

  if (view === "welcome" || !session) {
    return <WelcomeScreen />;
  }

  if (view === "home") {
    if (homeTab === "account") {
      const displayName = getDisplayName(user);
      const avatarUrl = getAvatarUrl(user);
      return (
        <div className="flex h-full min-h-0 flex-col bg-[#0a0a0a]">
          <header className="flex shrink-0 items-center gap-3 border-b border-white/8 px-4 pb-2 pt-safe-top">
            <button
              type="button"
              onClick={() => setHomeTab("races")}
              className="min-h-[44px] rounded-xl px-2 text-sm text-white/50 hover:bg-white/5 hover:text-white"
            >
              ← Races
            </button>
            <div className="ml-auto flex items-center gap-2">
              <Avatar name={displayName} imageUrl={avatarUrl} size="md" variant="dark" />
            </div>
          </header>
          <AccountScreen />
        </div>
      );
    }

    return (
      <div key="home" className="urp-animate-fade-up">
        <HomeScreen
          onOpenAccount={() => setHomeTab("account")}
          onOpenRace={openRace}
          deepLink={deepLink}
        />
      </div>
    );
  }

  if (!bundle || !contextValue) {
    return (
      <div key="home-fallback" className="urp-animate-fade-up">
        <HomeScreen
          onOpenAccount={() => setHomeTab("account")}
          onOpenRace={openRace}
          deepLink={deepLink}
        />
      </div>
    );
  }

  const showExecutionHeader = tab === "map" || tab === "resupply";
  const showRaceDataBanner = tab === "map" || tab === "resupply" || tab === "share";

  return (
    <CompanionContext.Provider value={contextValue}>
      <div key="race" className="urp-animate-workspace-enter flex h-full min-h-0 flex-col bg-[#0a0a0a]">
        <AppUpdateBanner />
        <RaceWorkspaceHeader
          raceName={bundle.race.name}
          onBackToLibrary={() => void clearRace()}
        />
        {showExecutionHeader ? <ExecutionHeader /> : null}
        {showRaceDataBanner ? (
          <RaceDataBanner bundle={bundle} onBundleUpdate={updateBundle} />
        ) : null}

        <main className="relative min-h-0 flex-1">
          {/* The map stays mounted for the entire race session so returning to it is
              instant — no remount, no tile reload, no white frame. We hide it with
              `visibility` (not display:none) so its layout box, and therefore the
              MapLibre canvas size, is preserved while another tab is on top. GPS,
              zoom/bearing/pitch, route rendering and the selected stop all persist. */}
          <div
            className="absolute inset-0"
            style={{ visibility: tab === "map" ? "visible" : "hidden" }}
            aria-hidden={tab !== "map"}
          >
            <RaceScreen active={tab === "map"} />
          </div>
          {tab !== "map" ? (
            <div key={tab} className="urp-animate-fade-in absolute inset-0 bg-[#0a0a0a]">
              {tab === "resupply" ? (
                <ResupplyScreen />
              ) : tab === "verify" ? (
                <VerificationScreen />
              ) : (
                <ShareScreen
                  autoExportDevice={autoExportDevice}
                  onAutoExportHandled={() => setAutoExportDevice(null)}
                />
              )}
            </div>
          ) : null}
        </main>

        <BottomNav
          active={tab}
          onChange={setTab}
          onBackToLibrary={() => void clearRace()}
        />
      </div>
    </CompanionContext.Provider>
  );
}
