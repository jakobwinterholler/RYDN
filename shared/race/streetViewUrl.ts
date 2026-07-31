import { buildRouteTrack, haversineM, interpolateTrackAtKm } from "./mapMatching";

export interface StreetViewLocation {
  lat: number;
  lon: number;
  /** Google Place ID when available on the POI. */
  placeId?: string | null;
  /** Route km — used for debug logging and heading fallback only. */
  routeKm?: number;
  /** POI / business name — used for Maps fallback links only. */
  name?: string | null;
}

export interface StreetViewUrlOptions {
  routeCoordinates?: [number, number][];
  totalDistanceKm?: number;
  /** Field of view in degrees (default 75). */
  fov?: number;
  /** Camera pitch in degrees (default 0). */
  pitch?: number;
}

export const STREET_VIEW_SEARCH_RADIUS_M = 100;

const DEFAULT_FOV = 75;
const DEFAULT_PITCH = 0;

/** Real Google Place IDs start with ChI/GhI/EhI — OSM tags are often not valid. */
export function isGooglePlaceId(value: string | null | undefined): boolean {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length < 10) {
    return false;
  }
  return /^(ChI|GhI|EhI)/.test(trimmed);
}

function normalizeBearing(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

export function bearingBetween(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
): number {
  const fromLat = (from.lat * Math.PI) / 180;
  const toLat = (to.lat * Math.PI) / 180;
  const deltaLon = ((to.lon - from.lon) * Math.PI) / 180;
  const y = Math.sin(deltaLon) * Math.cos(toLat);
  const x =
    Math.cos(fromLat) * Math.sin(toLat) -
    Math.sin(fromLat) * Math.cos(toLat) * Math.cos(deltaLon);
  return normalizeBearing((Math.atan2(y, x) * 180) / Math.PI);
}

interface ApproachCamera {
  viewpoint: { lat: number; lon: number };
  heading: number;
}

/**
 * The Street View LOCATION is always the POI — byte-identical to the Google Maps
 * link, so both open the exact same verified stop. The route approach point is
 * used ONLY to orient the camera toward the POI (heading); it never moves the
 * viewpoint. (Previously the viewpoint was snapped to the GPX route at the stop
 * km, which made off-route stops open a different, unrelated location.)
 */
export function computeStreetViewApproach(
  location: StreetViewLocation,
  options?: StreetViewUrlOptions,
): ApproachCamera {
  const poi = { lat: location.lat, lon: location.lon };
  const coords = options?.routeCoordinates;

  if (coords?.length && location.routeKm != null) {
    const track = buildRouteTrack(coords, options?.totalDistanceKm);
    const routePoint = interpolateTrackAtKm(track, location.routeKm);

    // Heading only — face from the road toward the POI. Location stays the POI.
    if (haversineM(routePoint.lat, routePoint.lon, poi.lat, poi.lon) >= 5) {
      return {
        viewpoint: poi,
        heading: bearingBetween({ lat: routePoint.lat, lon: routePoint.lon }, poi),
      };
    }
  }

  return { viewpoint: poi, heading: 0 };
}

function buildStreetViewPanoUrl(options: {
  viewpoint: { lat: number; lon: number };
  heading?: number | null;
  panoId?: string | null;
  fov?: number;
  pitch?: number;
}): string {
  const params = new URLSearchParams({
    api: "1",
    map_action: "pano",
    viewpoint: `${options.viewpoint.lat.toFixed(6)},${options.viewpoint.lon.toFixed(6)}`,
  });

  // Only force a heading when we know the REAL panorama location (metadata path).
  // Otherwise omit it: per the Google Maps URLs API, when heading is absent Google
  // auto-orients the camera toward the viewpoint (the POI) from whatever panorama
  // it snaps to. A heading computed from the route point can face the wrong way.
  if (options.heading != null && Number.isFinite(options.heading)) {
    params.set("heading", String(Math.round(options.heading)));
    params.set("pitch", String(options.pitch ?? DEFAULT_PITCH));
    params.set("fov", String(options.fov ?? DEFAULT_FOV));
  }

  const panoId = options.panoId?.trim();
  if (panoId) {
    params.set("pano", panoId);
  }

  return `https://www.google.com/maps/@?${params.toString()}`;
}

/** GPX point on the route at stop km — for debug logging only. */
export function gpxPointAtStopKm(
  location: StreetViewLocation,
  options?: StreetViewUrlOptions,
): { lat: number; lon: number } | null {
  const coords = options?.routeCoordinates;
  if (!coords?.length || location.routeKm == null) {
    return null;
  }
  const track = buildRouteTrack(coords, options?.totalDistanceKm);
  const routePoint = interpolateTrackAtKm(track, location.routeKm);
  return { lat: routePoint.lat, lon: routePoint.lon };
}

export interface StreetViewDebugInfo {
  poiLat: number;
  poiLon: number;
  gpxLat: number | null;
  gpxLon: number | null;
  gpxDistanceFromPoiM: number | null;
  panoramaLat: number | null;
  panoramaLon: number | null;
  panoramaDistanceFromPoiM: number | null;
  heading: number | null;
  status: StreetViewMetadataStatus;
  poiName?: string | null;
}

export function logStreetViewDebug(debug: StreetViewDebugInfo): void {
  if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV !== true) {
    return;
  }
  console.info("[StreetView]", {
    poi: `${debug.poiLat.toFixed(6)},${debug.poiLon.toFixed(6)}${debug.poiName ? ` (${debug.poiName})` : ""}`,
    gpx:
      debug.gpxLat != null && debug.gpxLon != null
        ? `${debug.gpxLat.toFixed(6)},${debug.gpxLon.toFixed(6)}`
        : null,
    gpxDistanceFromPoiM: debug.gpxDistanceFromPoiM,
    panorama:
      debug.panoramaLat != null && debug.panoramaLon != null
        ? `${debug.panoramaLat.toFixed(6)},${debug.panoramaLon.toFixed(6)}`
        : null,
    panoramaDistanceFromPoiM: debug.panoramaDistanceFromPoiM,
    heading: debug.heading,
    status: debug.status,
  });
}

function buildMapsSearchQuery(location: StreetViewLocation): string | undefined {
  const name = location.name?.trim();
  if (!name) {
    return undefined;
  }
  return `${name}, ${location.lat.toFixed(6)}, ${location.lon.toFixed(6)}`;
}

export function googleMapsUrl(lat: number, lon: number, placeId?: string | null): string {
  if (isGooglePlaceId(placeId)) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`place_id:${placeId!.trim()}`)}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
}

export function buildStreetViewUrlFromPanorama(
  panorama: { lat: number; lon: number },
  poi: { lat: number; lon: number },
  options?: Pick<StreetViewUrlOptions, "fov" | "pitch"> & {
    panoId?: string | null;
  },
): string {
  // Viewpoint is the POI (identical coordinates to the Google Maps link). The
  // resolved panorama is pinned via panoId (so Google shows the official nearest
  // pano, not a user photo-sphere) and only orients the heading toward the POI.
  return buildStreetViewPanoUrl({
    viewpoint: poi,
    heading: bearingBetween(panorama, poi),
    panoId: options?.panoId,
    fov: options?.fov,
    pitch: options?.pitch,
  });
}

/**
 * Best-effort Street View URL — opens the panorama nearest the POI, looking at it.
 *
 * The location is ALWAYS the POI (byte-identical to the Google Maps link) and we
 * deliberately omit the heading so Google auto-faces the POI from the panorama it
 * actually picks. We never include a place query — that opens Maps photo galleries
 * on mobile. (`_options` is kept for signature compatibility with callers that pass
 * route context used only by the metadata path.)
 */
export function googleStreetViewUrl(
  location: StreetViewLocation,
  _options?: StreetViewUrlOptions,
): string {
  return buildStreetViewPanoUrl({
    viewpoint: { lat: location.lat, lon: location.lon },
  });
}

/** Maps search URL — use when Street View has no coverage at the POI. */
export function googleStreetViewFallbackMapsUrl(
  location: Pick<StreetViewLocation, "lat" | "lon" | "placeId" | "name">,
): string {
  if (isGooglePlaceId(location.placeId)) {
    return googleMapsUrl(location.lat, location.lon, location.placeId);
  }
  const query = buildMapsSearchQuery(location as StreetViewLocation);
  if (query) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  }
  return googleMapsUrl(location.lat, location.lon);
}

export function normalizeWebsite(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }
  return `https://${url}`;
}

export type StreetViewMetadataStatus = "OK" | "ZERO_RESULTS" | "UNKNOWN";

export interface StreetViewAvailability {
  available: boolean;
  status: StreetViewMetadataStatus;
}

export interface StreetViewMetadataResult extends StreetViewAvailability {
  panorama: { lat: number; lon: number } | null;
  panoId: string | null;
}

export function parseStreetViewMetadataStatus(status: string | undefined): StreetViewAvailability {
  if (status === "OK") {
    return { available: true, status: "OK" };
  }
  if (status === "ZERO_RESULTS") {
    return { available: false, status: "ZERO_RESULTS" };
  }
  return { available: true, status: "UNKNOWN" };
}

function streetViewApiKey(options?: { apiKey?: string }): string | undefined {
  if (options?.apiKey) {
    return options.apiKey;
  }
  if (typeof import.meta !== "undefined") {
    // Prefer server-side proxy; client keys are discouraged (CORS + key exposure).
    return (import.meta as { env?: { VITE_GOOGLE_MAPS_API_KEY?: string } }).env
      ?.VITE_GOOGLE_MAPS_API_KEY;
  }
  return undefined;
}

function streetViewMetadataProxyUrl(options?: {
  metadataProxyUrl?: string;
}): string | undefined {
  if (options?.metadataProxyUrl) {
    return options.metadataProxyUrl;
  }
  if (typeof import.meta !== "undefined") {
    const fromEnv = (import.meta as { env?: { VITE_STREET_VIEW_METADATA_PROXY?: string } })
      .env?.VITE_STREET_VIEW_METADATA_PROXY;
    if (fromEnv?.trim()) {
      return fromEnv.trim();
    }
  }
  // Same-origin RYDN / ultra-analytics backend proxy (key never in the browser).
  return "/api/maps/streetview/metadata";
}

function parseMetadataPayload(data: {
  status?: string;
  location?: { lat: number; lng: number } | null;
  pano_id?: string | null;
}): StreetViewMetadataResult {
  const parsed = parseStreetViewMetadataStatus(data.status);
  const panorama =
    parsed.available && data.location
      ? { lat: data.location.lat, lon: data.location.lng }
      : null;
  const panoId =
    parsed.available && typeof data.pano_id === "string" && data.pano_id.trim()
      ? data.pano_id.trim()
      : null;
  return { ...parsed, panorama, panoId };
}

async function fetchStreetViewMetadataAt(
  lat: number,
  lon: number,
  options?: {
    apiKey?: string;
    metadataProxyUrl?: string;
    radiusM?: number;
    source?: "outdoor" | "default";
  },
): Promise<StreetViewMetadataResult> {
  const radius = options?.radiusM ?? STREET_VIEW_SEARCH_RADIUS_M;
  const unknown: StreetViewMetadataResult = {
    available: true,
    status: "UNKNOWN",
    panorama: null,
    panoId: null,
  };

  // 1) Server proxy — preferred; API key stays on the backend.
  const proxy = streetViewMetadataProxyUrl(options);
  if (proxy) {
    const proxyParams = new URLSearchParams({
      lat: String(lat),
      lon: String(lon),
      radius: String(radius),
    });
    if (options?.source === "outdoor" || options?.source === "default") {
      proxyParams.set("source", options.source);
    }
    try {
      const response = await fetch(`${proxy}?${proxyParams.toString()}`, {
        credentials: "include",
      });
      if (response.ok) {
        const data = (await response.json()) as {
          status?: string;
          location?: { lat: number; lng: number } | null;
          pano_id?: string | null;
        };
        return parseMetadataPayload(data);
      }
    } catch {
      // Fall through to optional direct key (tests / legacy).
    }
  }

  // 2) Direct Google call only when a key is explicitly available (tests).
  const apiKey = streetViewApiKey(options);
  if (!apiKey) {
    return unknown;
  }

  const params = new URLSearchParams({
    location: `${lat},${lon}`,
    radius: String(radius),
    key: apiKey,
  });
  if (options?.source === "outdoor") {
    params.set("source", "outdoor");
  }

  try {
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/streetview/metadata?${params.toString()}`,
    );
    if (!response.ok) {
      return unknown;
    }
    const data = (await response.json()) as {
      status?: string;
      location?: { lat: number; lng: number };
      pano_id?: string;
    };
    return parseMetadataPayload(data);
  } catch {
    return unknown;
  }
}

/**
 * Fetch the nearest official Street View panorama to the POI itself — the exact
 * coordinates the Google Maps link uses. We never search a route/approach point:
 * that returns panoramas near the road that can be unrelated to the stop.
 */
export async function fetchStreetViewMetadata(
  location: StreetViewLocation,
  options?: StreetViewUrlOptions & {
    apiKey?: string;
    metadataProxyUrl?: string;
    radiusM?: number;
  },
): Promise<StreetViewMetadataResult> {
  const poi = { lat: location.lat, lon: location.lon };

  let sawUnknown = false;

  for (const source of ["outdoor", "default"] as const) {
    const result = await fetchStreetViewMetadataAt(poi.lat, poi.lon, {
      apiKey: options?.apiKey,
      metadataProxyUrl: options?.metadataProxyUrl,
      radiusM: options?.radiusM,
      source,
    });
    if (result.status === "UNKNOWN") {
      sawUnknown = true;
    }
    if (result.status === "ZERO_RESULTS") {
      continue;
    }
    if (result.panorama) {
      return result;
    }
  }

  if (sawUnknown) {
    return { available: true, status: "UNKNOWN", panorama: null, panoId: null };
  }

  return { available: false, status: "ZERO_RESULTS", panorama: null, panoId: null };
}

export interface ResolvedStreetView {
  available: boolean;
  streetViewUrl: string | null;
  mapsFallbackUrl: string;
  debug: StreetViewDebugInfo;
}

/** Resolve Street View at the POI with nearest panorama search and POI-facing heading. */
export async function resolveStreetView(
  location: StreetViewLocation,
  options?: StreetViewUrlOptions & { apiKey?: string; metadataProxyUrl?: string },
): Promise<ResolvedStreetView> {
  const poi = { lat: location.lat, lon: location.lon };
  const gpx = gpxPointAtStopKm(location, options);
  const mapsFallbackUrl = googleStreetViewFallbackMapsUrl(location);
  const syncUrl = googleStreetViewUrl(location, options);

  const metadata = await fetchStreetViewMetadata(location, options);

  const debugBase: StreetViewDebugInfo = {
    poiLat: poi.lat,
    poiLon: poi.lon,
    poiName: location.name,
    gpxLat: gpx?.lat ?? null,
    gpxLon: gpx?.lon ?? null,
    gpxDistanceFromPoiM:
      gpx != null ? Math.round(haversineM(gpx.lat, gpx.lon, poi.lat, poi.lon)) : null,
    panoramaLat: null,
    panoramaLon: null,
    panoramaDistanceFromPoiM: null,
    heading: null,
    status: metadata.status,
  };

  if (metadata.status === "ZERO_RESULTS") {
    const debug = { ...debugBase, status: "ZERO_RESULTS" as const };
    logStreetViewDebug(debug);
    return {
      available: false,
      streetViewUrl: null,
      mapsFallbackUrl,
      debug,
    };
  }

  if (metadata.panorama) {
    const panorama = metadata.panorama;
    const heading = bearingBetween(panorama, poi);
    const debug: StreetViewDebugInfo = {
      ...debugBase,
      panoramaLat: panorama.lat,
      panoramaLon: panorama.lon,
      panoramaDistanceFromPoiM: Math.round(
        haversineM(panorama.lat, panorama.lon, poi.lat, poi.lon),
      ),
      heading: Math.round(heading),
      status: "OK",
    };
    logStreetViewDebug(debug);

    return {
      available: true,
      streetViewUrl: buildStreetViewUrlFromPanorama(panorama, poi, {
        fov: options?.fov,
        pitch: options?.pitch,
        panoId: metadata.panoId,
      }),
      mapsFallbackUrl,
      debug,
    };
  }

  // Metadata unavailable (no API key, CORS, network) — still open Street View at POI.
  const debug: StreetViewDebugInfo = { ...debugBase, status: metadata.status };
  logStreetViewDebug(debug);
  return {
    available: true,
    streetViewUrl: syncUrl,
    mapsFallbackUrl,
    debug,
  };
}

/** @deprecated Use resolveStreetView — kept for callers migrating incrementally. */
export async function checkStreetViewAvailability(
  location: StreetViewLocation,
  options?: StreetViewUrlOptions & { apiKey?: string },
): Promise<StreetViewAvailability> {
  const result = await fetchStreetViewMetadata(location, options);
  return { available: result.available, status: result.status };
}

export function placeIdFromTags(
  tags?: Record<string, string> | null,
  direct?: string | null,
): string | null {
  if (isGooglePlaceId(direct)) {
    return direct!.trim();
  }
  if (!tags) {
    return null;
  }
  for (const key of ["place_id", "google_place_id", "google:place_id"]) {
    const value = tags[key];
    if (isGooglePlaceId(value)) {
      return value.trim();
    }
  }
  return null;
}
