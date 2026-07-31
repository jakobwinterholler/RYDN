/** Singleton loader for the Google Maps JavaScript API (never reload the script). */

let loadPromise: Promise<typeof google.maps> | null = null;

function mapsReady(): boolean {
  return Boolean(window.google?.maps?.StreetViewPanorama);
}

/**
 * Load Maps JS once for the session. Pass the key from GET /api/maps/js-config
 * (server env) — never bake the key into the Vite bundle.
 */
export function loadGoogleMaps(apiKey: string): Promise<typeof google.maps> {
  if (!apiKey.trim()) {
    return Promise.reject(new Error("Maps API key missing."));
  }
  if (mapsReady()) {
    return Promise.resolve(window.google!.maps);
  }
  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = new Promise<typeof google.maps>((resolve, reject) => {
    const previous = window.__rydnGoogleMapsInit;
    window.__rydnGoogleMapsInit = () => {
      window.__rydnGoogleMapsInit = previous;
      if (mapsReady()) {
        resolve(window.google!.maps);
      } else {
        loadPromise = null;
        reject(new Error("Google Maps loaded without Street View."));
      }
    };

    const script = document.createElement("script");
    script.id = "rydn-google-maps-js";
    script.async = true;
    script.defer = true;
    script.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey.trim())}` +
      `&callback=__rydnGoogleMapsInit&v=weekly`;
    script.onerror = () => {
      loadPromise = null;
      window.__rydnGoogleMapsInit = previous;
      script.remove();
      reject(new Error("Failed to load Google Maps JavaScript API."));
    };
    document.head.appendChild(script);
  });

  return loadPromise;
}

/** Test helper — reset singleton between unit tests. */
export function __resetGoogleMapsLoaderForTests(): void {
  loadPromise = null;
}
