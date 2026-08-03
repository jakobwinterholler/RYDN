import { useMemo } from "react";
import type { CompanionBundle, CompanionStop } from "../types";
import {
  estimatedRidingToStop,
  isVerifiedEverywhere,
  isVerifiedLocally,
  nextResupplyStop,
  serviceLabels,
} from "../lib/raceExecution";
import { elevationGainBetweenKm, formatKm } from "../lib/utils";

interface NextVerifiedStopCardProps {
  bundle: CompanionBundle;
  currentKm: number;
  compact?: boolean;
}

function VerifiedBadge({ stop }: { stop: CompanionStop }) {
  if (isVerifiedEverywhere(stop.verificationStatus)) {
    return (
      <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-200">
        Verified
      </span>
    );
  }
  if (isVerifiedLocally(stop.verificationStatus)) {
    return (
      <span className="rounded-full bg-sky-500/20 px-2 py-0.5 text-[10px] font-semibold text-sky-200">
        On device
      </span>
    );
  }
  return null;
}

export default function NextVerifiedStopCard({
  bundle,
  currentKm,
  compact = false,
}: NextVerifiedStopCardProps) {
  const nextStop = useMemo(
    () => nextResupplyStop(bundle, currentKm, false),
    [bundle, currentKm],
  );

  if (!nextStop) {
    return (
      <div
        className={`rounded-2xl border border-white/10 bg-white/[0.03] ${
          compact ? "px-3 py-2.5" : "px-4 py-4"
        }`}
      >
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/40">
          Next verified stop
        </p>
        <p className="mt-1 text-sm text-white/55">No verified stops ahead on your plan.</p>
      </div>
    );
  }

  const distanceRemaining = Math.max(0, nextStop.km - currentKm);
  const elevationRemaining = elevationGainBetweenKm(bundle, currentKm, nextStop.km);
  const ridingHours = estimatedRidingToStop(bundle, currentKm, nextStop.km);

  return (
    <div
      className={`rounded-2xl border border-sky-400/30 bg-gradient-to-br from-sky-500/15 to-violet-500/10 ${
        compact ? "px-3 py-2.5" : "px-4 py-4"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-sky-200/70">
          Next verified stop
        </p>
        <VerifiedBadge stop={nextStop} />
      </div>

      <div className="mt-2 flex items-start gap-3">
        <span className={`leading-none ${compact ? "text-2xl" : "text-3xl"}`} aria-hidden>
          {nextStop.icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className={`font-semibold text-white ${compact ? "text-sm" : "text-base"}`}>
            {nextStop.name}
          </p>
          <p className="mt-0.5 text-xs text-white/45">{serviceLabels(nextStop)}</p>
          {nextStop.resupplyReason ? (
            <p className="mt-1 line-clamp-2 text-xs text-white/55">{nextStop.resupplyReason}</p>
          ) : null}
        </div>
      </div>

      <div
        className={`mt-3 flex flex-wrap gap-x-4 gap-y-1 tabular-nums text-white/70 ${
          compact ? "text-xs" : "text-sm"
        }`}
      >
        <span>{formatKm(distanceRemaining)} remaining</span>
        <span>+{elevationRemaining} m</span>
        {ridingHours > 0 ? <span>~{Math.round(ridingHours * 60)} min ride</span> : null}
      </div>
    </div>
  );
}
