import type { RoadbookResult, SuggestedStop, ZonePoiOption } from "../api";
import { formatPoiName } from "../components/poiUi";
import { resolveSuggestedStops } from "./suggestedStops";
import { poiIcon } from "./poiMapMarkers";
import {
  poiVerificationStatus,
  verificationStatusPresentation,
} from "./stopVerification/verificationStatusPresentation";
import type { VerifiedStopRecord } from "./stopVerification/types";

export interface SuggestedStopMapMarker {
  stop: SuggestedStop;
  poi: ZonePoiOption;
  icon: string;
  label: string;
  verificationStatus: ReturnType<typeof poiVerificationStatus>;
}

export function buildSuggestedStopMapMarkers(
  result: RoadbookResult,
  verifiedStops: Record<string, VerifiedStopRecord>,
): SuggestedStopMapMarker[] {
  const suggested = resolveSuggestedStops(result);
  const zonesById = new Map(result.resupply_zones.map((zone) => [zone.zone_id, zone]));

  return suggested.flatMap((stop) => {
    const zone = zonesById.get(stop.zone_id);
    if (!zone) {
      return [];
    }

    const roadbookPoi = result.pois.find(
      (entry) => entry.osm_id === stop.osm_id && entry.osm_type === stop.osm_type,
    );

    const poi: ZonePoiOption = roadbookPoi
      ? {
          osm_id: roadbookPoi.osm_id,
          osm_type: roadbookPoi.osm_type,
          name: roadbookPoi.name,
          poi_category: roadbookPoi.category,
          distance_along_km: roadbookPoi.distance_along_km,
          distance_off_route_m: roadbookPoi.distance_off_route_m,
          accessibility_label: roadbookPoi.detour_label,
          accessibility_emoji: roadbookPoi.detour_emoji,
          accessibility_tone: roadbookPoi.detour_tone,
          score: roadbookPoi.score,
          brand: roadbookPoi.brand,
          lat: roadbookPoi.lat,
          lon: roadbookPoi.lon,
          night_usability: roadbookPoi.night_usability,
          night_usability_label: roadbookPoi.night_usability_label,
          water_fountain_type: roadbookPoi.water_fountain_type,
          water_fountain_type_label: roadbookPoi.water_fountain_type_label,
          opening_hours: roadbookPoi.opening_hours,
          phone: roadbookPoi.phone,
          website: roadbookPoi.website,
          tags: roadbookPoi.tags ?? {},
          reviews: roadbookPoi.reviews,
        }
      : {
          osm_id: stop.osm_id,
          osm_type: stop.osm_type,
          name: stop.name,
          poi_category: stop.poi_category,
          distance_along_km: stop.distance_along_km,
          distance_off_route_m: stop.distance_off_route_m,
          accessibility_label: "Unknown",
          accessibility_emoji: "○",
          accessibility_tone: "caution",
          score: stop.score,
          brand: null,
          lat: stop.lat,
          lon: stop.lon,
          night_usability: "unknown",
          night_usability_label: "Unknown",
          water_fountain_type: null,
          water_fountain_type_label: null,
          opening_hours: null,
          phone: null,
          website: null,
          tags: {},
          reviews: { source: null, rating: null, review_count: null },
        };

    const fallbackPoi = zone.categories
      .flatMap((group) => [group.primary, ...group.alternatives])
      .find((option) => option !== null);

    const verificationStatus = poiVerificationStatus(
      stop.zone_id,
      poi,
      verifiedStops,
      fallbackPoi,
    );

    return [
      {
        stop,
        poi,
        icon: poiIcon(stop.poi_category),
        label: formatPoiName(stop.name, null, {
          poiCategory: stop.poi_category,
          categoryKey: stop.category_key,
        }),
        verificationStatus,
      },
    ];
  });
}

export function suggestedStopMarkerColor(
  verificationStatus: ReturnType<typeof poiVerificationStatus>,
): string {
  const presentation = verificationStatusPresentation(verificationStatus);
  return presentation.markerColor ?? "#f97316";
}

export function isSuggestedStopVerified(
  verificationStatus: ReturnType<typeof poiVerificationStatus>,
): boolean {
  return verificationStatus === "verified";
}
