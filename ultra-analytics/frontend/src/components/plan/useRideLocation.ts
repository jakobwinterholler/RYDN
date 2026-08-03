/** Live GPS for Ride mode — project position onto the course. */

import { useEffect, useRef, useState } from "react";
import { projectOntoRoute } from "./customPoi";

export type RideLocationStatus =
  | "idle"
  | "requesting"
  | "tracking"
  | "denied"
  | "unavailable"
  | "off_route";

export type RideLocationState = {
  status: RideLocationStatus;
  /** Along-route km from GPS projection (null when not tracking). */
  km: number | null;
  /** Metres off the course polyline. */
  offRouteM: number | null;
  /** Last GPS accuracy in metres. */
  accuracyM: number | null;
};

const OFF_ROUTE_M = 400;
const MAX_JUMP_KM = 25;

const idle: RideLocationState = {
  status: "idle",
  km: null,
  offRouteM: null,
  accuracyM: null,
};

/**
 * Watch device position while Ride mode is active. Projects onto the route
 * polyline; ignores huge jumps and marks far-off fixes as off_route.
 */
export function useRideLocation(
  enabled: boolean,
  points: number[][] | null | undefined,
): RideLocationState {
  const [state, setState] = useState<RideLocationState>(idle);
  const lastKmRef = useRef<number | null>(null);
  const pointsRef = useRef(points);
  pointsRef.current = points;

  useEffect(() => {
    if (!enabled) {
      lastKmRef.current = null;
      setState(idle);
      return;
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setState({ ...idle, status: "unavailable" });
      return;
    }

    setState((s) => ({ ...s, status: "requesting" }));

    const onPos = (pos: GeolocationPosition) => {
      const pts = pointsRef.current;
      if (!pts || pts.length < 2) return;
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      const accuracyM =
        typeof pos.coords.accuracy === "number" && Number.isFinite(pos.coords.accuracy)
          ? pos.coords.accuracy
          : null;
      const proj = projectOntoRoute(pts, lat, lon);
      const prev = lastKmRef.current;
      if (prev != null && Math.abs(proj.distanceAlongKm - prev) > MAX_JUMP_KM) {
        // Likely a GPS glitch — keep previous km, stay tracking.
        setState({
          status: "tracking",
          km: prev,
          offRouteM: proj.distanceOffRouteM,
          accuracyM,
        });
        return;
      }
      lastKmRef.current = proj.distanceAlongKm;
      const off = proj.distanceOffRouteM > OFF_ROUTE_M;
      setState({
        status: off ? "off_route" : "tracking",
        km: proj.distanceAlongKm,
        offRouteM: proj.distanceOffRouteM,
        accuracyM,
      });
    };

    const onErr = (err: GeolocationPositionError) => {
      if (err.code === err.PERMISSION_DENIED) {
        setState({ ...idle, status: "denied" });
        return;
      }
      setState((s) =>
        s.status === "tracking" || s.status === "off_route"
          ? s
          : { ...idle, status: "unavailable" },
      );
    };

    const watchId = navigator.geolocation.watchPosition(onPos, onErr, {
      enableHighAccuracy: true,
      maximumAge: 4000,
      timeout: 15000,
    });

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [enabled]);

  return state;
}
