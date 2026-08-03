/** 24×24 plan glyphs — open strokes + solid silhouettes for dock & map. */

import type { PlanIconId } from "./types";

/**
 * Draw mode for selected/filled + map sprites:
 * - solid: single closed silhouette (evenodd holes OK) — Water/Shop/Sleep
 * - stroke: open line language for secondary icons
 *
 * Primary dock icons (Water / Shops / Sleep) are solid so selected weight matches.
 */
export type PlanGlyphMode = "solid" | "stroke";

export const PLAN_ICON_MODE: Record<PlanIconId, PlanGlyphMode> = {
  waterFountain: "solid",
  naturalWater: "stroke",
  supermarket: "solid",
  shop24h: "solid",
  gasStation: "stroke",
  bikeShop: "stroke",
  mechanic: "stroke",
  pharmacy: "solid",
  cafe: "stroke",
  restaurant: "stroke",
  hotel: "stroke",
  camping: "stroke",
  shelter: "stroke",
  trainStation: "stroke",
  hospital: "stroke",
  atm: "stroke",
  verified: "solid",
  rejected: "stroke",
  sleepSpot: "solid",
  resupply: "stroke",
  emergency: "stroke",
  toilet: "stroke",
  climb: "solid",
  remote: "stroke",
  stage: "stroke",
  pin: "stroke",
};

/** Paths (viewBox 0 0 24 24). Bold, simple — outdoor glanceable at ~22–28px. */
export const PLAN_ICON_PATHS: Record<PlanIconId, string[]> = {
  /** Plump filled teardrop — clear solid silhouette when selected. */
  waterFountain: [
    "M12 2.1C7.4 6.15 5 9.55 5 12.55 5 16.9 8.35 20 12 20s7-3.1 7-7.45c0-3-2.4-6.4-7-10.45z",
  ],
  naturalWater: [
    "M4.5 14.5c1.8-1.2 3.2-1.2 5 0s3.2 1.2 5 0 3.2-1.2 5 0",
    "M4.5 18c1.8-1.2 3.2-1.2 5 0s3.2 1.2 5 0 3.2-1.2 5 0",
    "M12 4.5v6",
  ],
  /**
   * Shopping bag — one evenodd path (body + open handle).
   * Wide tote silhouette; handle hole reads at dock + map size.
   */
  supermarket: [
    "M5.3 8.3h13.4l-1.25 12.7a1.85 1.85 0 01-1.8 1.5H8.35a1.85 1.85 0 01-1.8-1.5L5.3 8.3zm3.55 0V5.85a3.15 3.15 0 016.3 0V8.3h-1.65V5.85a1.5 1.5 0 00-3 0V8.3H8.85z",
  ],
  /** Crescent moon — 24h */
  shop24h: [
    "M14.5 3.8a8 8 0 105.5 13.8A7 7 0 0114.5 3.8z",
  ],
  gasStation: [
    "M5.5 20.5V6.5a1 1 0 011-1h7a1 1 0 011 1v14",
    "M4.5 20.5h11",
    "M7.5 8.5h5v4h-5z",
    "M14.5 10.5h2.2a2 2 0 012 2V17a1.5 1.5 0 01-1.5 1.5",
  ],
  bikeShop: [
    "M6.5 16.5a2.8 2.8 0 100-5.6 2.8 2.8 0 000 5.6z",
    "M17.5 16.5a2.8 2.8 0 100-5.6 2.8 2.8 0 000 5.6z",
    "M9 13.8l2.2-5.3h3.6L17 13.8",
    "M11.2 8.5h3.2",
  ],
  mechanic: [
    "M14.5 5.5l4 4-2.2 2.2-4-4z",
    "M7.2 16.5L5.5 18.2",
    "M9.8 9.2l-4.6 4.6a2.2 2.2 0 003.1 3.1l4.6-4.6",
  ],
  pharmacy: [
    "M8.5 4.5h7v4h4v7h-4v4h-7v-4h-4v-7h4z",
  ],
  cafe: [
    "M6.5 9.5h9.5v5.2a3.5 3.5 0 01-3.5 3.5H10a3.5 3.5 0 01-3.5-3.5V9.5z",
    "M16 10.5h1.8a2.2 2.2 0 010 4.4H16",
    "M8 20.5h8",
    "M9.5 4.5c0 1.2.8 1.8.8 2.8M12 4.5c0 1.2.8 1.8.8 2.8",
  ],
  restaurant: [
    "M7 4.5v7a2 2 0 002 2v6.5",
    "M7 7.5h4",
    "M15 4.5v15.5",
    "M15 4.5c2.2 0 3.5 1.8 3.5 4.2S17.2 12.5 15 12.5",
  ],
  hotel: [
    "M4 19.5V6.5a1 1 0 011-1h8a1 1 0 011 1v13",
    "M14 10.5h4.5a1 1 0 011 1v8",
    "M3 19.5h18",
    "M7.5 9v.01M10.5 9v.01M7.5 12.5v.01M10.5 12.5v.01",
  ],
  camping: [
    "M3.5 18.5L12 4.5l8.5 14H3.5z",
    "M12 4.5v14",
  ],
  shelter: [
    "M3.5 11.5L12 4.5l8.5 7",
    "M6 10.5v9h12v-9",
    "M10 19.5v-5h4v5",
  ],
  trainStation: [
    "M7 4.5h10a2 2 0 012 2v10.5H5V6.5a2 2 0 012-2z",
    "M5 17l-1.5 2.5M19 17l1.5 2.5",
    "M8.5 14.5h.01M15.5 14.5h.01",
    "M8 8.5h8v4H8z",
  ],
  hospital: [
    "M6 4.5h12v15H6z",
    "M12 8.5v7M8.5 12h7",
  ],
  atm: [
    "M5.5 6.5h13v11h-13z",
    "M8 10.5h8",
    "M9.5 14h5",
  ],
  verified: [
    "M12 3.5l2.2 1.1 2.4-.2.9 2.2 2.2.9-.2 2.4 1.1 2.2-1.1 2.2.2 2.4-2.2.9-.9 2.2-2.4-.2L12 20.5l-2.2-1.1-2.4.2-.9-2.2-2.2-.9.2-2.4L3.5 12l1.1-2.2-.2-2.4 2.2-.9.9-2.2 2.4.2L12 3.5z",
    "M8.5 12.2l2.4 2.4 4.6-4.8",
  ],
  rejected: [
    "M12 3.5a8.5 8.5 0 100 17 8.5 8.5 0 000-17z",
    "M8.5 8.5l7 7M15.5 8.5l-7 7",
  ],
  /**
   * Classic bed — headboard | pillow | mattress (open gaps, aligned stack).
   * Single evenodd path like the tote; bold mass for outdoor dock/map size.
   */
  sleepSpot: [
    "M3.5 5h3.6v15H3.5zM9.2 8.7h11.3v3.5H9.2zM9.2 13.6h12.3v6.4H9.2z",
  ],
  resupply: [
    "M5 8.5h14l-1.2 10.2a1.5 1.5 0 01-1.5 1.3H7.7a1.5 1.5 0 01-1.5-1.3L5 8.5z",
    "M12 11.5v5M9.5 14h5",
  ],
  emergency: [
    "M12 3.5L20.5 18H3.5L12 3.5z",
    "M12 10v4M12 16.5h.01",
  ],
  toilet: [
    "M8 5.5a2 2 0 104 0 2 2 0 00-4 0z",
    "M7 10.5h6v5.5H7z",
    "M9 16v3.5M11 16v3.5",
    "M15.5 8.5v11",
  ],
  climb: [
    "M3 18.5L10.2 6.2c.4-.7 1.4-.7 1.8 0L19.5 18.5H3z",
  ],
  remote: [
    "M12 4.5v3M12 16.5v3M4.5 12h3M16.5 12h3",
    "M7.2 7.2l2.1 2.1M14.7 14.7l2.1 2.1M16.8 7.2l-2.1 2.1M9.3 14.7l-2.1 2.1",
  ],
  stage: [
    "M6 3.5v17",
    "M6 4.5h9.5l-2 3.2 2 3.3H6",
  ],
  pin: [
    "M12 20.5s-6-5.4-6-10a6 6 0 1112 0c0 4.6-6 10-6 10z",
    "M12 10.5a2 2 0 100-4 2 2 0 000 4z",
  ],
};
