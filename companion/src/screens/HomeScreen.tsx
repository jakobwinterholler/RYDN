import type { CompanionBundle } from "@shared/types/sync";
import { deleteCloudRace } from "@shared/api/sync";
import { importApiAvailable } from "@shared/api/importGpx";
import { useAuth } from "@shared/auth/AuthProvider";
import { getDisplayName, getAvatarUrl } from "@shared/auth/profile";
import {
  importOfflineUserMessage,
  importUnavailableUserMessage,
  toUserFacingError,
} from "@shared/companion/userFacingErrors";
import { Avatar } from "@shared/ui/AuthScreens";
import { Button } from "@shared/ui/Button";
import { EmptyState } from "@shared/ui/EmptyState";
import { RaceCardSkeleton } from "@shared/ui/Skeleton";
import { ImportGpxIllustration, NoInternetIllustration, NoRacesIllustration } from "@shared/ui/design/illustrations";
import { useEffect, useRef, useState } from "react";
import CompanionDeleteRaceDialog from "../components/CompanionDeleteRaceDialog";
import CompanionRaceCard from "../components/CompanionRaceCard";
import CompanionSyncToast from "../components/CompanionSyncToast";
import GpxImportFlow from "../components/GpxImportFlow";
import {
  deleteCompanionRace,
  loadCompanionBundle,
  setActiveRaceId,
  type StoredRaceListItem,
} from "../db";
import { acceptGpxFile, onIncomingGpxFile } from "../lib/incomingGpx";
import { haptic } from "../lib/haptics";
import { buildRaceListSections } from "../lib/raceListSections";
import { downloadRaceAssets } from "../lib/downloadRaceAssets";
import { useCloudRaceList } from "../sync/useCloudRaceList";
import { useAutoCloudSync } from "../sync/useAutoCloudSync";
import type { CompanionTab } from "../components/BottomNav";

interface HomeScreenProps {
  onOpenRace: (bundle: CompanionBundle, options?: { tab?: CompanionTab; autoExport?: "coros" | "garmin" | "wahoo" }) => void;
  onOpenAccount: () => void;
  deepLink?: {
    raceId: string;
    tab?: CompanionTab;
    autoExport?: "coros" | "garmin" | "wahoo";
  } | null;
}

export default function HomeScreen({ onOpenRace, onOpenAccount, deepLink }: HomeScreenProps) {
  const { accessToken, user } = useAuth();
  const { races, loading, error, refresh, removeRace } = useCloudRaceList();
  const { autoSyncing, syncToast, dismissSyncToast, retrySync } = useAutoCloudSync();
  const [busyRaceId, setBusyRaceId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StoredRaceListItem | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [dismissingRaceId, setDismissingRaceId] = useState<string | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const deepLinkHandledRef = useRef(false);

  const sections = buildRaceListSections(races);
  const canImport = importApiAvailable();

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
    onIncomingGpxFile((file) => setImportFile(file));
    return () => onIncomingGpxFile(null);
  }, []);

  useEffect(() => {
    if (!deepLink?.raceId || loading || races.length === 0 || deepLinkHandledRef.current) {
      return;
    }
    const target = races.find((race) => race.id === deepLink.raceId);
    if (!target) {
      return;
    }
    deepLinkHandledRef.current = true;
    void handleOpenRace(target, {
      tab: deepLink.tab ?? "share",
      autoExport: deepLink.autoExport,
    });
  }, [deepLink, loading, races]);

  async function handleOpenRace(
    race: StoredRaceListItem,
    options?: { tab?: CompanionTab; autoExport?: "coros" | "garmin" | "wahoo" },
  ) {
    setActionError(null);

    const openLocal = async (): Promise<boolean> => {
      if (!race.offlineReady) {
        return false;
      }
      const bundle = await loadCompanionBundle(race.id);
      if (!bundle) {
        return false;
      }
      await setActiveRaceId(race.id);
      onOpenRace(bundle, options);
      return true;
    };

    const hasCloudUpdate =
      race.downloadedRevision !== null && race.companion_revision > race.downloadedRevision;

    // Prefer the working offline copy when it's current, OR when we can't fetch the
    // update (offline / no session). A rider must never be locked out of a race they
    // have already downloaded just because Desktop pushed a newer revision.
    if (!hasCloudUpdate || !online || !accessToken) {
      if (await openLocal()) {
        return;
      }
    }

    if (!accessToken) {
      setActionError("Sign in required to download this race.");
      return;
    }
    if (!race.has_bundle) {
      setActionError("This race has not been analyzed yet.");
      return;
    }

    setBusyRaceId(race.id);
    setDownloadProgress(0);
    const progressTimer = window.setInterval(() => {
      setDownloadProgress((value) => {
        if (value === null || value >= 90) {
          return value;
        }
        return value + 8;
      });
    }, 200);

    try {
      const bundle = await downloadRaceAssets(accessToken, race.id, user?.id);
      setDownloadProgress(100);
      await refresh();
      await setActiveRaceId(race.id);
      onOpenRace(bundle, options);
    } catch (err) {
      // The update download failed — fall back to a working offline copy if we have
      // one so the rider can still open the race with slightly older data.
      if (await openLocal()) {
        return;
      }
      setActionError(err instanceof Error ? err.message : "Download failed.");
    } finally {
      window.clearInterval(progressTimer);
      setBusyRaceId(null);
      window.setTimeout(() => setDownloadProgress(null), 400);
    }
  }

  function handleFileSelection(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!acceptGpxFile(file)) {
      setActionError("Please choose a .gpx file.");
      return;
    }
    setActionError(null);
    setImportFile(file!);
  }

  function handleImportComplete(bundle: CompanionBundle) {
    setImportFile(null);
    void refresh().then(() => {
      void setActiveRaceId(bundle.race.id);
      onOpenRace(bundle);
    });
  }

  async function confirmDeleteRace() {
    if (!deleteTarget) {
      return;
    }
    const raceId = deleteTarget.id;
    const raceSnapshot = deleteTarget;
    setDeleteBusy(true);
    setActionError(null);
    setDeleteTarget(null);
    haptic("warning");
    setDismissingRaceId(raceId);
    await new Promise((resolve) => window.setTimeout(resolve, 280));

    removeRace(raceId);

    try {
      if (accessToken && raceSnapshot.source !== "local-import" && raceSnapshot.has_bundle) {
        await deleteCloudRace(accessToken, raceId, user?.id);
      }
      await deleteCompanionRace(raceId);
      await refresh();
    } catch (err) {
      setActionError(toUserFacingError(err, "Couldn't delete this race. Try again."));
      await refresh();
    } finally {
      setDismissingRaceId(null);
      setDeleteBusy(false);
    }
  }

  function openImportPicker() {
    if (!online) {
      setActionError(importOfflineUserMessage());
      return;
    }
    if (!canImport) {
      setActionError(importUnavailableUserMessage());
      return;
    }
    fileInputRef.current?.click();
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0a0a0a]">
      <header className="urp-animate-fade-up flex shrink-0 items-center justify-between gap-4 px-6 pb-2 pt-safe-top">
        <div className="min-w-0">
          <h1 className="text-[2rem] font-semibold tracking-tight text-white">Races</h1>
          {autoSyncing ? (
            <p className="mt-1 text-sm text-white/35">Syncing…</p>
          ) : null}
        </div>
        <button type="button" onClick={onOpenAccount} className="shrink-0 rounded-full">
          <Avatar
            name={getDisplayName(user)}
            imageUrl={getAvatarUrl(user)}
            size="md"
            variant="dark"
          />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <input
          ref={fileInputRef}
          type="file"
          accept=".gpx,application/gpx+xml,application/xml,text/xml"
          className="hidden"
          onChange={(event) => {
            handleFileSelection(event.target.files);
            event.target.value = "";
          }}
        />

        <Button
          variant="primary"
          size="lg"
          dark
          className="mb-8 mt-4 w-full"
          onClick={openImportPicker}
        >
          <ImportGpxIllustration className="h-5 w-5" />
          Import GPX
        </Button>

        {!online ? (
          <EmptyState
            dark
            className="mb-6 rounded-2xl bg-white/[0.02] py-10"
            illustration={<NoInternetIllustration />}
            title="You're offline"
            description="Downloaded races still work. Import and cloud sync need an internet connection."
          />
        ) : null}

        {error ? <p className="mb-4 text-sm text-red-300">{error}</p> : null}
        {actionError ? <p className="mb-4 text-sm text-red-300">{actionError}</p> : null}

        {loading ? (
          <div className="space-y-5">
            <RaceCardSkeleton dark />
            <RaceCardSkeleton dark />
          </div>
        ) : sections.length === 0 ? (
          <EmptyState
            dark
            illustration={<NoRacesIllustration />}
            title="No races yet"
            description="Import a GPX from Files, AirDrop, Komoot, or Safari — full analysis runs in the cloud."
            action={
              online && canImport ? (
                <Button variant="primary" dark onClick={openImportPicker}>
                  <ImportGpxIllustration className="h-5 w-5" />
                  Import GPX
                </Button>
              ) : null
            }
          />
        ) : (
          <div className="space-y-5">
            {sections.map((section) => (
              <section key={section.id}>
                <ul className="space-y-5">
                  {section.races.map((race, index) => (
                    <li key={race.id} className={dismissingRaceId === race.id ? "race-card-dismiss" : undefined}>
                      <CompanionRaceCard
                        race={race}
                        busy={busyRaceId === race.id}
                        downloadProgress={busyRaceId === race.id ? downloadProgress : null}
                        staggerIndex={Math.min(index + 1, 4)}
                        onOpen={() => void handleOpenRace(race)}
                        onDelete={() => setDeleteTarget(race)}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>

      {importFile ? (
        <GpxImportFlow
          file={importFile}
          online={online}
          onClose={() => setImportFile(null)}
          onComplete={handleImportComplete}
        />
      ) : null}

      <CompanionDeleteRaceDialog
        open={Boolean(deleteTarget)}
        raceName={deleteTarget?.name ?? ""}
        busy={deleteBusy}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDeleteRace()}
      />

      {syncToast ? (
        <CompanionSyncToast
          message={syncToast.message}
          variant={syncToast.variant}
          onDismiss={dismissSyncToast}
          onRetry={syncToast.variant === "error" ? retrySync : undefined}
        />
      ) : null}
    </div>
  );
}
