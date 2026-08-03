import type { DiscoverCandidate } from "@shared/race/discoverStops";
import { formatKm } from "../../lib/utils";

interface DiscoverCandidateDetailProps {
  candidate: DiscoverCandidate;
  onPromote: () => void;
  onDismiss: () => void;
  promoting?: boolean;
}

function formatOffRouteDistance(distanceOffRouteM: number): string {
  if (!Number.isFinite(distanceOffRouteM) || distanceOffRouteM < 50) {
    return "On route";
  }
  if (distanceOffRouteM < 1000) {
    return `${Math.round(distanceOffRouteM)} m`;
  }
  return `${(distanceOffRouteM / 1000).toFixed(1)} km`;
}

export default function DiscoverCandidateDetail({
  candidate,
  onPromote,
  onDismiss,
  promoting = false,
}: DiscoverCandidateDetailProps) {
  const title =
    candidate.name?.trim() ||
    (candidate.brand?.trim() ? candidate.brand.trim() : null) ||
    candidate.category;

  return (
    <div className="pointer-events-auto animate-fade-in rounded-2xl border border-white/12 bg-[#0f0f0f]/95 p-4 shadow-2xl backdrop-blur-xl">
      <div className="flex items-start gap-3">
        <span className="text-2xl leading-none" aria-hidden="true">
          {candidate.icon}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-white">{title}</h3>
          <p className="mt-0.5 text-xs text-white/45">{candidate.services.join(" · ")}</p>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-white/40">Detour</dt>
          <dd className="font-medium tabular-nums text-white">
            {formatOffRouteDistance(candidate.distanceOffRouteM)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-white/40">To next stop</dt>
          <dd className="font-medium tabular-nums text-white">
            {candidate.distanceToNextStopKm != null
              ? formatKm(candidate.distanceToNextStopKm)
              : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-white/40">Elevation to next</dt>
          <dd className="font-medium tabular-nums text-white">
            {candidate.elevationToNextStopM != null
              ? `${candidate.elevationToNextStopM >= 0 ? "+" : ""}${candidate.elevationToNextStopM} m`
              : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-white/40">Opening hours</dt>
          <dd className="font-medium text-white">{candidate.openingHours?.trim() || "Unknown"}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-xs text-white/40">Confidence</dt>
          <dd className="font-medium text-white">{candidate.confidenceLabel}</dd>
        </div>
      </dl>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={onPromote}
          disabled={promoting}
          className="flex-1 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white transition active:bg-sky-600 disabled:opacity-60"
        >
          Promote
        </button>
        <button
          type="button"
          onClick={onDismiss}
          disabled={promoting}
          className="rounded-xl border border-white/15 px-4 py-2.5 text-sm font-medium text-white/55 transition active:bg-white/8"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
