/** Map category / group / kind → RYDN plan icon. */

import type { PlanMarker } from "../planLayers";
import type { PlanIconId } from "./types";

export function iconForCategory(category?: string | null, group?: string | null): PlanIconId {
  const cat = (category || "").toLowerCase();
  const grp = (group || "").toLowerCase();

  if (cat.includes("fountain") || cat.includes("drinking")) return "waterFountain";
  if (cat.includes("natural") || cat.includes("spring") || cat.includes("stream")) return "naturalWater";
  if (grp === "water" || cat.includes("water")) return "waterFountain";

  if (cat.includes("24") || cat.includes("convenience")) return "shop24h";
  if (cat.includes("supermarket") || cat.includes("grocery")) return "supermarket";
  if (cat.includes("gas") || cat.includes("fuel")) return "gasStation";
  if (cat.includes("bike") || cat.includes("bicycle")) return "bikeShop";
  if (cat.includes("mechanic") || cat.includes("repair")) return "mechanic";
  if (cat.includes("pharmacy") || cat.includes("chemist")) return "pharmacy";
  if (cat.includes("café") || cat.includes("cafe") || cat.includes("coffee")) return "cafe";
  if (cat.includes("restaurant") || cat.includes("fast food")) return "restaurant";
  if (cat.includes("hotel") || cat.includes("hostel") || cat.includes("motel")) return "hotel";
  if (cat.includes("camp") || cat.includes("camping")) return "camping";
  if (cat.includes("shelter") || cat.includes("hut") || cat.includes("refuge")) return "shelter";
  if (cat.includes("train") || cat.includes("station") || cat.includes("rail")) return "trainStation";
  if (cat.includes("hospital") || cat.includes("clinic")) return "hospital";
  if (cat.includes("atm") || cat.includes("bank")) return "atm";
  if (cat.includes("toilet") || cat.includes("restroom") || cat.includes("wc")) return "toilet";
  if (cat.includes("bakery")) return "resupply";

  if (grp === "sleep") return "sleepSpot";
  if (grp === "resupply") return "resupply";
  if (grp === "dining") return "restaurant";
  if (grp === "service") return "mechanic";
  if (grp === "emergency") return "emergency";

  return "pin";
}

export function iconForMarker(m: PlanMarker): PlanIconId {
  if (m.kind === "climb" || m.kind === "decision") return "climb";
  if (m.kind === "remote") return "remote";
  if (m.kind === "stage") return "stage";
  if (m.kind === "sleep" || m.group === "sleep") {
    return iconForCategory(m.category, "sleep");
  }
  if (m.status === "rejected") return iconForCategory(m.category, m.group);
  return iconForCategory(m.category, m.group);
}

export function iconForQuickAction(
  id: "water" | "food" | "fuel" | "h24" | "bike" | "sleep" | "pharmacy" | "verified",
): PlanIconId {
  switch (id) {
    case "water":
      return "waterFountain";
    case "food":
      return "supermarket";
    case "fuel":
      return "gasStation";
    case "h24":
      return "shop24h";
    case "bike":
      return "bikeShop";
    case "sleep":
      return "sleepSpot";
    case "pharmacy":
      return "pharmacy";
    case "verified":
      return "verified";
  }
}
