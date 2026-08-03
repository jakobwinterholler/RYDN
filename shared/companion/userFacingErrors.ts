/** Map technical failures to rider-friendly copy. Log details only in dev builds. */

const TECHNICAL_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  {
    pattern: /not configured|VITE_API_BASE_URL|analysis server/i,
    message:
      "Route import isn't available right now. Try again in a moment, or import the GPX on desktop Ultra Roadbook.",
  },
  {
    pattern: /sign in|401|session expired|unauthorized/i,
    message: "Sign in with Google to import a route.",
  },
  {
    pattern: /internet|offline|network|failed to fetch|load failed/i,
    message: "Check your internet connection and try again.",
  },
  {
    pattern: /timeout|timed out|504|503/i,
    message: "The server took too long to respond. Try again with a stable connection.",
  },
];

export function logCompanionDiagnostic(label: string, detail: unknown): void {
  if (import.meta.env.DEV) {
    console.error(`[Ultra Roadbook] ${label}`, detail);
  }
}

export function toUserFacingError(error: unknown, fallback: string): string {
  const raw =
    error instanceof Error ? error.message : typeof error === "string" ? error : fallback;
  logCompanionDiagnostic("error", raw);
  for (const { pattern, message } of TECHNICAL_PATTERNS) {
    if (pattern.test(raw)) {
      return message;
    }
  }
  if (/^[A-Z_]+:/.test(raw) || raw.includes("VITE_") || raw.includes("Supabase")) {
    return fallback;
  }
  return raw.length > 160 ? fallback : raw;
}

export function importUnavailableUserMessage(): string {
  return "Route import isn't available right now. Try again shortly, or use desktop Ultra Roadbook to analyze your GPX.";
}

export function importOfflineUserMessage(): string {
  return "Connect to the internet to import and analyze a GPX route.";
}

export function importSignInUserMessage(): string {
  return "Sign in with Google to import a route.";
}

export function cloudSyncUnavailableUserMessage(): string {
  return "Cloud sync isn't available in this version of the app. Try updating, or contact support if the problem continues.";
}
