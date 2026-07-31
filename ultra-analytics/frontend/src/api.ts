import type {
  AuthConfig,
  Cabinet,
  PlannedRouteDetail,
  PlannedRouteSummary,
  Provider,
  Report,
  RideSummary,
  RouteAnalysis,
  SyncResult,
  Ultra,
  UltraAnalysis,
  UltraDetail,
  User,
} from "./types";
import { ApiError, networkErrorMessage, userMessageFromDetail } from "./errors";
import { reportClientError } from "./telemetry";

export type RideKind = "training" | "race";
export type ImportPurpose = "planned" | "completed";

/** Empty in tunnel/same-origin mode; set VITE_API_BASE for split API host in prod. */
const API_BASE = ((import.meta.env.VITE_API_BASE as string | undefined) || "").replace(/\/$/, "");

function api(path: string): string {
  return `${API_BASE}${path}`;
}

const opts: RequestInit = { credentials: "include" };

async function readDetail(res: Response): Promise<unknown> {
  try {
    const body = await res.json();
    return body?.detail ?? body?.message ?? null;
  } catch {
    return null;
  }
}

async function fail(res: Response, fallback: string): Promise<never> {
  const detail = await readDetail(res);
  const message = userMessageFromDetail(detail, res.status, fallback);
  if (res.status >= 500) {
    reportClientError({
      message,
      source: "api",
      status: res.status,
      url: res.url || window.location.pathname,
    });
  }
  throw new ApiError(message, res.status);
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(api(path), { ...opts, ...init });
  } catch (err) {
    throw new ApiError(networkErrorMessage(err), 0, "network");
  }
}

// ---- auth ----
export async function getAuthConfig(): Promise<AuthConfig> {
  const res = await request("/api/auth/config");
  if (!res.ok) await fail(res, "Could not load sign-in options.");
  return (await res.json()) as AuthConfig;
}

export async function getMe(): Promise<User | null> {
  const res = await request("/api/auth/me");
  if (res.status === 401) return null;
  if (!res.ok) await fail(res, "Could not load account.");
  return (await res.json()) as User;
}

export async function devLogin(): Promise<User> {
  const res = await request("/api/auth/dev-login", { method: "POST" });
  if (!res.ok) await fail(res, "Dev login failed.");
  return (await res.json()) as User;
}

export async function logout(): Promise<void> {
  const res = await request("/api/auth/logout", { method: "POST" });
  if (!res.ok) await fail(res, "Could not sign out. Try refreshing the page.");
}

export async function markOnboarded(): Promise<User> {
  const res = await request("/api/auth/onboarded", { method: "POST" });
  if (!res.ok) await fail(res, "Could not save onboarding.");
  return (await res.json()) as User;
}

export async function updateProfile(patch: { weightKg?: number | null }): Promise<User> {
  const res = await request("/api/auth/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) await fail(res, "Could not save profile.");
  return (await res.json()) as User;
}

// ---- ride providers ----
export async function getProviders(): Promise<Provider[]> {
  const res = await request("/api/providers");
  if (!res.ok) await fail(res, "Could not load providers.");
  return (await res.json()) as Provider[];
}

export function connectProviderUrl(id: string): string {
  return api(`/api/providers/${id}/connect`);
}

export async function syncProvider(id: string): Promise<SyncResult> {
  const res = await request(`/api/providers/${id}/sync`, { method: "POST" });
  if (!res.ok) await fail(res, "Sync failed. Check your connection and try again.");
  return (await res.json()) as SyncResult;
}

export async function importRide(
  kind: RideKind,
  files: File[],
  name?: string,
): Promise<RideSummary> {
  const form = new FormData();
  form.append("kind", kind);
  form.append("purpose", "completed");
  if (name) form.append("name", name);
  for (const file of files) form.append("files", file);

  const res = await request("/api/import", { method: "POST", body: form });
  if (!res.ok) await fail(res, "Import failed. Try a fresh FIT, TCX, or GPX export.");
  return (await res.json()) as RideSummary;
}

export async function importPlannedRoute(file: File, name?: string): Promise<PlannedRouteSummary> {
  const form = new FormData();
  form.append("file", file);
  if (name) form.append("name", name);
  const res = await request("/api/routes/import", { method: "POST", body: form });
  if (!res.ok) await fail(res, "Could not import planned route. Check the GPX and try again.");
  return (await res.json()) as PlannedRouteSummary;
}

export type ImportProgressStats = {
  distanceKm?: number;
  elevationGainM?: number;
  pointCount?: number;
  climbCount?: number;
  waterCount?: number;
  supermarketCount?: number;
  bikeShopCount?: number;
  remoteGapCount?: number;
  recommendedStopCount?: number;
  stageCount?: number;
  criticalDecisionCount?: number;
  [key: string]: unknown;
};

export type ImportProgressUpdate = {
  stage: string;
  label: string;
  pct: number;
  stats?: ImportProgressStats;
};

/** SSE progress for Planned Route GPX import. Falls back callers can still use importPlannedRoute. */
export async function importPlannedRouteStream(
  file: File,
  name?: string,
  onProgress?: (update: ImportProgressUpdate) => void,
): Promise<PlannedRouteSummary> {
  const form = new FormData();
  form.append("file", file);
  if (name) form.append("name", name);

  let res: Response;
  try {
    res = await fetch(api("/api/routes/import/stream"), { ...opts, method: "POST", body: form });
  } catch (err) {
    throw new ApiError(networkErrorMessage(err), 0, "network");
  }

  if (!res.ok) {
    await fail(res, "Could not import planned route. Check the GPX and try again.");
  }
  if (!res.body) {
    throw new ApiError("No response stream from server.", 0, "network");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let summary: PlannedRouteSummary | null = null;

  const handleEvent = (event: Record<string, unknown>) => {
    const type = event.type;
    if (type === "progress") {
      onProgress?.({
        stage: String(event.stage || ""),
        label: String(event.label || "Working…"),
        pct: Math.max(0, Math.min(99, Number(event.pct) || 0)),
        stats: (event.stats as ImportProgressStats) || undefined,
      });
      return;
    }
    if (type === "done") {
      summary = event.summary as PlannedRouteSummary;
      onProgress?.({
        stage: "done",
        label: String(event.label || "Route imported successfully"),
        pct: 100,
        stats: (event.stats as ImportProgressStats) || undefined,
      });
      return;
    }
    if (type === "error") {
      throw new ApiError(
        String(event.message || "Could not import planned route. Check the GPX and try again."),
        400,
      );
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      for (const line of chunk.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const raw = trimmed.slice(5).trim();
        if (!raw || raw === "[DONE]") continue;
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          continue;
        }
        handleEvent(parsed);
      }
    }
  }

  // Flush any trailing event without a final blank line
  if (buffer.trim()) {
    for (const line of buffer.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const raw = trimmed.slice(5).trim();
      if (!raw) continue;
      try {
        handleEvent(JSON.parse(raw) as Record<string, unknown>);
      } catch {
        /* ignore trailing junk */
      }
    }
  }

  if (!summary) {
    throw new ApiError("Import ended without a result. Try again.", 0, "network");
  }
  return summary;
}

export async function getRoute(id: string): Promise<PlannedRouteDetail> {
  const res = await request(`/api/routes/${id}`);
  if (!res.ok) await fail(res, "Route not found.");
  return (await res.json()) as PlannedRouteDetail;
}

export async function getRouteAnalysis(
  id: string,
  opts: { refresh?: boolean; targetStageKm?: number } = {},
): Promise<RouteAnalysis> {
  const q = new URLSearchParams();
  if (opts.refresh) q.set("refresh", "true");
  if (opts.targetStageKm != null) q.set("targetStageKm", String(opts.targetStageKm));
  const qs = q.toString();
  const res = await request(`/api/routes/${id}/analysis${qs ? `?${qs}` : ""}`);
  if (!res.ok) await fail(res, "Could not analyse this route.");
  return (await res.json()) as RouteAnalysis;
}

export interface ViewportPoisResult {
  pois: Array<{
    id: string;
    osmId: number;
    osmType: string;
    name: string | null;
    category: string;
    group: string;
    lat: number;
    lon: number;
    distanceAlongKm: number;
    distanceOffRouteM: number;
    openingHours?: string | null;
    website?: string | null;
    phone?: string | null;
    is24h?: boolean;
    hasShop?: boolean;
    hotelStars?: number | null;
    reviewStatus?: string;
    googleMapsUrl?: string | null;
    qualityStars?: number;
    qualityLabel?: string;
    qualityScore?: number;
    resupplyScore?: number;
    storeSize?: string;
    services?: string[];
  }>;
  cache?: string;
  error?: string | null;
  truncated?: boolean;
  hasMore?: boolean;
  batchSize?: number;
  candidateCount?: number;
  excludedCount?: number;
  corridorPois?: number;
  timings?: {
    totalMs?: number;
    serverMs?: number;
    requestMs?: number;
    cacheLookupMs?: number;
    gridMs?: number;
    spatialFilterMs?: number;
    rankMs?: number;
    overpassMs?: number | null;
    projectMs?: number | null;
  };
  stats?: {
    corridorPois?: number;
    inView?: number;
    candidates?: number;
    returned?: number;
    cache?: string;
  };
}

export type ViewportSearchOpts = {
  group?: string;
  limit?: number;
  /** Already-seen / verified ids — Search-again skips these. */
  exclude?: string[];
  signal?: AbortSignal;
};

/** Viewport POI search — corridor cache first (instant), Overpass only as fill. */
export async function searchRouteViewportPois(
  id: string,
  bbox: { south: number; west: number; north: number; east: number },
  groupOrOpts: string | ViewportSearchOpts = "all",
): Promise<ViewportPoisResult> {
  const opts: ViewportSearchOpts =
    typeof groupOrOpts === "string" ? { group: groupOrOpts } : groupOrOpts || {};
  const q = new URLSearchParams({
    south: String(bbox.south),
    west: String(bbox.west),
    north: String(bbox.north),
    east: String(bbox.east),
    group: opts.group || "all",
    limit: String(opts.limit ?? 10),
  });
  if (opts.exclude?.length) q.set("exclude", opts.exclude.join(","));
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const res = await request(`/api/routes/${id}/pois?${q}`, { signal: opts.signal });
  if (!res.ok) await fail(res, "Could not search this area.");
  const body = (await res.json()) as ViewportPoisResult;
  const networkMs =
    (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0;
  const serverMs = body.timings?.serverMs ?? body.timings?.totalMs;
  if (typeof console !== "undefined" && console.info) {
    console.info("[rydn.search]", {
      cache: body.cache ?? body.stats?.cache,
      networkMs: Math.round(networkMs),
      serverMs,
      overpassMs: body.timings?.overpassMs ?? null,
      spatialFilterMs: body.timings?.spatialFilterMs,
      pois: body.pois?.length ?? 0,
      candidates: body.candidateCount ?? body.stats?.candidates,
      corridorPois: body.corridorPois ?? body.stats?.corridorPois,
    });
  }
  return body;
}

/** Warm Search corridor cache on route open (background). */
export async function preloadRoutePois(id: string): Promise<{
  ok: boolean;
  poiCount?: number;
  timings?: { totalMs?: number };
  cache?: string;
}> {
  try {
    const res = await request(`/api/routes/${id}/pois/preload`, { method: "POST" });
    if (!res.ok) return { ok: false };
    return (await res.json()) as {
      ok: boolean;
      poiCount?: number;
      timings?: { totalMs?: number };
      cache?: string;
    };
  } catch {
    return { ok: false };
  }
}

export async function patchRoute(
  id: string,
  body: Partial<{
    name: string;
    status: string;
    dateStart: string | null;
    dateEnd: string | null;
    notes: string;
    stopReviews: Record<string, string | null>;
    savedStops: Record<string, import("./types").RecommendedStop | null>;
    preparation: Partial<{
      routeUnderstood: boolean;
      stopsVerified: boolean;
      keyClimbsReviewed: boolean;
      stagesPlanned: boolean;
      notes: string;
    }>;
  }>,
): Promise<PlannedRouteDetail> {
  const res = await request(`/api/routes/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) await fail(res, "Could not update route.");
  return (await res.json()) as PlannedRouteDetail;
}

export async function deleteRoute(id: string): Promise<void> {
  const res = await request(`/api/routes/${id}`, { method: "DELETE" });
  if (!res.ok) await fail(res, "Could not delete route.");
}

/** Download planned-route GPX (course + verified water/shop waypoints). */
export async function downloadRouteGpx(id: string, fallbackName = "route.gpx"): Promise<void> {
  const res = await request(`/api/routes/${id}/export.gpx`);
  if (!res.ok) await fail(res, "Could not export GPX.");
  const blob = await res.blob();
  let filename = fallbackName;
  const cd = res.headers.get("Content-Disposition") || "";
  const utf = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  const plain = /filename="([^"]+)"/i.exec(cd) || /filename=([^;]+)/i.exec(cd);
  if (utf?.[1]) {
    try {
      filename = decodeURIComponent(utf[1]);
    } catch {
      filename = utf[1];
    }
  } else if (plain?.[1]) {
    filename = plain[1].trim().replace(/^"|"$/g, "");
  }
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function loadSample(): Promise<RideSummary> {
  const res = await request("/api/sample", { method: "POST" });
  if (!res.ok) await fail(res, "No sample ride available.");
  return (await res.json()) as RideSummary;
}

export async function listRides(): Promise<RideSummary[]> {
  const res = await request("/api/rides");
  if (!res.ok) await fail(res, "Could not load your rides.");
  return (await res.json()) as RideSummary[];
}

export async function getCabinet(): Promise<Cabinet> {
  const res = await request("/api/cabinet");
  if (!res.ok) await fail(res, "Could not load your Ultras.");
  return (await res.json()) as Cabinet;
}

export async function createUltra(body: {
  name: string;
  activityIds?: string[];
  year?: number;
  countryCodes?: string[];
  countriesManual?: boolean;
  country?: string;
  dateStart?: string;
  dateEnd?: string;
  result?: string;
  finishPlace?: string;
  rating?: number;
  status?: string;
  kind?: string;
}): Promise<Ultra> {
  const res = await request("/api/ultras", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) await fail(res, "Could not create Ultra.");
  return (await res.json()) as Ultra;
}

export async function getUltra(id: string): Promise<UltraDetail> {
  const res = await request(`/api/ultras/${id}`);
  if (!res.ok) await fail(res, "Ultra not found.");
  return (await res.json()) as UltraDetail;
}

export async function getUltraAnalysis(id: string, force = false): Promise<UltraAnalysis> {
  const q = force ? "?force=true" : "";
  const res = await request(`/api/ultras/${id}/analysis${q}`);
  if (!res.ok) await fail(res, "Could not load Ultra analytics.");
  return (await res.json()) as UltraAnalysis;
}

export async function patchUltra(
  id: string,
  body: Partial<{
    name: string;
    year: number | null;
    countryCodes: string[];
    countriesManual: boolean;
    activityIds: string[];
    activityOrderManual: boolean;
    dateStart: string | null;
    dateEnd: string | null;
    result: string | null;
    status: string;
    kind: string;
  }>,
): Promise<UltraDetail> {
  const res = await request(`/api/ultras/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) await fail(res, "Could not update Ultra.");
  return (await res.json()) as UltraDetail;
}

export async function deleteUltra(id: string): Promise<void> {
  const res = await request(`/api/ultras/${id}`, { method: "DELETE" });
  if (!res.ok) await fail(res, "Could not delete Ultra.");
}

export async function getRide(id: string): Promise<Report> {
  const res = await request(`/api/rides/${id}`);
  if (!res.ok) await fail(res, "Ride not found.");
  return (await res.json()) as Report;
}

export async function deleteRide(id: string): Promise<void> {
  const res = await request(`/api/rides/${id}`, { method: "DELETE" });
  if (!res.ok) await fail(res, "Could not delete ride.");
}

// ---- maps (Street View) ----

export type MapsJsConfig = {
  apiKey: string | null;
  configured: boolean;
};

/** Auth-gated Maps JS key from server env — never baked into the Vite bundle. */
export async function getMapsJsConfig(): Promise<MapsJsConfig> {
  const res = await request("/api/maps/js-config");
  if (!res.ok) await fail(res, "Could not load Maps configuration.");
  return (await res.json()) as MapsJsConfig;
}

export type StreetViewMetadataResponse = {
  status: "OK" | "ZERO_RESULTS" | "UNKNOWN" | string;
  available: boolean;
  location: { lat: number; lng: number } | null;
  pano_id: string | null;
};

export type StreetViewMetadataClient = {
  status: "OK" | "ZERO_RESULTS" | "UNKNOWN";
  available: boolean;
  location: { lat: number; lng: number } | null;
  panoId: string | null;
};

/** Proxy Street View Metadata (key stays server-side). */
export async function fetchStreetViewMetadata(
  lat: number,
  lon: number,
  opts?: { radius?: number; source?: "outdoor" | "default" },
): Promise<StreetViewMetadataClient> {
  const unknown: StreetViewMetadataClient = {
    status: "UNKNOWN",
    available: true,
    location: null,
    panoId: null,
  };

  for (const source of opts?.source
    ? [opts.source]
    : (["outdoor", "default"] as const)) {
    const params = new URLSearchParams({
      lat: String(lat),
      lon: String(lon),
      radius: String(opts?.radius ?? 100),
      source,
    });
    try {
      const res = await request(`/api/maps/streetview/metadata?${params}`);
      if (!res.ok) continue;
      const data = (await res.json()) as StreetViewMetadataResponse;
      if (data.status === "ZERO_RESULTS") {
        continue;
      }
      if (data.status === "OK") {
        return {
          status: "OK",
          available: true,
          location: data.location,
          panoId:
            typeof data.pano_id === "string" && data.pano_id.trim()
              ? data.pano_id.trim()
              : null,
        };
      }
      return unknown;
    } catch {
      return unknown;
    }
  }

  return {
    status: "ZERO_RESULTS",
    available: false,
    location: null,
    panoId: null,
  };
}
