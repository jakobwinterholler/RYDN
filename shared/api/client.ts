import { forceRefreshAccessToken, getFreshAccessToken } from "../auth/accessToken";
import { isSupabaseConfigured } from "../auth/supabaseClient";

export function getApiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL;
  if (configured) {
    return configured.replace(/\/$/, "");
  }
  return "";
}

/** True when mobile GPX import can reach the analysis API (env URL or same-origin proxy). */
export function isImportApiAvailable(): boolean {
  if (import.meta.env.VITE_API_BASE_URL) {
    return true;
  }
  return typeof window !== "undefined";
}

async function authFetch(
  path: string,
  accessToken: string | null,
  init: RequestInit,
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }
  const url = `${getApiBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  return fetch(url, { ...init, headers });
}

export async function fetchWithAuth(
  path: string,
  accessToken: string | null,
  init: RequestInit = {},
): Promise<Response> {
  let token = accessToken;
  if (isSupabaseConfigured()) {
    token = await getFreshAccessToken(accessToken);
  }

  let response = await authFetch(path, token, init);

  if (response.status === 401 && isSupabaseConfigured()) {
    const refreshed = await forceRefreshAccessToken();
    if (refreshed && refreshed !== token) {
      response = await authFetch(path, refreshed, init);
    }
  }

  return response;
}

export async function parseApiError(response: Response, fallback: string): Promise<string> {
  const payload = await response.json().catch(() => ({ detail: fallback }));
  const detail = payload.detail;
  if (response.status === 401) {
    return typeof detail === "string" && detail.includes("session")
      ? "Your session expired. Try syncing again — you should stay signed in."
      : "Sign in required.";
  }
  return typeof detail === "string" ? detail : fallback;
}
