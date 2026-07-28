/** Helpers for the import dialog — purpose persistence + GPX timestamp probe. */

export type ImportPurpose = "planned" | "completed";

const PURPOSE_KEY = "rydn.import.purpose";

export function loadImportPurpose(): ImportPurpose {
  try {
    const raw = localStorage.getItem(PURPOSE_KEY);
    if (raw === "planned" || raw === "completed") return raw;
  } catch {
    /* ignore */
  }
  return "planned";
}

export function saveImportPurpose(purpose: ImportPurpose): void {
  try {
    localStorage.setItem(PURPOSE_KEY, purpose);
  } catch {
    /* ignore */
  }
}

/** True when the GPX text contains at least one track/route point with a time. */
export function gpxHasTimestamps(text: string): boolean {
  // Cheap probe: look for <time> near track points without full XML parse.
  return /<(?:\w+:)?(?:trkpt|rtept)\b[^>]*>[\s\S]*?<(?:\w+:)?time>/i.test(text);
}

export async function fileHasGpxTimestamps(file: File): Promise<boolean> {
  const name = (file.name || "").toLowerCase();
  if (!name.endsWith(".gpx")) return true; // FIT/TCX treated as timed activities
  try {
    const text = await file.text();
    return gpxHasTimestamps(text);
  } catch {
    return false;
  }
}
