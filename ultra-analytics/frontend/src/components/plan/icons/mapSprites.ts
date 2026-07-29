/** Canvas sprite factory for MapLibre symbol layers — RYDN icon family. */

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
  const bx = cx + r * 0.72;
  const by = cy + r * 0.72;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(bx, by, 6.2, 0, Math.PI * 2);
  ctx.fillStyle = CHECK;
  ctx.fill();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = PAPER;
  ctx.stroke();
  ctx.strokeStyle = PAPER;
  ctx.lineWidth = 1.8;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(bx - 2.8, by + 0.15);
  ctx.lineTo(bx - 0.5, by + 2.4);
  ctx.lineTo(bx + 3.2, by - 2.2);
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

function renderSprite(iconId: PlanIconId, kind: MarkerSpriteKind): ImageData {
  const big =
    kind === "selected" ||
    kind === "selectedVerified" ||
    kind === "emphasized" ||
    kind === "emphasizedVerified";
  // Render at 2× for crisp retina; MapLibre pixelRatio: 2 → logical 32/28px
  const size = big ? 64 : 56;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const cx = size / 2;
  const cy = size / 2;
  const r =
    kind === "selected" || kind === "selectedVerified"
      ? size * 0.36
      : kind === "emphasized" || kind === "emphasizedVerified"
        ? size * 0.34
        : size * 0.32;

  const tone = toneForIcon(iconId);
  const fill = TONE_FILL[tone];
  const dim = kind === "disabled" || kind === "rejected" || kind === "dimmed";
  const opacity = dim ? (kind === "dimmed" ? 0.4 : 0.45) : kind === "loading" ? 0.7 : 1;
  const hasBadge =
    kind === "verified" ||
    kind === "selectedVerified" ||
    kind === "emphasizedVerified";
  const selected = kind === "selected" || kind === "selectedVerified";

  ctx.clearRect(0, 0, size, size);
  ctx.globalAlpha = opacity;

  // Soft shadow so icons lift off the basemap
  ctx.beginPath();
  ctx.arc(cx, cy + 1.2, r + 0.5, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(26, 26, 24, 0.18)";
  ctx.fill();

  // Solid category disc — never paper-grey (that looked like empty placeholders)
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

  ctx.lineWidth = selected || kind.startsWith("emphasized") ? 2.4 : 1.8;
  ctx.strokeStyle = PAPER;
  ctx.stroke();

  // White glyph on colored disc
  const glyphColor = PAPER;
  drawGlyph(ctx, iconId, cx, cy, big ? 0.72 : 0.64, glyphColor, big ? 2.1 : 1.9);

  // Verified: small green check on the category icon — not a separate map layer
  if (hasBadge) {
    drawVerifiedBadge(ctx, cx, cy, r);
  }

  if (kind === "loading") {
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 3.5, -Math.PI / 2, 0.55);
    ctx.strokeStyle = PAPER;
    ctx.lineWidth = 2.4;
    ctx.stroke();
  }

  return ctx.getImageData(0, 0, size, size);
}

export function clusterSprite(): ImageData {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const cx = size / 2;
  const cy = size / 2;
  ctx.beginPath();
  ctx.arc(cx, cy + 1, 18, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(26, 26, 24, 0.16)";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, 17, 0, Math.PI * 2);
  ctx.fillStyle = TONE_FILL.sage;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = PAPER;
  ctx.stroke();
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

/** Register all RYDN marker sprites on a MapLibre map (idempotent). */
export function ensurePlanSprites(map: MapLibreMap): void {
  for (const iconId of ALL_ICONS) {
    for (const kind of KINDS) {
      const id = spriteKey(iconId, kind);
      const data = renderSprite(iconId, kind);
      if (map.hasImage(id)) {
        try {
          map.updateImage(id, data);
        } catch {
          /* style race */
        }
        continue;
      }
      map.addImage(id, data, { pixelRatio: 2 });
    }
  }
  if (!map.hasImage("rydn-cluster")) {
    map.addImage("rydn-cluster", clusterSprite(), { pixelRatio: 2 });
  } else {
    try {
      map.updateImage("rydn-cluster", clusterSprite());
    } catch {
      /* ignore */
    }
  }
}

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
