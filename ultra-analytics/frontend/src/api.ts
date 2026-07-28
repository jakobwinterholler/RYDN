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

export async function patchRoute(
  id: string,
  body: Partial<{
    name: string;
    status: string;
    dateStart: string | null;
    dateEnd: string | null;
    notes: string;
    stopReviews: Record<string, string | null>;
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
