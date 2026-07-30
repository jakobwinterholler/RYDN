/** Canvas sprite factory for MapLibre symbol layers — RYDN glanceable collectibles. */

import type { Map as MapLibreMap } from "maplibre-gl";
import { PLAN_ICON_PATHS } from "./glyphs";
import type { PlanIconId } from "./types";

const PAPER = "#f7f6f3";
const INK = "#1a1a18";
const CHECK = "#1f7a4c";

export type SpriteTone = "ink" | "sage" | "reject" | "muted" | "water" | "fuel" | "sleep";

/** Solid category fills — never paper-grey discs (those read as placeholders). */
const TONE_FILL: Record<SpriteTone, string> = {
  ink: "#2a2a28",
  sage: "#2f5d50",
  reject: "#9a3412",
  muted: "#6b6b64",
  water: "#2f6fad",
  fuel: "#8a6428",
  sleep: "#5c4a6e",
};

function toneForIcon(id: PlanIconId): SpriteTone {
  if (id === "waterFountain" || id === "naturalWater") return "water";
  if (id === "gasStation" || id === "shop24h") return "fuel";
  if (id === "sleepSpot" || id === "hotel" || id === "camping" || id === "shelter") return "sleep";
  if (id === "verified" || id === "climb" || id === "supermarket" || id === "resupply") return "sage";
  if (id === "rejected" || id === "remote" || id === "emergency") return "reject";
  return "ink";
}

function drawGlyph(
  ctx: CanvasRenderingContext2D,
  iconId: PlanIconId,
  cx: number,
  cy: number,
  scale: number,
  color: string,
  weight: number,
) {
  const paths = PLAN_ICON_PATHS[iconId] || PLAN_ICON_PATHS.resupply;
  ctx.save();
  ctx.translate(cx - 12 * scale, cy - 12 * scale);
  ctx.scale(scale, scale);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = weight;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // 2-value art: filled silhouette + thick outline for sunlight
  const fillIds: PlanIconId[] = [
    "waterFountain",
    "pharmacy",
    "verified",
    "supermarket",
    "shop24h",
    "resupply",
    "sleepSpot",
    "camping",
    "climb",
  ];
  const doFill = fillIds.includes(iconId);
  for (const d of paths) {
    const p = new Path2D(d);
    if (doFill) ctx.fill(p);
    ctx.stroke(p);
  }
  ctx.restore();
}

function drawVerifiedBadge(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const bx = cx + r * 0.68;
  const by = cy + r * 0.68;
  const br = Math.max(8, r * 0.28);
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(bx, by, br, 0, Math.PI * 2);
  ctx.fillStyle = CHECK;
  ctx.fill();
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = PAPER;
  ctx.stroke();
  ctx.strokeStyle = PAPER;
  ctx.lineWidth = Math.max(2.2, br * 0.28);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(bx - br * 0.45, by + 0.1);
  ctx.lineTo(bx - br * 0.08, by + br * 0.38);
  ctx.lineTo(bx + br * 0.48, by - br * 0.35);
  ctx.stroke();
  ctx.restore();
}

export type MarkerSpriteKind =
  | "base"
  | "selected"
  | "verified"
  | "selectedVerified"
  | "emphasized"
  | "emphasizedVerified"
  | "dimmed"
  | "rejected"
  | "disabled"
  | "loading";

function spriteKey(iconId: PlanIconId, kind: MarkerSpriteKind): string {
  return `rydn-${iconId}-${kind}`;
}

/**
 * Large glanceable collectibles.
 * Rendered at 2× (pixelRatio: 2) → logical ~48–56px before MapLibre icon-size.
 */
function renderSprite(iconId: PlanIconId, kind: MarkerSpriteKind): ImageData {
  const selected = kind === "selected" || kind === "selectedVerified";
  const emphasized =
    kind === "emphasized" || kind === "emphasizedVerified";
  // Significantly larger than prior 56/64 canvases
  const size = selected ? 112 : emphasized ? 104 : 96;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const cx = size / 2;
  const cy = size / 2;
  const r = selected ? size * 0.34 : emphasized ? size * 0.32 : size * 0.3;

  const tone = toneForIcon(iconId);
  const fill = TONE_FILL[tone];
  const dim = kind === "disabled" || kind === "rejected" || kind === "dimmed";
  const opacity = dim ? (kind === "dimmed" ? 0.4 : 0.45) : kind === "loading" ? 0.7 : 1;
  const hasBadge =
    kind === "verified" ||
    kind === "selectedVerified" ||
    kind === "emphasizedVerified";

  ctx.clearRect(0, 0, size, size);
  ctx.globalAlpha = opacity;

  // Soft shadow — lift off basemap
  ctx.beginPath();
  ctx.arc(cx, cy + 2, r + 1, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(26, 26, 24, 0.22)";
  ctx.fill();

  // Recommended: subtle category ring (not bounce/flash)
  if (emphasized && !selected) {
    ctx.beginPath();
    ctx.arc(cx, cy, r + 5.5, 0, Math.PI * 2);
    ctx.strokeStyle = fill;
    ctx.lineWidth = 3.2;
    ctx.globalAlpha = opacity * 0.85;
    ctx.stroke();
    ctx.globalAlpha = opacity;
  }

  // Selected: larger disc + highlight ring
  if (selected) {
    ctx.beginPath();
    ctx.arc(cx, cy, r + 6.5, 0, Math.PI * 2);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r + 6.5, 0, Math.PI * 2);
    ctx.strokeStyle = PAPER;
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }

  // Solid category disc
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  if (kind === "rejected") {
    ctx.fillStyle = TONE_FILL.reject;
  } else if (selected) {
    ctx.fillStyle = INK;
  } else if (dim) {
    ctx.fillStyle = TONE_FILL.muted;
  } else {
    ctx.fillStyle = fill;
  }
  ctx.fill();

  // Thick paper outline — sunlight / 2-value
  ctx.lineWidth = selected || emphasized ? 3.4 : 3;
  ctx.strokeStyle = PAPER;
  ctx.stroke();

  // White glyph — bold silhouette
  const glyphScale = selected ? 0.92 : emphasized ? 0.86 : 0.8;
  const glyphWeight = selected ? 2.6 : 2.4;
  drawGlyph(ctx, iconId, cx, cy, glyphScale, PAPER, glyphWeight);

  // Verified: small ✓ corner badge on category icon — never a separate icon
  if (hasBadge) {
    drawVerifiedBadge(ctx, cx, cy, r);
  }

  if (kind === "loading") {
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 5, -Math.PI / 2, 0.55);
    ctx.strokeStyle = PAPER;
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  return ctx.getImageData(0, 0, size, size);
}

export type ClusterTone = "water" | "sage" | "fuel" | "sleep" | "mixed";

const CLUSTER_TONES: ClusterTone[] = ["water", "sage", "fuel", "sleep", "mixed"];

/** Bucketed count labels baked into sprites (no map font dependency). */
const CLUSTER_COUNT_LABELS = ["2", "3", "4", "5", "6", "7", "8", "9", "10+", "25+"] as const;

function clusterCountLabel(n: number): (typeof CLUSTER_COUNT_LABELS)[number] {
  if (n >= 25) return "25+";
  if (n >= 10) return "10+";
  if (n <= 2) return "2";
  if (n >= 9) return "9";
  return String(n) as (typeof CLUSTER_COUNT_LABELS)[number];
}

export function clusterSpriteId(tone: ClusterTone, count: number): string {
  return `rydn-cluster-${tone}-${clusterCountLabel(count)}`;
}

/** Category-tinted cluster pill with count — never empty grey discs. */
export function clusterSprite(tone: ClusterTone = "sage", countLabel = "2"): ImageData {
  const size = 88;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const cx = size / 2;
  const cy = size / 2;
  const big = countLabel === "10+" || countLabel === "25+";
  const r = big ? 24 : 21;
  const fill =
    tone === "mixed"
      ? "#3a4a42"
      : tone === "water"
        ? TONE_FILL.water
        : tone === "fuel"
          ? TONE_FILL.fuel
          : tone === "sleep"
            ? TONE_FILL.sleep
            : TONE_FILL.sage;

  ctx.beginPath();
  ctx.arc(cx, cy + 1.5, r + 1.2, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(26, 26, 24, 0.2)";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = PAPER;
  ctx.stroke();

  const label = countLabel;
  ctx.font = `bold ${big ? 17 : 18}px system-ui, -apple-system, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = PAPER;
  ctx.fillText(label, cx, cy + 0.5);

  return ctx.getImageData(0, 0, size, size);
}

const ALL_ICONS = Object.keys(PLAN_ICON_PATHS) as PlanIconId[];
const KINDS: MarkerSpriteKind[] = [
  "base",
  "selected",
  "verified",
  "selectedVerified",
  "emphasized",
  "emphasizedVerified",
  "dimmed",
  "rejected",
  "disabled",
  "loading",
];

function upsertImage(map: MapLibreMap, id: string, data: ImageData): void {
  if (map.hasImage(id)) {
    try {
      map.updateImage(id, data);
    } catch {
      /* style race */
    }
    return;
  }
  map.addImage(id, data, { pixelRatio: 2 });
}

/** Register all RYDN marker + cluster sprites on a MapLibre map (idempotent). */
export function ensurePlanSprites(map: MapLibreMap): void {
  for (const iconId of ALL_ICONS) {
    for (const kind of KINDS) {
      upsertImage(map, spriteKey(iconId, kind), renderSprite(iconId, kind));
    }
  }
  for (const tone of CLUSTER_TONES) {
    for (const label of CLUSTER_COUNT_LABELS) {
      upsertImage(map, `rydn-cluster-${tone}-${label}`, clusterSprite(tone, label));
    }
  }
  // Legacy id kept for safety
  upsertImage(map, "rydn-cluster", clusterSprite("sage", "2"));
}

export { CLUSTER_TONES, clusterCountLabel };

export function markerImageId(
  iconId: PlanIconId,
  opts: {
    selected?: boolean;
    verified?: boolean;
    rejected?: boolean;
    disabled?: boolean;
    loading?: boolean;
    emphasize?: boolean;
    dimmed?: boolean;
  },
): string {
  if (opts.loading) return spriteKey(iconId, "loading");
  if (opts.disabled) return spriteKey(iconId, "disabled");
  if (opts.rejected) return spriteKey(iconId, "rejected");
  if (opts.selected && opts.verified) return spriteKey(iconId, "selectedVerified");
  if (opts.selected) return spriteKey(iconId, "selected");
  if (opts.emphasize && opts.verified) return spriteKey(iconId, "emphasizedVerified");
  if (opts.emphasize) return spriteKey(iconId, "emphasized");
  if (opts.dimmed) return spriteKey(iconId, "dimmed");
  if (opts.verified) return spriteKey(iconId, "verified");
  return spriteKey(iconId, "base");
}

export { spriteKey, toneForIcon };
