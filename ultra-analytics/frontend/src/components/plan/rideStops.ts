import type { RecommendedStop } from "../../types";
import { elevationGainBetweenKm, type ElevProfile } from "./rideElevation";

export function isVerifiedWater(s: RecommendedStop): boolean {
  const cat = (s.category || "").toLowerCase();
  const group = (s.group || "").toLowerCase();
  return group === "water" || cat.includes("water") || cat.includes("drinking");
}

/** Markets / food shops — not bare fuel pumps. */
export function isVerifiedShop(s: RecommendedStop): boolean {
  const cat = (s.category || "").toLowerCase();
  const group = (s.group || "").toLowerCase();
  if (cat.includes("gas") || cat.includes("fuel") || cat.includes("24h")) return false;
  if (["supermarket", "convenience", "bakery", "grocery", "market"].some((x) => cat.includes(x))) {
    return true;
  }
  return group === "resupply";
}

export function mergeVerifiedStops(
  recommended: RecommendedStop[],
  saved: RecommendedStop[],
): RecommendedStop[] {
  const byId = new Map<string, RecommendedStop>();
  for (const s of recommended) {
    if (s.reviewStatus === "verified") byId.set(s.id, s);
  }
  for (const s of saved) {
    byId.set(s.id, { ...s, reviewStatus: "verified" });
  }
  return Array.from(byId.values()).sort((a, b) => a.distanceAlongKm - b.distanceAlongKm);
}

export type RideGlanceStop = {
  stop: RecommendedStop;
  distanceKm: number;
  elevGainM: number | null;
};

export type RideGlance = {
  water: RideGlanceStop | null;
  shop: RideGlanceStop | null;
};

/** Skip co-located / floating-point “current” stops when finding the next one. */
const NEXT_AHEAD_EPS_KM = 0.02;

/** Next verified water / shop strictly ahead of `fromKm` (never the current stop). */
export function nextRideGlance(
  verified: RecommendedStop[],
  fromKm: number,
  profile: ElevProfile | null | undefined,
): RideGlance {
  const ahead = (pred: (s: RecommendedStop) => boolean): RideGlanceStop | null => {
    const list = verified
      .filter((s) => pred(s) && s.distanceAlongKm > fromKm + NEXT_AHEAD_EPS_KM)
      .sort((a, b) => a.distanceAlongKm - b.distanceAlongKm);
    const stop = list[0];
    if (!stop) return null;
    return {
      stop,
      distanceKm: Math.max(0, stop.distanceAlongKm - fromKm),
      elevGainM: elevationGainBetweenKm(profile, fromKm, stop.distanceAlongKm),
    };
  };
  return {
    water: ahead(isVerifiedWater),
    shop: ahead(isVerifiedShop),
  };
}

export type RideLeg = {
  stop: RecommendedStop;
  fromKm: number;
  distanceKm: number;
  elevGainM: number | null;
  isFirst: boolean;
};

/** Legs from start (0) or previous verified stop → each verified stop. */
export function verifiedLegs(
  verified: RecommendedStop[],
  profile: ElevProfile | null | undefined,
): RideLeg[] {
  return verified.map((stop, i) => {
    const fromKm = i === 0 ? 0 : verified[i - 1].distanceAlongKm;
    return {
      stop,
      fromKm,
      distanceKm: Math.max(0, stop.distanceAlongKm - fromKm),
      elevGainM: elevationGainBetweenKm(profile, fromKm, stop.distanceAlongKm),
      isFirst: i === 0,
    };
  });
}

export function fmtRideKm(km: number): string {
  if (!Number.isFinite(km)) return "—";
  if (km < 1) return `${Math.max(0, Math.round(km * 1000))} m`;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

export function fmtRideElev(m: number | null | undefined, available: boolean): string {
  if (!available || m == null) return "—";
  return `+${Math.round(m).toLocaleString("en-US")} m`;
}
