/** Lazy-loaded embedded Street View for Planning verification. */

import { useEffect, useRef, useState } from "react";
import { fetchStreetViewMetadata, getMapsJsConfig } from "../../api";
import { loadGoogleMaps } from "../../lib/loadGoogleMaps";

export type StreetViewProps = {
  latitude: number;
  longitude: number;
  /** Optional camera heading in degrees. */
  heading?: number;
  /** Google Maps place / search URL for empty-state fallback. */
  mapsUrl: string;
  /** Called when coverage is confirmed absent (hide duplicate sheet actions). */
  onEmptyChange?: (empty: boolean) => void;
  /** Empty-state "Verify anyway". */
  onVerifyAnyway?: () => void;
  verifyDisabled?: boolean;
  verifyLabel?: string;
};

type Phase = "placeholder" | "loading" | "ready" | "empty" | "error";

function bearingDegrees(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): number {
  const fromLat = (from.lat * Math.PI) / 180;
  const toLat = (to.lat * Math.PI) / 180;
  const deltaLon = ((to.lng - from.lng) * Math.PI) / 180;
  const y = Math.sin(deltaLon) * Math.cos(toLat);
  const x =
    Math.cos(fromLat) * Math.sin(toLat) -
    Math.sin(fromLat) * Math.cos(toLat) * Math.cos(deltaLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function destroyPanorama(
  panorama: google.maps.StreetViewPanorama | null,
  container: HTMLElement | null,
): void {
  try {
    panorama?.setVisible(false);
  } catch {
    /* ignore */
  }
  if (container) {
    container.replaceChildren();
  }
}

export default function StreetView({
  latitude,
  longitude,
  heading,
  mapsUrl,
  onEmptyChange,
  onVerifyAnyway,
  verifyDisabled,
  verifyLabel = "Verify anyway",
}: StreetViewProps) {
  const [phase, setPhase] = useState<Phase>("placeholder");
  const [errorHint, setErrorHint] = useState<string | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const panoramaRef = useRef<google.maps.StreetViewPanorama | null>(null);
  const onEmptyChangeRef = useRef(onEmptyChange);
  onEmptyChangeRef.current = onEmptyChange;

  const selectionKey = `${latitude.toFixed(6)},${longitude.toFixed(6)}`;

  useEffect(() => {
    setPhase("placeholder");
    setErrorHint(null);
    onEmptyChangeRef.current?.(false);
    destroyPanorama(panoramaRef.current, hostRef.current);
    panoramaRef.current = null;
  }, [selectionKey]);

  useEffect(() => {
    return () => {
      destroyPanorama(panoramaRef.current, hostRef.current);
      panoramaRef.current = null;
    };
  }, []);

  async function handleLoad(): Promise<void> {
    if (phase === "loading" || phase === "ready") return;
    setPhase("loading");
    setErrorHint(null);
    onEmptyChangeRef.current?.(false);

    try {
      const meta = await fetchStreetViewMetadata(latitude, longitude);
      if (meta.status === "ZERO_RESULTS" || meta.available === false) {
        setPhase("empty");
        onEmptyChangeRef.current?.(true);
        return;
      }

      const config = await getMapsJsConfig();
      if (!config.configured || !config.apiKey) {
        setPhase("error");
        setErrorHint("Street View is not configured.");
        return;
      }

      const maps = await loadGoogleMaps(config.apiKey);
      const host = hostRef.current;
      if (!host) {
        setPhase("error");
        setErrorHint("Street View container missing.");
        return;
      }

      destroyPanorama(panoramaRef.current, host);
      panoramaRef.current = null;

      const poi = { lat: latitude, lng: longitude };
      let position = meta.location
        ? { lat: meta.location.lat, lng: meta.location.lng }
        : poi;
      let panoId = meta.panoId;
      let povHeading = heading ?? 0;

      // Confirm coverage via StreetViewService when JS is available.
      try {
        const service = new maps.StreetViewService();
        const lookup = (source?: google.maps.StreetViewSource) =>
          new Promise<{
            data: google.maps.StreetViewPanoramaData | null;
            status: google.maps.StreetViewStatus;
          }>((resolve) => {
            service.getPanorama(
              {
                location: poi,
                radius: 100,
                ...(source != null ? { source } : {}),
              },
              (data, status) => resolve({ data, status }),
            );
          });

        let found = await lookup(maps.StreetViewSource.OUTDOOR);
        if (found.status === maps.StreetViewStatus.ZERO_RESULTS) {
          found = await lookup();
        }
        if (found.status === maps.StreetViewStatus.ZERO_RESULTS) {
          setPhase("empty");
          onEmptyChangeRef.current?.(true);
          return;
        }
        if (found.data?.location?.latLng) {
          position = {
            lat: found.data.location.latLng.lat(),
            lng: found.data.location.latLng.lng(),
          };
          panoId = found.data.location.pano ?? panoId;
        }
      } catch {
        // Metadata OK / UNKNOWN — still try creating the panorama.
      }

      if (heading == null) {
        povHeading = bearingDegrees(position, poi);
      }

      const panorama = new maps.StreetViewPanorama(host, {
        position,
        pano: panoId || undefined,
        pov: { heading: povHeading, pitch: 0 },
        zoom: 1,
        visible: true,
        addressControl: false,
        linksControl: false,
        fullscreenControl: false,
        panControl: false,
        zoomControl: false,
        enableCloseButton: false,
        motionTracking: false,
        motionTrackingControl: false,
        showRoadLabels: false,
        imageDateControl: false,
        clickToGo: true,
        disableDefaultUI: true,
      });
      panoramaRef.current = panorama;
      setPhase("ready");
    } catch (err) {
      destroyPanorama(panoramaRef.current, hostRef.current);
      panoramaRef.current = null;
      setPhase("error");
      setErrorHint(err instanceof Error ? err.message : "Could not load Street View.");
    }
  }

  return (
    <div className="plan-streetview" data-phase={phase}>
      <div
        ref={hostRef}
        className={`plan-streetview__stage${phase === "ready" ? " is-live" : ""}`}
        aria-hidden={phase !== "ready"}
      />

      {phase !== "ready" && (
        <div className="plan-streetview__overlay">
          {phase === "empty" ? (
            <div className="plan-streetview__empty">
              <p className="plan-streetview__title">No Street View available for this location.</p>
              <div className="plan-streetview__empty-actions">
                <a
                  className="plan-sheet__nav-btn"
                  href={mapsUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open Google Maps
                </a>
                {onVerifyAnyway ? (
                  <button
                    type="button"
                    className="btn btn--primary plan-streetview__verify-anyway"
                    disabled={verifyDisabled}
                    onClick={onVerifyAnyway}
                  >
                    {verifyLabel}
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="plan-streetview__placeholder">
              <div className="plan-streetview__blur" aria-hidden />
              <div className="plan-streetview__copy">
                <p className="plan-streetview__title">Street View</p>
                <p className="plan-streetview__caption">
                  {phase === "error" && errorHint
                    ? errorHint
                    : "Load an interactive 360° view to verify this location."}
                </p>
                <button
                  type="button"
                  className="btn btn--primary plan-streetview__load"
                  disabled={phase === "loading"}
                  aria-busy={phase === "loading" || undefined}
                  onClick={() => void handleLoad()}
                >
                  {phase === "loading" ? (
                    <>
                      <span className="btn__spinner" aria-hidden />
                      Loading…
                    </>
                  ) : phase === "error" ? (
                    "Retry Street View"
                  ) : (
                    "Load Street View"
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
