import { useMemo, useState } from "react";
import { useAuth } from "@shared/auth/AuthProvider";
import { verificationStatsLine } from "@shared/race/applyVerificationToBundle";
import { countNearbyVerificationStops } from "@shared/race/sortVerificationQueue";
import type { CompanionVerificationUpdates } from "@shared/types/verification";
import { useCompanion } from "../context/CompanionContext";
import { sortedVerificationQueue } from "../lib/verificationProximity";
import { useVerificationActions } from "../lib/useVerificationActions";
import type { CompanionStop } from "../types";
import StopDetailSheet from "../components/StopDetailSheet";
import VerificationSwipeStack, { type VerificationAction } from "../components/VerificationSwipeStack";

function updatesForAction(action: VerificationAction): CompanionVerificationUpdates {
  if (action === "verified") {
    return { status: "verified" };
  }
  return {
    status: "rejected",
    rejectReason: "could_not_verify",
  };
}

export default function VerificationScreen() {
  const { bundle, gps, currentKm } = useCompanion();
  const { user } = useAuth();
  const { submitVerification } = useVerificationActions(user?.id ?? null);
  const [detailStop, setDetailStop] = useState<CompanionStop | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const queue = useMemo(
    () =>
      sortedVerificationQueue(bundle, {
        lat: gps.lat,
        lon: gps.lon,
        currentKm,
      }),
    [bundle, currentKm, gps.lat, gps.lon],
  );

  const nearbyCount = useMemo(
    () => countNearbyVerificationStops(queue, gps.lat, gps.lon),
    [gps.lat, gps.lon, queue],
  );

  const statsLine = useMemo(() => verificationStatsLine(bundle), [bundle]);

  async function handleAction(stop: CompanionStop, action: VerificationAction): Promise<boolean> {
    setActionError(null);
    const result = await submitVerification(stop, {
      ...updatesForAction(action),
      category: stop.category,
    });
    if (!result.ok) {
      setActionError(result.error ?? "Could not save verification.");
      return false;
    }
    return true;
  }

  return (
    <div className="verify-tab flex h-full min-h-0 flex-col">
      <header className="verify-tab__header shrink-0 border-b border-white/8 px-4 pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-orange-300">Verify</p>
            <p className="mt-0.5 truncate text-sm font-medium tabular-nums text-white/75">{statsLine}</p>
          </div>
          {nearbyCount > 0 ? (
            <p className="shrink-0 rounded-full bg-orange-500/15 px-2.5 py-1 text-[11px] font-semibold text-orange-200 ring-1 ring-orange-400/30">
              {nearbyCount} nearby
            </p>
          ) : null}
        </div>
        {actionError ? (
          <p className="mt-2 rounded-lg border border-red-400/25 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-200">
            {actionError}
          </p>
        ) : null}
      </header>

      <div className="verify-tab__stack min-h-0 flex-1">
        <VerificationSwipeStack
          stops={queue}
          totalKm={bundle.race.distanceKm}
          gpsLat={gps.lat}
          gpsLon={gps.lon}
          routeCoordinates={bundle.route.coordinates}
          onAction={(stop, action) => handleAction(stop, action)}
          onOpenDetails={setDetailStop}
        />
      </div>

      {detailStop ? (
        <StopDetailSheet
          stop={detailStop}
          totalKm={bundle.race.distanceKm}
          gpsLat={gps.lat}
          gpsLon={gps.lon}
          routeCoordinates={bundle.route.coordinates}
          onClose={() => setDetailStop(null)}
        />
      ) : null}
    </div>
  );
}
