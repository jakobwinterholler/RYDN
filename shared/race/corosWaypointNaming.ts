import { isInvalidExportName } from "./gpsGpxExportConstants";

const ROAD_PREFIX =
  /^(carretera|camino|via|carrer|calle|rue|straße|strasse|road|route|avenue|av\.?|autopista)\b/i;
const ROAD_TOKENS =
  /\b(road|street|st\.?|avenue|ave\.?|boulevard|blvd\.?|lane|ln\.?|drive|dr\.?|highway|hwy\.?|camino|carretera|carrer|autopista|autovia)\b/gi;

/** Strip city suffixes (comma-separated) and parenthetical location hints. */
export function removeCityNames(value: string): string {
  let text = value.trim();
  const commaParts = text.split(",").map((part) => part.trim());
  if (commaParts.length > 1) {
    text = commaParts[0];
  }
  text = text.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  return text;
}

/** Remove road-name patterns that are unreadable on a watch. */
export function removeRoadNames(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (ROAD_PREFIX.test(trimmed)) {
    return "";
  }
  return trimmed.replace(ROAD_TOKENS, " ").replace(/\s+/g, " ").trim();
}

/** Collapse repeated words (case-insensitive). */
export function removeDuplicateWords(value: string): string {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const word of value.split(/\s+/)) {
    const key = word.toLowerCase();
    if (!word || seen.has(key)) {
      continue;
    }
    seen.add(key);
    words.push(word);
  }
  return words.join(" ");
}

export function sanitizePoiName(raw: string | null | undefined): string {
  if (!raw?.trim()) {
    return "";
  }
  let name = raw.trim();
  name = removeCityNames(name);
  name = removeRoadNames(name);
  name = removeDuplicateWords(name);
  return name.trim();
}

export function isUsableBrandName(value: string): boolean {
  const sanitized = sanitizePoiName(value);
  return sanitized.length >= 2 && !isInvalidExportName(sanitized) && !ROAD_PREFIX.test(sanitized);
}

export interface CorosWaypointLabelInput {
  name?: string | null;
  brand?: string | null;
  category: string;
  hasFuel?: boolean;
  hasWater?: boolean;
  hasFood?: boolean;
  resupplyReason?: string | null;
}

function serviceFlags(input: CorosWaypointLabelInput) {
  const category = input.category.toLowerCase();
  return {
    isFuel:
      Boolean(input.hasFuel) ||
      category.includes("fuel") ||
      category.includes("gas station") ||
      category.includes("gas_station"),
    isWater:
      Boolean(input.hasWater) ||
      category.includes("water") ||
      category.includes("fountain") ||
      category.includes("drinking"),
    isFood:
      Boolean(input.hasFood) ||
      category.includes("supermarket") ||
      category.includes("convenience") ||
      category.includes("mini supermarket") ||
      category.includes("small supermarket") ||
      category.includes("shop") ||
      category.includes("cafe") ||
      category.includes("café") ||
      category.includes("restaurant"),
  };
}

/** Compact rider-facing label — reason and service type over raw OSM names. */
export function buildCorosWaypointLabel(input: CorosWaypointLabelInput): string {
  const reason = (input.resupplyReason ?? "").toLowerCase();
  const category = input.category.toLowerCase();
  const { isFuel, isWater, isFood } = serviceFlags(input);

  if (isFuel) {
    if (reason.includes("last")) {
      return "Last Fuel";
    }
    if (reason.includes("easy") || reason.includes("practical")) {
      return "Easy Fuel";
    }
  }

  if (isWater) {
    if (reason.includes("summit") || reason.includes("before summit")) {
      return "Summit Water";
    }
    if (reason.includes("last") || reason.includes("no water")) {
      return "Last Water";
    }
    if (reason.includes("climb")) {
      return "Climb Water";
    }
  }

  if (isFood && isWater) {
    return "Food + Water";
  }

  if (category.includes("convenience") || category.includes("mini")) {
    return "Small Shop";
  }
  if (category.includes("supermarket")) {
    return "Small Shop";
  }

  const brand = sanitizePoiName(input.brand ?? input.name);
  if (brand && isUsableBrandName(brand)) {
    return brand.slice(0, 16);
  }

  const name = sanitizePoiName(input.name);
  if (name && isUsableBrandName(name)) {
    return name.slice(0, 16);
  }

  if (isFuel) {
    return "Fuel";
  }
  if (isWater) {
    return "Water";
  }
  if (isFood) {
    return "Shop";
  }
  return "Stop";
}
