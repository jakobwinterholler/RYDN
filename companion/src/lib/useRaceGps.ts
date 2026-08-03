import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CompanionBundle } from "@shared/types/sync";
import {
  buildRouteTrack,
  GPS_DEFAULTS,
  interpolateTrackAtKm,
  matchPositionToRoute,
  PositionSmoother,
  type RouteTrack,
} from "@shared/race/mapMatching";

export type GpsStatus =
  | "acquiring"
  | "active"
  | "degraded"
  | "lost"
  | "unavailable"
  | "denied";

export interface RaceGpsState {
  status: GpsStatus;
  currentKm: number;
  lat: number | null;
  lon: number | null;
  bearing: number;
  accuracyM: number | null;
  snapDistanceM: number | null;
  speedKmh: number | null;
  lastUpdateAt: number | null;
}

const INITIAL_STATE: RaceGpsState = {
  status: "acquiring",
  currentKm: 0,
  lat: null,
  lon: null,
  bearing: 0,
  accuracyM: null,
  snapDistanceM: null,
  speedKmh: null,
  lastUpdateAt: null,
};

interface UseRaceGpsOptions {
  enabled: boolean;
  bundle: CompanionBundle | null;
}

export function useRaceGps({ enabled, bundle }: UseRaceGpsOptions) {
  const [state, setState] = useState<RaceGpsState>(INITIAL_STATE);
  const trackRef = useRef<RouteTrack | null>(null);
  const smootherRef = useRef(new PositionSmoother(0.35));
  const lastGoodRef = useRef<{
    km: number;
    lat: number;
    lon: number;
    bearing: number;
    at: number;
    speedKmh: number;
  } | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const deadReckonTimerRef = useRef<number | null>(null);

  const routeTrack = useMemo(() => {
    if (!bundle) {
      return null;
    }
    return buildRouteTrack(bundle.route.coordinates, bundle.race.distanceKm);
  }, [bundle]);

  useEffect(() => {
    trackRef.current = routeTrack;
  }, [routeTrack]);

  const applyDeadReckoning = useCallback(() => {
    const last = lastGoodRef.current;
    const track = trackRef.current;
    if (!last || !track) {
      return;
    }
    const elapsedSec = (Date.now() - last.at) / 1000;
    if (elapsedSec > GPS_DEFAULTS.deadReckoningMaxSeconds) {
      setState((prev) => ({ ...prev, status: "lost" }));
      return;
    }
    const speedKmh = Math.max(last.speedKmh, GPS_DEFAULTS.deadReckoningMinSpeedKmh);
    const advancedKm = last.km + (speedKmh / 3600) * elapsedSec;
    const sample = interpolateTrackAtKm(track, advancedKm);
    setState((prev) => ({
      ...prev,
      status: "lost",
      currentKm: sample.km,
      lat: sample.lat,
      lon: sample.lon,
      bearing: sample.bearing,
      speedKmh,
      lastUpdateAt: Date.now(),
    }));
  }, []);

  useEffect(() => {
    if (!enabled || !bundle || !routeTrack) {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      if (deadReckonTimerRef.current !== null) {
        window.clearInterval(deadReckonTimerRef.current);
        deadReckonTimerRef.current = null;
      }
      smootherRef.current.reset();
      lastGoodRef.current = null;
      setState(INITIAL_STATE);
      return;
    }

    if (!navigator.geolocation) {
      setState((prev) => ({ ...prev, status: "unavailable" }));
      return;
    }

    setState((prev) => ({ ...prev, status: "acquiring" }));

    const handlePosition = (position: GeolocationPosition) => {
      const track = trackRef.current;
      if (!track) {
        return;
      }

      const { latitude, longitude, accuracy, speed } = position.coords;
      const accuracyM = Number.isFinite(accuracy) ? accuracy : null;
      const speedKmh =
        speed != null && Number.isFinite(speed) ? Math.max(0, speed * 3.6) : null;

      const matched = matchPositionToRoute(latitude, longitude, track, {
        hintKm: lastGoodRef.current?.km ?? null,
      });
      if (!matched) {
        return;
      }

      const now = Date.now();
      const tooInaccurate = accuracyM != null && accuracyM > GPS_DEFAULTS.minAccuracyM;
      const tooFarFromRoute = matched.snapDistanceM > GPS_DEFAULTS.maxSnapDistanceM;

      if (tooFarFromRoute) {
        if (lastGoodRef.current) {
          setState((prev) => ({
            ...prev,
            status: "degraded",
            accuracyM,
            snapDistanceM: matched.snapDistanceM,
            speedKmh,
            lastUpdateAt: now,
          }));
        }
        return;
      }

      const smoothed = smootherRef.current.smooth(
        matched.lat,
        matched.lon,
        matched.km,
      );

      const status: GpsStatus = tooInaccurate ? "degraded" : "active";
      lastGoodRef.current = {
        km: smoothed.km,
        lat: smoothed.lat,
        lon: smoothed.lon,
        bearing: matched.bearing,
        at: now,
        speedKmh: speedKmh ?? lastGoodRef.current?.speedKmh ?? GPS_DEFAULTS.deadReckoningMinSpeedKmh,
      };

      setState({
        status,
        currentKm: smoothed.km,
        lat: smoothed.lat,
        lon: smoothed.lon,
        bearing: matched.bearing,
        accuracyM,
        snapDistanceM: matched.snapDistanceM,
        speedKmh,
        lastUpdateAt: now,
      });
    };

    const handleError = (error: GeolocationPositionError) => {
      if (error.code === error.PERMISSION_DENIED) {
        setState((prev) => ({ ...prev, status: "denied" }));
        return;
      }
      if (lastGoodRef.current) {
        applyDeadReckoning();
      } else {
        setState((prev) => ({ ...prev, status: "unavailable" }));
      }
    };

    watchIdRef.current = navigator.geolocation.watchPosition(handlePosition, handleError, {
      enableHighAccuracy: true,
      maximumAge: 2000,
      timeout: 15000,
    });

    deadReckonTimerRef.current = window.setInterval(() => {
      const last = lastGoodRef.current;
      if (!last) {
        return;
      }
      const staleMs = Date.now() - last.at;
      if (staleMs > 5000) {
        applyDeadReckoning();
      }
    }, 2000);

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      if (deadReckonTimerRef.current !== null) {
        window.clearInterval(deadReckonTimerRef.current);
        deadReckonTimerRef.current = null;
      }
    };
  }, [applyDeadReckoning, bundle, enabled, routeTrack]);

  return { gps: state, routeTrack };
}
