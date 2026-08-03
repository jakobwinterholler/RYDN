import { useEffect, useState } from "react";
import {
  googleStreetViewFallbackMapsUrl,
  googleStreetViewUrl,
  resolveStreetView,
  type StreetViewLocation,
  type StreetViewUrlOptions,
} from "./streetViewUrl";

export interface StreetViewLinkState {
  loading: boolean;
  available: boolean | null;
  streetViewUrl: string;
  mapsUrl: string;
  unavailableMessage: string | null;
}

export function useStreetViewLink(
  location: StreetViewLocation | null,
  options?: StreetViewUrlOptions,
): StreetViewLinkState {
  const [state, setState] = useState<StreetViewLinkState>(() => ({
    loading: Boolean(location),
    available: null,
    streetViewUrl: location ? googleStreetViewUrl(location, options) : "",
    mapsUrl: location ? googleStreetViewFallbackMapsUrl(location) : "",
    unavailableMessage: null,
  }));

  useEffect(() => {
    if (!location) {
      setState({
        loading: false,
        available: null,
        streetViewUrl: "",
        mapsUrl: "",
        unavailableMessage: null,
      });
      return;
    }

    let cancelled = false;
    const fallbackMaps = googleStreetViewFallbackMapsUrl(location);
    const syncUrl = googleStreetViewUrl(location, options);

    setState({
      loading: true,
      available: null,
      streetViewUrl: syncUrl,
      mapsUrl: fallbackMaps,
      unavailableMessage: null,
    });

    void resolveStreetView(location, options).then((resolved) => {
      if (cancelled) {
        return;
      }
      if (resolved.available && resolved.streetViewUrl) {
        setState({
          loading: false,
          available: true,
          streetViewUrl: resolved.streetViewUrl,
          mapsUrl: resolved.mapsFallbackUrl,
          unavailableMessage: null,
        });
        return;
      }
      setState({
        loading: false,
        available: false,
        streetViewUrl: syncUrl,
        mapsUrl: resolved.mapsFallbackUrl,
        unavailableMessage: "No Street View available.",
      });
    });

    return () => {
      cancelled = true;
    };
  }, [
    location?.lat,
    location?.lon,
    location?.placeId,
    location?.routeKm,
    location?.name,
    options?.totalDistanceKm,
    options?.routeCoordinates,
  ]);

  return state;
}
