import { getSupabaseClient, isSupabaseConfigured } from "./supabaseClient";

/** Refresh when the access token expires within this window. */
const REFRESH_MARGIN_SEC = 120;

/**
 * Returns a valid Supabase access token, refreshing the session when needed.
 * Returns null when the session is missing or cannot be refreshed.
 */
export async function getFreshAccessToken(
  fallback: string | null = null,
): Promise<string | null> {
  if (!isSupabaseConfigured()) {
    return fallback;
  }

  const supabase = getSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    return fallback;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const expiresAt = session.expires_at ?? 0;
  if (expiresAt - nowSec >= REFRESH_MARGIN_SEC) {
    return session.access_token;
  }

  const { data, error } = await supabase.auth.refreshSession();
  if (error || !data.session?.access_token) {
    return null;
  }
  return data.session.access_token;
}

/** Force-refresh the session — used after a 401 from the API. */
export async function forceRefreshAccessToken(): Promise<string | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.refreshSession();
  if (error || !data.session?.access_token) {
    return null;
  }
  return data.session.access_token;
}
