/** Quick Resume — jump into the active planned route on open. */

const ENABLED_KEY = "rydn-quick-resume";
const ACTIVE_ROUTE_KEY = "rydn-active-route-id";

export function loadQuickResumeEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveQuickResumeEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, enabled ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function loadActiveRouteId(): string | null {
  try {
    const id = localStorage.getItem(ACTIVE_ROUTE_KEY);
    return id && id.trim() ? id.trim() : null;
  } catch {
    return null;
  }
}

export function saveActiveRouteId(routeId: string | null): void {
  try {
    if (!routeId) {
      localStorage.removeItem(ACTIVE_ROUTE_KEY);
      return;
    }
    localStorage.setItem(ACTIVE_ROUTE_KEY, routeId);
  } catch {
    /* ignore */
  }
}
