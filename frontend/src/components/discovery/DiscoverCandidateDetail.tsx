import type { DiscoverCandidate } from "@shared/race/discoverStops";
import { useStreetViewLink } from "@shared/race/useStreetViewLink";
import { formatPoiName, formatOffRouteDistance } from "../poiUi";
import { formatKm } from "../routeInsights";
import { googleMapsUrl, placeIdFromTags } from "../stopQuickActions";

interface DiscoverCandidateDetailProps {
  candidate: DiscoverCandidate;
  onVerify: () => void;
  onSkip: () => void;
  verifying?: boolean;
}

export default function DiscoverCandidateDetail({
  candidate,
  onVerify,
  onSkip,
  verifying = false,
}: DiscoverCandidateDetailProps) {
  const title = formatPoiName(candidate.name, candidate.brand ?? null, {
    poiCategory: candidate.category,
  });
  const streetView = useStreetViewLink({
    lat: candidate.lat,
    lon: candidate.lon,
    routeKm: candidate.distanceAlongKm,
    name: title,
    placeId: placeIdFromTags(candidate.tags),
  });

  return (
    <div className="pointer-events-auto absolute bottom-20 left-4 right-4 z-[1000] max-w-md animate-fade-in rounded-2xl border border-line/70 bg-card p-4 shadow-card">
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-base font-semibold text-ink">{title}</h3>
        <p className="mt-0.5 text-xs text-muted">{candidate.services.join(" · ")}</p>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-muted">Detour</dt>
          <dd className="font-medium tabular-nums text-ink">
            {formatOffRouteDistance(candidate.distanceOffRouteM)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">To next stop</dt>
          <dd className="font-medium tabular-nums text-ink">
            {candidate.distanceToNextStopKm != null
              ? formatKm(candidate.distanceToNextStopKm, 1)
              : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Opening hours</dt>
          <dd className="font-medium text-ink">{candidate.openingHours?.trim() || "Unknown"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Confidence</dt>
          <dd className="font-medium text-ink">{candidate.confidenceLabel}</dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-wrap gap-2">
        <a
          href={googleMapsUrl(candidate.lat, candidate.lon)}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-xl border border-line px-3 py-2 text-sm font-medium text-muted transition hover:text-ink"
        >
          Google Maps
        </a>
        {streetView.available !== false ? (
          <a
            href={streetView.streetViewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-xl border border-line px-3 py-2 text-sm font-medium text-muted transition hover:text-ink"
          >
            {streetView.loading ? "Street View…" : "Street View"}
          </a>
        ) : null}
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={onVerify}
          disabled={verifying}
          className="flex-1 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-accent/90 disabled:opacity-60"
        >
          ✓ Verify
        </button>
        <button
          type="button"
          onClick={onSkip}
          disabled={verifying}
          className="rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-muted transition hover:text-ink"
        >
          ✕ Skip
        </button>
      </div>
    </div>
  );
}
