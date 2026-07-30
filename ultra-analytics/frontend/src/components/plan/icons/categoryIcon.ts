/** Map category / group / kind → RYDN plan icon. */

import type { PlanMarker } from "../planLayers";
import type { PlanIconId } from "./types";

export function iconForCategory(category?: string | null, group?: string | null): PlanIconId {
  const cat = (category || "").toLowerCase();
  const grp = (group || "").toLowerCase();

  if (cat.includes("fountain") || cat.includes("drinking")) return "waterFountain";
  if (cat.includes("natural") || cat.includes("spring") || cat.includes("stream")) return "naturalWater";
  if (grp === "water" || cat.includes("water")) return "waterFountain";

  if (cat.includes("24h shop") || (cat.includes("24") && cat.includes("shop"))) return "supermarket";
  if (cat.includes("convenience") || cat.includes("bakery")) return "supermarket";
  if (cat.includes("supermarket") || cat.includes("grocery") || cat.includes("market")) return "supermarket";
  if (cat.includes("fuel shop") || ((cat.includes("gas") || cat.includes("fuel")) && !cat.includes("bike")))
    return "supermarket";
  if (cat.includes("bike") || cat.includes("bicycle")) return "bikeShop";
  if (cat.includes("mechanic") || cat.includes("repair")) return "mechanic";
  if (cat.includes("pharmacy") || cat.includes("chemist")) return "pharmacy";
  if (cat.includes("café") || cat.includes("cafe") || cat.includes("coffee")) return "cafe";
  if (cat.includes("restaurant") || cat.includes("fast food")) return "restaurant";
  if (cat.includes("hotel") || cat.includes("hostel") || cat.includes("motel") || cat.includes("guest house") || cat.includes("guesthouse"))
    return "sleepSpot";
  if (cat.includes("camp") || cat.includes("camping")) return "camping";
  if (cat.includes("shelter") || cat.includes("hut") || cat.includes("refuge")) return "shelter";
  if (cat.includes("train") || cat.includes("station") || cat.includes("rail")) return "trainStation";
  if (cat.includes("hospital") || cat.includes("clinic")) return "hospital";
  if (cat.includes("atm") || cat.includes("bank")) return "atm";
  if (cat.includes("toilet") || cat.includes("restroom") || cat.includes("wc")) return "toilet";

  if (grp === "sleep") return "sleepSpot";
  if (grp === "resupply") return "supermarket";
  if (grp === "dining") return "restaurant";
  if (grp === "service") return "mechanic";
  if (grp === "emergency") return "emergency";

  // Prefer a family glyph over a generic GIS pin
  return "supermarket";
}

export function iconForMarker(m: PlanMarker): PlanIconId {
  if (m.kind === "climb" || m.kind === "decision") return "climb";
  if (m.kind === "remote") return "remote";
  if (m.kind === "stage") return "stage";
  // Sleep QA always uses the bed emoji sprite — category subtypes stay in the sheet.
  if (m.kind === "sleep" || m.group === "sleep") return "sleepSpot";
  if (m.status === "rejected") return iconForCategory(m.category, m.group);
  return iconForCategory(m.category, m.group);
}

export function iconForQuickAction(
  id: "water" | "food" | "sleep",
): PlanIconId {
  switch (id) {
    case "water":
      return "waterFountain";
    case "food":
      return "supermarket";
    case "sleep":
      return "sleepSpot";
  }
}
