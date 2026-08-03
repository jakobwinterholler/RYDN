import type { ReactNode } from "react";
import type { SyncIndicator } from "./SyncStatusBadge";
import { SyncStatusBadge } from "./SyncStatusBadge";
import { Badge } from "./Badge";
import { ProgressBar } from "./ProgressBar";
import { formatRelativeUpdated } from "./raceCardMetrics";

export interface RaceProjectCardProps {
  name: string;
  distanceKm: number | null;
  elevationGainM: number | null;
  verificationPercent: number | null;
  suggestedStops: number | null;
  corosReady: boolean;
  syncStatus: SyncIndicator | null;
  lastUpdated: string | null;
  dark?: boolean;
  archived?: boolean;
  subtitle?: string | null;
  busy?: boolean;
  downloadProgress?: number | null;
  sourceBadge?: string | null;
  onOpen: () => void;
  trailing?: ReactNode;
  className?: string;
  staggerIndex?: number;
}

function formatDistance(km: number | null): string {
  if (km == null || !Number.isFinite(km)) {
    return "—";
  }
  return `${Math.round(km)} km`;
}

function formatElevation(m: number | null): string {
  if (m == null || !Number.isFinite(m)) {
    return "—";
  }
  return `+${Math.round(m).toLocaleString()} m`;
}

function Metric({
  label,
  value,
  dark,
}: {
  label: string;
  value: string;
  dark: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className={`text-[10px] font-medium uppercase tracking-wide ${dark ? "text-white/35" : "text-muted"}`}>
        {label}
      </p>
      <p className={`mt-0.5 truncate text-sm font-semibold tabular-nums ${dark ? "text-white/90" : "text-ink"}`}>
        {value}
      </p>
    </div>
  );
}

export function RaceProjectCard({
  name,
  distanceKm,
  elevationGainM,
  verificationPercent,
  suggestedStops,
  corosReady,
  syncStatus,
  lastUpdated,
  dark = false,
  archived = false,
  subtitle,
  busy = false,
  downloadProgress = null,
  sourceBadge = null,
  onOpen,
  trailing,
  className = "",
  staggerIndex = 0,
}: RaceProjectCardProps) {
  const staggerClass =
    staggerIndex === 1
      ? "urp-stagger-1"
      : staggerIndex === 2
        ? "urp-stagger-2"
        : staggerIndex === 3
          ? "urp-stagger-3"
          : staggerIndex >= 4
            ? "urp-stagger-4"
            : "";

  return (
    <article
      className={`urp-card-hover urp-animate-fade-up group flex w-full flex-col rounded-2xl p-5 ${
        dark
          ? "bg-white/[0.03] ring-1 ring-white/10 hover:ring-emerald-400/25 hover:bg-white/[0.05]"
          : "bg-card shadow-card ring-1 ring-black/[0.04] hover:ring-accent/20"
      } ${archived ? "opacity-70" : ""} ${staggerClass} ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={onOpen}
          className="min-w-0 flex-1 text-left disabled:opacity-60"
        >
          <h3
            className={`text-xl font-semibold tracking-tight transition-colors ${
              dark ? "text-white group-hover:text-emerald-200" : "text-ink group-hover:text-accent"
            }`}
          >
            {name}
          </h3>
          <p className={`mt-1 text-sm tabular-nums ${dark ? "text-white/45" : "text-muted"}`}>
            {distanceKm != null ? (
              <>
                {formatDistance(distanceKm)}
                {elevationGainM != null ? ` · ${formatElevation(elevationGainM)}` : ""}
              </>
            ) : (
              subtitle ?? "Not analyzed yet"
            )}
          </p>
        </button>
        <div className="flex shrink-0 flex-col items-end gap-2">
          {sourceBadge ? (
            <Badge dark={dark} tone="neutral">
              {sourceBadge}
            </Badge>
          ) : null}
          {syncStatus ? <SyncStatusBadge status={syncStatus} variant={dark ? "dark" : "light"} /> : null}
          {trailing}
        </div>
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={onOpen}
        className="mt-5 flex-1 text-left disabled:opacity-60"
      >
        <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3">
          <Metric
            label="Verified"
            value={verificationPercent != null ? `${verificationPercent}%` : "—"}
            dark={dark}
          />
          <Metric
            label="Stops"
            value={suggestedStops != null ? String(suggestedStops) : "—"}
            dark={dark}
          />
          <Metric label="Coros" value={corosReady ? "Ready" : "—"} dark={dark} />
        </div>

        {verificationPercent != null ? (
          <div className="mt-4">
            <ProgressBar value={verificationPercent} dark={dark} />
          </div>
        ) : null}

        {busy && downloadProgress !== null ? (
          <div className="mt-4">
            <div className={`mb-1 flex justify-between text-[11px] ${dark ? "text-sky-200/80" : "text-sky-700"}`}>
              <span>Downloading…</span>
              <span>{downloadProgress}%</span>
            </div>
            <ProgressBar value={downloadProgress} dark={dark} />
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {corosReady ? (
            <Badge dark={dark} tone="success">
              Ready for Coros
            </Badge>
          ) : null}
          {archived ? <Badge dark={dark}>Archived</Badge> : null}
        </div>

        <p className={`mt-4 text-xs ${dark ? "text-white/30" : "text-muted"}`}>
          Updated {formatRelativeUpdated(lastUpdated)}
        </p>
      </button>
    </article>
  );
}
