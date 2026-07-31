/** Minimal Google Maps typings for Street View (avoid @types/google.maps dep). */

declare namespace google.maps {
  class LatLng {
    constructor(lat: number, lng: number);
    lat(): number;
    lng(): number;
  }

  interface LatLngLiteral {
    lat: number;
    lng: number;
  }

  interface StreetViewPov {
    heading: number;
    pitch: number;
  }

  interface StreetViewPanoramaOptions {
    position?: LatLngLiteral | LatLng;
    pov?: StreetViewPov;
    zoom?: number;
    pano?: string;
    visible?: boolean;
    addressControl?: boolean;
    linksControl?: boolean;
    fullscreenControl?: boolean;
    panControl?: boolean;
    zoomControl?: boolean;
    enableCloseButton?: boolean;
    motionTracking?: boolean;
    motionTrackingControl?: boolean;
    showRoadLabels?: boolean;
    imageDateControl?: boolean;
    clickToGo?: boolean;
    disableDefaultUI?: boolean;
  }

  class StreetViewPanorama {
    constructor(container: HTMLElement, opts?: StreetViewPanoramaOptions);
    setVisible(visible: boolean): void;
    setPosition(pos: LatLngLiteral | LatLng): void;
    setPov(pov: StreetViewPov): void;
    setPano(pano: string): void;
    getStatus(): StreetViewStatus;
  }

  enum StreetViewStatus {
    OK = "OK",
    UNKNOWN_ERROR = "UNKNOWN_ERROR",
    ZERO_RESULTS = "ZERO_RESULTS",
  }

  enum StreetViewSource {
    DEFAULT = "default",
    OUTDOOR = "outdoor",
  }

  interface StreetViewLocationRequest {
    location: LatLngLiteral | LatLng;
    radius?: number;
    source?: StreetViewSource;
    preference?: StreetViewPreference;
  }

  enum StreetViewPreference {
    NEAREST = "nearest",
    BEST = "best",
  }

  interface StreetViewPanoramaData {
    location?: { latLng?: LatLng; pano?: string; shortDescription?: string };
  }

  class StreetViewService {
    getPanorama(
      request: StreetViewLocationRequest,
      callback: (data: StreetViewPanoramaData | null, status: StreetViewStatus) => void,
    ): void;
  }
}

declare namespace google {
  const maps: typeof google.maps;
}

interface Window {
  google?: typeof google;
  __rydnGoogleMapsInit?: () => void;
}
