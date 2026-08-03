import type { SyncRaceSummary } from "../types/sync";
import { needsDesktopUpload, resolveCloudRaceForLocal } from "../sync/raceVersion";

export type SyncIndicator =
  | "cloud-synced"
  | "syncing"
  | "waiting-to-sync"
  | "needs-upload"
  | "offline-downloaded"
  | "update-available";

const LABELS: Record<SyncIndicator, string> = {
  "cloud-synced": "Cloud synced",
  syncing: "Syncing…",
  "waiting-to-sync": "Waiting to sync",
  "needs-upload": "Needs upload",
  "offline-downloaded": "Downloaded",
  "update-available": "Update available",
};

interface SyncStatusBadgeProps {
  status: SyncIndicator;
  variant?: "light" | "dark";
  className?: string;
}

function Icon({ status }: { status: SyncIndicator }) {
  if (status === "syncing") {
    return (
      <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
        <path
          className="opacity-80"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
        />
      </svg>
    );
  }
  if (status === "cloud-synced") {
    return (
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M7 18a4 4 0 010-8 5 5 0 019.9-1" strokeLinecap="round" />
        <path d="M12 13l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (status === "needs-upload" || status === "waiting-to-sync") {
    return (
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M12 19V5M5 12l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (status === "offline-downloaded") {
    return (
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M12 3v12M7 10l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5 21h14" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M4 4v5h5M20 20v-5h-5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 9A8 8 0 006.34 6.34M4 15a8 8 0 0013.66 2.66" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function tone(status: SyncIndicator, dark: boolean): string {
  if (status === "syncing") {
    return dark ? "text-sky-300 bg-sky-400/10" : "text-sky-700 bg-sky-50";
  }
  if (status === "waiting-to-sync") {
    return dark ? "text-violet-300 bg-violet-400/10" : "text-violet-700 bg-violet-50";
  }
  if (status === "needs-upload") {
    return dark ? "text-amber-300 bg-amber-400/10" : "text-amber-700 bg-amber-50";
  }
  if (status === "update-available") {
    return dark ? "text-orange-300 bg-orange-400/10" : "text-orange-700 bg-orange-50";
  }
  if (status === "offline-downloaded") {
    return dark ? "text-emerald-300 bg-emerald-400/10" : "text-success bg-emerald-50";
  }
  return dark ? "text-white/60 bg-white/8" : "text-muted bg-surface-muted";
}

export function SyncStatusBadge({ status, variant = "light", className = "" }: SyncStatusBadgeProps) {
  const dark = variant === "dark";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium tracking-wide ${tone(status, dark)} ${className}`}
    >
      <Icon status={status} />
      {LABELS[status]}
    </span>
  );
}

export function getCompanionRaceSyncStatus(race: {
  has_bundle: boolean;
  offlineReady: boolean;
  downloadedRevision: number | null;
  companion_revision: number;
  busy?: boolean;
}): SyncIndicator | null {
  if (race.busy) {
    return "syncing";
  }
  if (!race.has_bundle) {
    return null;
  }
  if (race.offlineReady) {
    if (
      race.downloadedRevision !== null &&
      race.companion_revision > race.downloadedRevision
    ) {
      return "update-available";
    }
    return "offline-downloaded";
  }
  return "cloud-synced";
}

export function getDesktopRaceSyncStatus(
  race: {
    id: string;
    updated_at: string;
    has_analysis: boolean;
    climb_count?: number | null;
    gpx_fingerprint?: string | null;
  },
  cloudRaces: SyncRaceSummary[] | Map<string, SyncRaceSummary>,
  syncing: boolean,
  signedIn: boolean,
  pendingSync: Set<string> = new Set(),
  syncingRaceId?: string | null,
): SyncIndicator | null {
  if (!signedIn || !race.has_analysis) {
    return null;
  }
  if (syncing && syncingRaceId === race.id) {
    return "syncing";
  }
  if (syncing && !syncingRaceId) {
    return "syncing";
  }
  if (pendingSync.has(race.id)) {
    return "waiting-to-sync";
  }
  const races = cloudRaces instanceof Map ? [...cloudRaces.values()] : cloudRaces;
  const cloud = resolveCloudRaceForLocal(race, races);
  if (needsDesktopUpload(race, cloud, pendingSync)) {
    return "needs-upload";
  }
  return "cloud-synced";
}
