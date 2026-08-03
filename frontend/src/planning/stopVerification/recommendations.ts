import type { ResupplyZone } from "../../api";
import { zoneMinDetourM } from "../zonePresentation";
import { buildHubRecommendations } from "../hubRecommendations";
import { formatHoursVisual } from "../stopPresentation";
import { assessFuelShopFromTags } from "./fuelShopPresentation";
import type { TimeMode } from "../types";

export interface StopRecommendationContext {
  isLastBeforeRemote: boolean;
  isOnlyStopInArea: boolean;
}

export function buildWhyRecommended(
  zone: ResupplyZone,
  context: StopRecommendationContext,
  timeMode: TimeMode = "day",
): string[] {
  const reasons: string[] = [];
  const summary = buildHubRecommendations(zone);
  const best = summary.best?.poi;
  const detourM = best?.distance_off_route_m ?? zoneMinDetourM(zone);

  if (context.isLastBeforeRemote) {
    reasons.push("Last resupply before a long unsupported section");
  }

  if (best) {
    const category = best.poi_category.toLowerCase();
    if (category.includes("supermarket") || category.includes("convenience")) {
      reasons.push(
        category.includes("convenience") ? "Convenience store" : "Small supermarket",
      );
    }
    if (category.includes("fuel") || category.includes("gas")) {
      const fuelShop = assessFuelShopFromTags({
        poiCategory: best.poi_category,
        tags: best.tags,
        name: best.name,
        brand: best.brand,
        fuelShopConfidence: best.fuel_shop_confidence,
        fuelShopLabel: best.fuel_shop_label,
      });
      if (fuelShop) {
        reasons.push(fuelShop.label);
      }
    }
  }

  if (detourM <= 75) {
    reasons.push("Quick in and out");
  }
  if (detourM <= 20) {
    reasons.push("On the route");
  }

  if (best?.opening_hours) {
    const hours = formatHoursVisual(best.opening_hours, timeMode, best.night_usability);
    if (hours.tone === "open") {
      reasons.push("Good opening hours");
    }
  }

  if (context.isOnlyStopInArea) {
    reasons.push("Only realistic stop in this area");
  }

  if (zone.accessibility_tone === "good") {
    reasons.push("Easy bike access");
  }

  if (reasons.length === 0) {
    reasons.push("Recommended stop");
  }

  return reasons.slice(0, 5);
}

export function bikeAccessLabel(zone: ResupplyZone): string {
  switch (zone.accessibility_tone) {
    case "good":
      return "Excellent";
    case "caution":
      return "Good";
    case "warning":
      return "Moderate";
    default:
      return "Difficult";
  }
}

export function practicalityStars(ultraScore: number): number {
  if (ultraScore >= 78) return 5;
  if (ultraScore >= 62) return 4;
  if (ultraScore >= 48) return 3;
  if (ultraScore >= 34) return 2;
  return 1;
}

export function formatStarRow(stars: number): string {
  const clamped = Math.max(1, Math.min(5, stars));
  return "★".repeat(clamped) + "☆".repeat(5 - clamped);
}
