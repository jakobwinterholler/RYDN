import type { CompanionStop } from "../types/sync";
import { isMapVisibleStopStatus } from "./discoverVerification";

export function filterStopsForResupplyView(
  stops: CompanionStop[],
  verifiedOnly: boolean,
): CompanionStop[] {
  return stops.filter((stop) =>
    isMapVisibleStopStatus(stop.verificationStatus, !verifiedOnly),
  );
}
