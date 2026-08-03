export {
  googleMapsUrl,
  googleStreetViewUrl,
  googleStreetViewFallbackMapsUrl,
  normalizeWebsite,
  placeIdFromTags,
  resolveStreetView,
  type StreetViewLocation,
  type StreetViewUrlOptions,
} from "@shared/race/streetViewUrl";
export { useStreetViewLink } from "@shared/race/useStreetViewLink";

export function openStreetMapUrl(lat: number, lon: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`;
}

export function formatCoordinates(lat: number, lon: number): string {
  return `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
}

export async function copyCoordinates(lat: number, lon: number): Promise<void> {
  await navigator.clipboard.writeText(formatCoordinates(lat, lon));
}
