import type { ResupplyZone, RoadbookResult } from "../api";
import type { VerifiedStopRecord } from "./stopVerification/types";
import { poiVerificationStatus } from "./stopVerification/verificationStatusPresentation";
import { resolveSuggestedStops } from "./suggestedStops";

export function verifiedSuggestedZoneIds(
  result: RoadbookResult,
  verifiedStops: Record<string, VerifiedStopRecord>,
): Set<number> {
  const zoneIds = new Set<number>();
  for (const stop of resolveSuggestedStops(result)) {
    const status = poiVerificationStatus(
      stop.zone_id,
      { osm_id: stop.osm_id, osm_type: stop.osm_type },
      verifiedStops,
    );
    if (status === "verified") {
      zoneIds.add(stop.zone_id);
    }
  }
  return zoneIds;
}

export function filterResupplyZonesForView(
  zones: ResupplyZone[],
  result: RoadbookResult,
  verifiedStops: Record<string, VerifiedStopRecord>,
  verifiedOnly: boolean,
): ResupplyZone[] {
  if (!verifiedOnly) {
    return zones;
  }
  const verifiedZoneIds = verifiedSuggestedZoneIds(result, verifiedStops);
  return zones.filter((zone) => verifiedZoneIds.has(zone.zone_id));
}
