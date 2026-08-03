import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DeleteRaceDialog } from "@shared/ui/DeleteRaceDialog";
import { Button } from "@shared/ui/Button";
import { EmptyState } from "@shared/ui/EmptyState";
import { SectionHeader } from "@shared/ui/SectionHeader";
import { RaceCardSkeleton } from "@shared/ui/Skeleton";
import { NoRacesIllustration } from "@shared/ui/design/illustrations";
import { getDesktopRaceSyncStatus } from "@shared/ui/SyncStatusBadge";
import { useAuth } from "@shared/auth/AuthProvider";
import { getPendingSyncRaces, removePendingSyncRace } from "@shared/sync/pendingSync";
import UploadZone from "../components/UploadZone";
import { RaceCard } from "../components/races/RaceCard";
import type { RaceManageAction } from "../components/races/RaceManageMenu";
import { RenameRaceDialog } from "../components/races/RenameRaceDialog";
import { useRace } from "../races/RaceContext";
import {
  archiveRace,
  createRace,
  deleteRace,
  duplicateRace,
  fetchRaces,
  raceExportEndpoint,
  renameRace,
  type RaceSummary,
} from "../races/api";
import { useAccountSync } from "../sync/useAccountSync";
import { useDesktopCloudRaces } from "../sync/useDesktopCloudRaces";

interface MyRacesPageProps {
  onRaceCreated: (raceId: string) => void;
  onOpenRace: (raceId: string) => void;
}

export default function MyRacesPage({ onRaceCreated, onOpenRace }: MyRacesPageProps) {
  const { races, loadingRaces, error, refreshRaces, activeRaceId, closeRace } = useRace();
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const { syncing } = useAccountSync();
  const { cloudRaces } = useDesktopCloudRaces();
  const [showCreate, setShowCreate] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [archivedRaces, setArchivedRaces] = useState<RaceSummary[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [renameTarget, setRenameTarget] = useState<RaceSummary | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RaceSummary | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [pendingRevision, setPendingRevision] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const pendingSync = useMemo(
    () => getPendingSyncRaces(userId),
    [userId, pendingRevision, syncing],
  );

  useEffect(() => {
    void refreshRaces();
  }, [refreshRaces]);

  useEffect(() => {
    if (!showArchived) {
      return;
    }
    void fetchRaces(true)
      .then((all) => setArchivedRaces(all.filter((race) => race.archived_at)))
      .catch(() => setArchivedRaces([]));
  }, [showArchived, races]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (showCreate && !dialog.open) {
      dialog.showModal();
    }
    if (!showCreate && dialog.open) {
      dialog.close();
    }
  }, [showCreate]);

  function resetCreateForm() {
    setFile(null);
    setCreateError(null);
    setIsDragging(false);
  }

  function openCreateDialog() {
    resetCreateForm();
    setShowCreate(true);
  }

  function closeCreateDialog() {
    setShowCreate(false);
    resetCreateForm();
  }

  async function importGpxFile(selected: File) {
    setCreating(true);
    setCreateError(null);
    setPageError(null);
    try {
      const name = selected.name.replace(/\.gpx$/i, "").replace(/[_-]+/g, " ");
      const race = await createRace(selected, name);
      closeCreateDialog();
      await refreshRaces();
      onRaceCreated(race.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to import route.";
      setCreateError(message);
      setPageError(message);
    } finally {
      setCreating(false);
    }
  }

  const handleManage = useCallback(
    async (raceId: string, action: RaceManageAction) => {
      const race = [...races, ...archivedRaces].find((entry) => entry.id === raceId);
      if (!race) {
        return;
      }
      setPageError(null);

      if (action === "rename") {
        setRenameTarget(race);
        return;
      }
      if (action === "delete") {
        setDeleteTarget(race);
        return;
      }
      if (action === "export-excel" || action === "export-gpx") {
        const type = action === "export-excel" ? "excel" : "validation-gpx";
        window.open(raceExportEndpoint(raceId, type), "_blank", "noopener,noreferrer");
        return;
      }

      setActionBusy(true);
      try {
        if (action === "duplicate") {
          const copy = await duplicateRace(raceId);
          await refreshRaces();
          onOpenRace(copy.id);
          return;
        }
        if (action === "archive") {
          await archiveRace(raceId, true);
          if (activeRaceId === raceId) {
            closeRace();
          }
          await refreshRaces();
          if (showArchived) {
            const all = await fetchRaces(true);
            setArchivedRaces(all.filter((entry) => entry.archived_at));
          }
          return;
        }
        if (action === "unarchive") {
          await archiveRace(raceId, false);
          await refreshRaces();
          if (showArchived) {
            const all = await fetchRaces(true);
            setArchivedRaces(all.filter((entry) => entry.archived_at));
          }
        }
      } catch (err) {
        setPageError(err instanceof Error ? err.message : "Action failed.");
      } finally {
        setActionBusy(false);
      }
    },
    [activeRaceId, archivedRaces, closeRace, onOpenRace, races, refreshRaces, showArchived],
  );

  async function confirmRename(name: string) {
    if (!renameTarget) {
      return;
    }
    setActionBusy(true);
    setPageError(null);
    try {
      await renameRace(renameTarget.id, name);
      setRenameTarget(null);
      await refreshRaces();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "Failed to rename race.");
    } finally {
      setActionBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) {
      return;
    }
    setActionBusy(true);
    setPageError(null);
    try {
      await deleteRace(deleteTarget.id);
      if (userId) {
        removePendingSyncRace(userId, deleteTarget.id);
      }
      if (activeRaceId === deleteTarget.id) {
        closeRace();
      }
      setDeleteTarget(null);
      await refreshRaces();
      setPendingRevision((value) => value + 1);
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "Failed to delete race.");
    } finally {
      setActionBusy(false);
    }
  }

  const activeRaces = races.filter((race) => !race.archived_at);
  const hasArchived = archivedRaces.length > 0 || races.some((race) => race.archived_at);

  return (
    <div className="mx-auto max-w-5xl px-6 py-14">
      <header className="urp-animate-fade-up mb-12 flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="text-[2rem] font-semibold tracking-tight text-ink">My Races</h1>
          <p className="mt-3 max-w-lg text-base leading-relaxed text-muted">
            Plan resupply, verify your stops, and export to your GPS.
          </p>
        </div>
        <Button onClick={openCreateDialog}>New race</Button>
      </header>

      {(error || createError || pageError) && !showCreate && (
        <p className="mb-8 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {error ?? createError ?? pageError}
        </p>
      )}

      {loadingRaces && activeRaces.length === 0 ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <RaceCardSkeleton />
          <RaceCardSkeleton />
          <RaceCardSkeleton />
        </div>
      ) : activeRaces.length === 0 ? (
        <EmptyState
          illustration={<NoRacesIllustration />}
          title="No races yet"
          description="Import a GPX to start planning. Analysis runs automatically — your route, stops, and exports live here."
          action={<Button onClick={openCreateDialog}>Import your first race</Button>}
        />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {activeRaces.map((race, index) => (
            <RaceCard
              key={race.id}
              race={race}
              onOpen={onOpenRace}
              onManage={(raceId, action) => void handleManage(raceId, action)}
              syncStatus={getDesktopRaceSyncStatus(
                race,
                cloudRaces,
                syncing,
                Boolean(user),
                pendingSync,
              )}
              staggerIndex={Math.min(index + 1, 4)}
            />
          ))}
        </div>
      )}

      {hasArchived ? (
        <section className="mt-14">
          <SectionHeader
            title="Archived"
            subtitle={showArchived ? `${archivedRaces.length} archived race${archivedRaces.length === 1 ? "" : "s"}` : undefined}
            action={
              <Button variant="ghost" size="sm" onClick={() => setShowArchived((current) => !current)}>
                {showArchived ? "Hide" : "Show"}
              </Button>
            }
          />
          {showArchived && archivedRaces.length > 0 ? (
            <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {archivedRaces.map((race, index) => (
                <RaceCard
                  key={race.id}
                  race={race}
                  onOpen={onOpenRace}
                  onManage={(raceId, action) => void handleManage(raceId, action)}
                  syncStatus={getDesktopRaceSyncStatus(
                    race,
                    cloudRaces,
                    syncing,
                    Boolean(user),
                    pendingSync,
                  )}
                  staggerIndex={Math.min(index + 1, 4)}
                />
              ))}
            </div>
          ) : showArchived ? (
            <p className="mt-4 text-sm text-muted">No archived races.</p>
          ) : null}
        </section>
      ) : null}

      <RenameRaceDialog
        open={Boolean(renameTarget)}
        currentName={renameTarget?.name ?? ""}
        busy={actionBusy}
        onClose={() => setRenameTarget(null)}
        onConfirm={(name) => void confirmRename(name)}
      />

      <DeleteRaceDialog
        open={Boolean(deleteTarget)}
        raceName={deleteTarget?.name ?? ""}
        distanceKm={deleteTarget?.distance_km}
        elevationGainM={deleteTarget?.elevation_gain_m}
        cloudSynced={
          deleteTarget && user
            ? cloudRaces.some(
                (cloudRace) =>
                  cloudRace.id === deleteTarget.id ||
                  (deleteTarget.gpx_fingerprint &&
                    cloudRace.gpx_fingerprint === deleteTarget.gpx_fingerprint),
              ) || deleteTarget.has_analysis
            : null
        }
        lastModified={deleteTarget?.updated_at}
        busy={actionBusy}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      />

      <dialog
        ref={dialogRef}
        className="w-full max-w-lg rounded-2xl bg-card p-0 shadow-xl ring-1 ring-black/[0.06] backdrop:bg-ink/20"
        onClose={closeCreateDialog}
      >
        <div className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-ink">Import route</h2>
              <p className="mt-1 text-sm text-muted">
                Drop a GPX file to analyze automatically — no settings required.
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={closeCreateDialog}>
              Close
            </Button>
          </div>

          <div className="mt-6">
            <UploadZone
              file={file}
              isDragging={isDragging}
              onDragEnter={() => setIsDragging(true)}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(selected) => {
                setFile(selected);
                setIsDragging(false);
                void importGpxFile(selected);
              }}
              onSelectFile={(selected) => {
                setFile(selected);
                void importGpxFile(selected);
              }}
            />
          </div>

          {creating && (
            <p className="mt-4 text-center text-sm text-muted">Importing and starting analysis…</p>
          )}

          {createError && (
            <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{createError}</p>
          )}
        </div>
      </dialog>
    </div>
  );
}
