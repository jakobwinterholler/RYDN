/** Canvas sprite factory for MapLibre — RYDN premium POI markers (no emoji). */

import type { Map as MapLibreMap } from "maplibre-gl";
import { PLAN_ICON_MODE, PLAN_ICON_PATHS } from "./glyphs";
import type { PlanIconId } from "./types";

/** Bright face for outdoor sun readability (not pale-on-map). */
const PAPER = "#ffffff";
const PAPER_SOFT = "#f4f3ef";
const INK = "#141412";
const SAGE = "#2f5d50";
const CHECK = "#2f5d50";

/**
 * Stronger category rings — edge against map tiles in bright sun.
 */
export type SpriteTone = "ink" | "sage" | "reject" | "muted" | "water" | "fuel" | "sleep";

const TONE_RING: Record<SpriteTone, string> = {
  ink: "#2e2e2a",
  sage: SAGE,
  reject: "#8f3d3d",
  muted: "#7a7a72",
  water: "#3d6a7c",
  fuel: "#7a6240",
  sleep: "#4f4a58",
};

/** Quiet category wash on bright white — still readable outdoors. */
const TONE_WASH: Record<SpriteTone, string> = {
  ink: "#f2f1ec",
  sage: "#e8f0ec",
  reject: "#f3e8e8",
  muted: "#efeee9",
  water: "#e6eef2",
  fuel: "#f1ebe3",
  sleep: "#eceaf0",
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
  const mode = PLAN_ICON_MODE[iconId] || "stroke";
  ctx.save();
  ctx.translate(cx - 12 * scale, cy - 12 * scale);
  ctx.scale(scale, scale);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = weight;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const d of paths) {
    const p = new Path2D(d);
    if (mode === "solid") {
      // evenodd — bag handle hole / compound silhouettes
      ctx.fill(p, "evenodd");
    } else {
      ctx.stroke(p);
    }
  }
  ctx.restore();
}

function drawVerifiedBadge(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const bx = cx + r * 0.74;
  const by = cy + r * 0.74;
  const br = Math.max(9, r * 0.28);
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(bx, by + 0.7, br + 0.5, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(20, 20, 18, 0.22)";
  ctx.fill();
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
  ctx.moveTo(bx - br * 0.42, by + 0.05);
  ctx.lineTo(bx - br * 0.06, by + br * 0.36);
  ctx.lineTo(bx + br * 0.46, by - br * 0.34);
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
 * Outdoor-first marker anatomy (logical ~60–70px @ pixelRatio 2):
 * soft shadow → bright face → dark rim → category ring → large ink glyph
 * Selected: ink face + paper glyph + sage focus ring
 * Emphasized: soft category outer ring (nearest)
 * Verified: sage ✓ badge — never emoji
 */
function renderSprite(iconId: PlanIconId, kind: MarkerSpriteKind): ImageData {
  const selected = kind === "selected" || kind === "selectedVerified";
  const emphasized = kind === "emphasized" || kind === "emphasizedVerified";
  // Larger canvas + disc than prior paper markers — glanceable in sun
  const size = selected ? 136 : emphasized ? 128 : 120;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const cx = size / 2;
  const cy = size / 2;
  const r = selected ? size * 0.36 : emphasized ? size * 0.345 : size * 0.335;

  const tone = toneForIcon(iconId);
  const ring = TONE_RING[tone];
  const dim = kind === "disabled" || kind === "rejected" || kind === "dimmed";
  const opacity = dim ? (kind === "dimmed" ? 0.4 : 0.45) : kind === "loading" ? 0.75 : 1;
  const hasBadge =
    kind === "verified" ||
    kind === "selectedVerified" ||
    kind === "emphasizedVerified";
  const solidGlyph = (PLAN_ICON_MODE[iconId] || "stroke") === "solid";

  ctx.clearRect(0, 0, size, size);
  ctx.globalAlpha = opacity;

  // Soft contact shadow — stronger lift against bright map
  ctx.beginPath();
  ctx.arc(cx, cy + 2.6, r + 1.6, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(20, 20, 18, 0.22)";
  ctx.fill();

  // Emphasized (nearest): category outer halo
  if (emphasized && !selected) {
    ctx.beginPath();
    ctx.arc(cx, cy, r + 6.5, 0, Math.PI * 2);
    ctx.strokeStyle = ring;
    ctx.lineWidth = 2.6;
    ctx.globalAlpha = opacity * 0.5;
    ctx.stroke();
    ctx.globalAlpha = opacity;
  }

  // Selected: sage focus ring + paper hairline
  if (selected) {
    ctx.beginPath();
    ctx.arc(cx, cy, r + 7.2, 0, Math.PI * 2);
    ctx.strokeStyle = SAGE;
    ctx.lineWidth = 3.4;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r + 7.2, 0, Math.PI * 2);
    ctx.strokeStyle = PAPER;
    ctx.lineWidth = 1.3;
    ctx.stroke();
  }

  // Face — bright white / light wash (high contrast vs map)
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  if (kind === "rejected") {
    ctx.fillStyle = TONE_WASH.reject;
  } else if (selected) {
    ctx.fillStyle = INK;
  } else if (dim) {
    ctx.fillStyle = PAPER_SOFT;
  } else {
    ctx.fillStyle = TONE_WASH[tone];
  }
  ctx.fill();

  // Dark outer rim (edge against map) + category ring
  if (!selected) {
    ctx.beginPath();
    ctx.arc(cx, cy, r - 0.5, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(20, 20, 18, 0.42)";
    ctx.lineWidth = 2.2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r - 3.2, 0, Math.PI * 2);
    ctx.strokeStyle = kind === "rejected" ? TONE_RING.reject : dim ? TONE_RING.muted : ring;
    ctx.lineWidth = emphasized ? 2.8 : 2.5;
    ctx.globalAlpha = opacity * (dim ? 0.75 : 1);
    ctx.stroke();
    ctx.globalAlpha = opacity;
  } else {
    ctx.beginPath();
    ctx.arc(cx, cy, r - 0.6, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
    ctx.lineWidth = 1.3;
    ctx.stroke();
  }

  const glyphColor = selected
    ? PAPER
    : kind === "rejected"
      ? TONE_RING.reject
      : dim
        ? TONE_RING.muted
        : INK;
  // Large glyph — fill most of the disc for outdoor glanceability
  const glyphScale = selected ? 1.52 : emphasized ? 1.46 : 1.44;
  const glyphWeight = solidGlyph ? (selected ? 1.5 : 1.4) : selected ? 2.2 : 2.1;
  drawGlyph(ctx, iconId, cx, cy, glyphScale, glyphColor, glyphWeight);

  if (hasBadge) {
    drawVerifiedBadge(ctx, cx, cy, r);
  }

  if (kind === "loading") {
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 5, -Math.PI / 2, 0.55);
    ctx.strokeStyle = selected ? PAPER : ring;
    ctx.lineWidth = 2.6;
    ctx.lineCap = "round";
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

/** Category-tinted cluster — bright face + strong ring + ink count. */
export function clusterSprite(tone: ClusterTone = "sage", countLabel = "2"): ImageData {
  const size = 104;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const cx = size / 2;
  const cy = size / 2;
  const big = countLabel === "10+" || countLabel === "25+";
  const r = big ? 27 : 24;
  const ring =
    tone === "mixed"
      ? "#3a4240"
      : tone === "water"
        ? TONE_RING.water
        : tone === "fuel"
          ? TONE_RING.fuel
          : tone === "sleep"
            ? TONE_RING.sleep
            : TONE_RING.sage;

  ctx.beginPath();
  ctx.arc(cx, cy + 1.8, r + 1.4, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(20, 20, 18, 0.2)";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = PAPER;
  ctx.fill();
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = "rgba(20, 20, 18, 0.4)";
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r - 2.4, 0, Math.PI * 2);
  ctx.lineWidth = 2.8;
  ctx.strokeStyle = ring;
  ctx.stroke();

  const label = countLabel;
  ctx.font = `700 ${big ? 17 : 18}px "IBM Plex Sans", system-ui, -apple-system, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = INK;
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

/** Subtle chevron for route direction (MapLibre symbol-placement: line). */
function routeChevronSprite(): ImageData {
  const s = 48;
  const canvas = document.createElement("canvas");
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new ImageData(s, s);
  ctx.clearRect(0, 0, s, s);
  // Soft paper halo so the mark reads on dark/light tiles without shouting.
  ctx.strokeStyle = "rgba(247, 246, 243, 0.92)";
  ctx.lineWidth = 5.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(s * 0.34, s * 0.26);
  ctx.lineTo(s * 0.66, s * 0.5);
  ctx.lineTo(s * 0.34, s * 0.74);
  ctx.stroke();
  ctx.strokeStyle = "rgba(26, 26, 24, 0.62)";
  ctx.lineWidth = 3.1;
  ctx.beginPath();
  ctx.moveTo(s * 0.34, s * 0.26);
  ctx.lineTo(s * 0.66, s * 0.5);
  ctx.lineTo(s * 0.34, s * 0.74);
  ctx.stroke();
  return ctx.getImageData(0, 0, s, s);
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
  upsertImage(map, "rydn-route-chevron", routeChevronSprite());
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
