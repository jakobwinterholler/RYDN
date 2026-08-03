import type { PoiRow, ResupplyZone, TrackPoint } from "../api";
import {
  DiscoverStopsCache,
  poiOsmKey,
  type DiscoverPoiInput,
  type DiscoverTrackPoint,
  type MapBounds,
} from "@shared/race/discoverStops";

export function mapBoundsFromLeaflet(bounds: {
  getSouth: () => number;
  getWest: () => number;
  getNorth: () => number;
  getEast: () => number;
}): MapBounds {
  return {
    south: bounds.getSouth(),
    west: bounds.getWest(),
    north: bounds.getNorth(),
    east: bounds.getEast(),
  };
}

export function poiRowToDiscoverInput(poi: PoiRow): DiscoverPoiInput {
  return {
    osmId: poi.osm_id,
    osmType: poi.osm_type,
    name: poi.name,
    category: poi.category,
    priority: poi.priority,
    lat: poi.lat,
    lon: poi.lon,
    distanceAlongKm: poi.distance_along_km,
    distanceOffRouteM: poi.distance_off_route_m,
    score: poi.score,
    zoneId: poi.zone_id,
    openingHours: poi.opening_hours,
    brand: poi.brand,
    tags: poi.tags,
  };
}

export function trackPointToDiscoverInput(point: TrackPoint): DiscoverTrackPoint {
  return {
    lat: point.lat,
    lon: point.lon,
    km: point.km,
    eleM: point.ele_m,
  };
}

export function primaryPoiKeysFromZones(zones: ResupplyZone[]): Set<string> {
  const keys = new Set<string>();
  for (const zone of zones) {
    for (const group of zone.categories) {
      if (group.primary) {
        keys.add(poiOsmKey(group.primary.osm_type, group.primary.osm_id));
      }
    }
  }
  return keys;
}

export const discoverStopsCache = new DiscoverStopsCache();

export function resetDiscoverStopsCache(): void {
  discoverStopsCache.clear();
}
