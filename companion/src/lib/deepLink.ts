export interface CompanionDeepLink {
  raceId: string | null;
  tab: "share" | "map" | "resupply" | "verify" | null;
  autoExport: "coros" | "garmin" | "wahoo" | null;
}

export function parseCompanionDeepLink(search: string): CompanionDeepLink {
  const params = new URLSearchParams(search);
  const raceId = params.get("race")?.trim() || null;
  const tabParam = params.get("tab")?.trim();
  const tab =
    tabParam === "share" ||
    tabParam === "map" ||
    tabParam === "resupply" ||
    tabParam === "verify"
      ? tabParam
      : null;
  const exportParam = params.get("export")?.trim();
  const autoExport =
    exportParam === "coros" || exportParam === "garmin" || exportParam === "wahoo"
      ? exportParam
      : null;
  return { raceId, tab, autoExport };
}

export function clearCompanionDeepLinkParams(): void {
  if (typeof window === "undefined") {
    return;
  }
  const url = new URL(window.location.href);
  for (const key of ["race", "tab", "export"]) {
    url.searchParams.delete(key);
  }
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}
