const DEFAULT_COMPANION_ORIGIN = "https://companion-flax.vercel.app";

export function companionOrigin(): string {
  const configured = import.meta.env.VITE_COMPANION_URL?.trim();
  if (configured) {
    return configured.replace(/\/$/, "");
  }
  return DEFAULT_COMPANION_ORIGIN;
}

/** Deep link to open a race on the Companion and jump to GPX export. */
export function companionGpxExportUrl(raceId: string, device: "coros" | "garmin" | "wahoo" = "coros"): string {
  const params = new URLSearchParams({
    race: raceId,
    tab: "share",
    export: device,
  });
  return `${companionOrigin()}/?${params.toString()}`;
}
