/**
 * RYDN certificate basemap theme — restyle OpenFreeMap Liberty toward the
 * printed-atlas palette (paper land, quiet water) without Positron gray-blue.
 */

import type { Map as MapLibreMap } from "maplibre-gl";

/** Match RoutePreview atlas plate. */
export const RYDN_LAND = "#f4f1ea";
export const RYDN_SEA = "#e4e7e4";
/** Cool lake fill — readable on paper land, not Positron electric blue. */
export const RYDN_WATER = "#b7c8ce";
export const RYDN_WATERWAY = "#9fb3bb";
export const RYDN_BORDER = "#8a8378";
export const RYDN_INK = "#1a1a18";
export const RYDN_LABEL = "#5c574e";
export const RYDN_ROAD = "#ebe6dc";
export const RYDN_ROAD_CASING = "#d2ccc0";
export const RYDN_ROAD_MAJOR = "#e3ddd2";
export const RYDN_WOOD = "hsla(95, 18%, 72%, 0.45)";
export const RYDN_GRASS = "hsla(88, 22%, 78%, 0.4)";
export const RYDN_PARK = "hsla(92, 20%, 76%, 0.35)";

const HIDDEN_LAYERS = [
  "road_one_way_arrow",
  "road_one_way_arrow_opposite",
  "highway-shield-non-us",
  "highway-shield-us-interstate",
  "road_shield_us",
  "building",
  "building-top",
];

function setPaint(map: MapLibreMap, layerId: string, prop: string, value: unknown): void {
  if (!map.getLayer(layerId)) return;
  try {
    map.setPaintProperty(layerId, prop, value as never);
  } catch {
    /* layer/prop mismatch across style versions */
  }
}

function setLayout(map: MapLibreMap, layerId: string, prop: string, value: unknown): void {
  if (!map.getLayer(layerId)) return;
  try {
    map.setLayoutProperty(layerId, prop, value as never);
  } catch {
    /* ignore */
  }
}

/** Mute Liberty into a warm printed map — lakes/roads/places stay readable. */
export function applyRydnBasemapTheme(map: MapLibreMap): void {
  setPaint(map, "background", "background-color", RYDN_LAND);
  setPaint(map, "natural_earth", "raster-opacity", [
    "interpolate",
    ["exponential", 1.5],
    ["zoom"],
    0,
    0.22,
    5,
    0.1,
    7,
    0.04,
  ]);

  setPaint(map, "water", "fill-color", RYDN_WATER);
  setPaint(map, "waterway_river", "line-color", RYDN_WATERWAY);
  setPaint(map, "waterway_other", "line-color", RYDN_WATERWAY);
  setPaint(map, "waterway_tunnel", "line-color", RYDN_WATERWAY);

  setPaint(map, "landcover_wood", "fill-color", RYDN_WOOD);
  setPaint(map, "landcover_grass", "fill-color", RYDN_GRASS);
  setPaint(map, "park", "fill-color", RYDN_PARK);
  setPaint(map, "park_outline", "line-color", "hsla(92, 16%, 70%, 0.35)");
  setPaint(map, "landuse_residential", "fill-color", "hsla(40, 22%, 90%, 0.35)");
  setPaint(map, "landcover_sand", "fill-color", "hsla(42, 28%, 88%, 0.55)");
  setPaint(map, "landcover_ice", "fill-color", "hsla(190, 12%, 90%, 0.7)");
  setPaint(map, "landuse_cemetery", "fill-color", "hsla(90, 12%, 82%, 0.45)");
  setPaint(map, "landuse_hospital", "fill-color", "hsla(40, 20%, 90%, 0.4)");
  setPaint(map, "landuse_school", "fill-color", "hsla(48, 22%, 88%, 0.4)");
  setPaint(map, "landuse_pitch", "fill-color", RYDN_GRASS);
  setPaint(map, "landuse_track", "fill-color", RYDN_GRASS);

  // Roads: soft warm gray — no Liberty orange motorway shout.
  const roadFill = [
    "road_motorway",
    "road_motorway_link",
    "road_trunk_primary",
    "road_secondary_tertiary",
    "road_link",
    "road_minor",
    "road_service_track",
  ];
  const roadCasing = [
    "road_motorway_casing",
    "road_motorway_link_casing",
    "road_trunk_primary_casing",
    "road_secondary_tertiary_casing",
    "road_link_casing",
    "road_minor_casing",
    "road_service_track_casing",
  ];
  for (const id of roadFill) {
    const major = id.includes("motorway") || id.includes("trunk") || id.includes("primary");
    setPaint(map, id, "line-color", major ? RYDN_ROAD_MAJOR : RYDN_ROAD);
  }
  for (const id of roadCasing) {
    setPaint(map, id, "line-color", RYDN_ROAD_CASING);
  }
  setPaint(map, "road_path_pedestrian", "line-color", "hsla(40, 10%, 78%, 0.55)");
  setPaint(map, "road_major_rail", "line-color", "hsla(40, 8%, 72%, 0.55)");
  setPaint(map, "road_major_rail_hatching", "line-color", "hsla(40, 8%, 72%, 0.4)");
  setPaint(map, "road_transit_rail", "line-color", "hsla(40, 8%, 72%, 0.45)");
  setPaint(map, "road_transit_rail_hatching", "line-color", "hsla(40, 8%, 72%, 0.35)");

  setPaint(map, "boundary_2", "line-color", RYDN_BORDER);
  setPaint(map, "boundary_2", "line-opacity", 0.55);
  setPaint(map, "boundary_3", "line-color", RYDN_BORDER);
  setPaint(map, "boundary_3", "line-opacity", 0.28);
  setPaint(map, "boundary_disputed", "line-color", RYDN_BORDER);

  const labelHalo = RYDN_LAND;
  for (const id of [
    "label_city",
    "label_city_capital",
    "label_town",
    "label_village",
    "label_state",
    "label_country_1",
    "label_country_2",
    "label_country_3",
  ]) {
    setPaint(map, id, "text-color", RYDN_LABEL);
    setPaint(map, id, "text-halo-color", labelHalo);
    setPaint(map, id, "text-halo-width", 1.2);
  }
  setPaint(map, "water_name_point_label", "text-color", "#6a7a82");
  setPaint(map, "water_name_point_label", "text-halo-color", labelHalo);
  setPaint(map, "water_name_line_label", "text-color", "#6a7a82");
  setPaint(map, "water_name_line_label", "text-halo-color", labelHalo);
  setPaint(map, "waterway_line_label", "text-color", "#7a8a90");
  setPaint(map, "waterway_line_label", "text-halo-color", labelHalo);
  setPaint(map, "highway-name-major", "text-color", "#8a8378");
  setPaint(map, "highway-name-minor", "text-color", "#9a948a");
  setPaint(map, "highway-name-path", "text-color", "#a39c90");
  setPaint(map, "highway-name-major", "text-halo-color", labelHalo);
  setPaint(map, "highway-name-minor", "text-halo-color", labelHalo);
  setPaint(map, "highway-name-path", "text-halo-color", labelHalo);

  for (const id of HIDDEN_LAYERS) {
    setLayout(map, id, "visibility", "none");
  }
}
