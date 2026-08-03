import { Button } from "@shared/ui/Button";
import { ProgressBar } from "@shared/ui/ProgressBar";
import { formatRelativeUpdated } from "@shared/ui/raceCardMetrics";
import type { StoredRaceListItem } from "../db";
import SwipeableRaceCard from "./SwipeableRaceCard";

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

interface CompanionRaceCardProps {
  race: StoredRaceListItem;
  busy: boolean;
  downloadProgress: number | null;
  staggerIndex: number;
  onOpen: () => void;
  onDelete: () => void;
}

export default function CompanionRaceCard({
  race,
  busy,
  downloadProgress,
  staggerIndex,
  onOpen,
  onDelete,
}: CompanionRaceCardProps) {
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

  const verifiedLabel =
    race.verified_stops_count != null ? String(race.verified_stops_count) : "—";

  return (
    <SwipeableRaceCard disabled={busy} onDelete={onDelete}>
      <article
        className={`urp-card-hover urp-animate-fade-up flex w-full flex-col rounded-2xl bg-white/[0.03] px-5 py-6 ring-1 ring-white/10 ${staggerClass}`}
      >
        <h3 className="text-[1.375rem] font-semibold leading-tight tracking-tight text-white">
          {race.name}
        </h3>
        <p className="mt-2 text-base tabular-nums text-white/50">
          {formatDistance(race.distance_km)}
          {race.elevation_gain_m != null ? ` · ${formatElevation(race.elevation_gain_m)}` : ""}
        </p>

        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4">
          <div>
            <dt className="text-[11px] font-medium uppercase tracking-[0.12em] text-white/35">
              Verified stops
            </dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums text-white/90">
              {verifiedLabel}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-medium uppercase tracking-[0.12em] text-white/35">
              Last updated
            </dt>
            <dd className="mt-1 text-lg font-semibold text-white/90">
              {formatRelativeUpdated(race.updated_at)}
            </dd>
          </div>
        </dl>

        {busy && downloadProgress !== null ? (
          <div className="mt-5">
            <div className="mb-1.5 flex justify-between text-xs text-sky-200/80">
              <span>Downloading…</span>
              <span>{downloadProgress}%</span>
            </div>
            <ProgressBar value={downloadProgress} dark />
          </div>
        ) : null}

        <Button
          variant="primary"
          size="lg"
          dark
          disabled={busy}
          className="mt-6 w-full"
          onClick={onOpen}
        >
          {busy ? "Downloading…" : "Open"}
        </Button>
      </article>
    </SwipeableRaceCard>
  );
}
