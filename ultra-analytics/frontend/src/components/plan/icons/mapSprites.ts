/** Canvas sprite factory for MapLibre symbol layers — RYDN icon family. */

import type { Map as MapLibreMap } from "maplibre-gl";
import { PLAN_ICON_PATHS } from "./glyphs";
import type { PlanIconId } from "./types";

const INK = "#1a1a18";
const PAPER = "#f7f6f3";
const SAGE = "#2f5d50";
const REJECT = "#9a3412";
const MUTED = "#8a8a82";
const CHECK = "#1f7a4c";

export type SpriteTone = "ink" | "sage" | "reject" | "muted" | "water" | "fuel" | "sleep";

const TONE_FILL: Record<SpriteTone, string> = {
  ink: INK,
  sage: SAGE,
  reject: REJECT,
  muted: MUTED,
  water: "#3b6ea5",
  fuel: "#7a5a2a",
  sleep: "#5b4a3a",
};

function toneForIcon(id: PlanIconId): SpriteTone {
  if (id === "waterFountain" || id === "naturalWater") return "water";
  if (id === "gasStation") return "fuel";
  if (id === "sleepSpot" || id === "hotel" || id === "camping" || id === "shelter") return "sleep";
  if (id === "verified" || id === "climb") return "sage";
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
  fillClosed = false,
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
  for (const d of paths) {
    const p = new Path2D(d);
    if (fillClosed && (iconId === "waterFountain" || iconId === "pharmacy" || iconId === "verified")) {
      ctx.fill(p);
    }
    ctx.stroke(p);
  }
  ctx.restore();
}

function drawVerifiedBadge(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  const bx = cx + r * 0.68;
  const by = cy + r * 0.68;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(bx, by, 6.8, 0, Math.PI * 2);
  ctx.fillStyle = CHECK;
  ctx.fill();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = PAPER;
  ctx.stroke();
  ctx.strokeStyle = PAPER;
  ctx.lineWidth = 1.7;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(bx - 3.1, by + 0.2);
  ctx.lineTo(bx - 0.6, by + 2.6);
  ctx.lineTo(bx + 3.6, by - 2.4);
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
  const size = big ? 56 : 48;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const cx = size / 2;
  const cy = size / 2;
  const r =
    kind === "selected" || kind === "selectedVerified"
      ? 18
      : kind === "emphasized" || kind === "emphasizedVerified"
        ? 16.5
        : 14.5;

  const tone = toneForIcon(iconId);
  const fill = TONE_FILL[tone];
  const dim = kind === "disabled" || kind === "rejected" || kind === "dimmed";
  const opacity = dim ? (kind === "dimmed" ? 0.38 : 0.42) : kind === "loading" ? 0.55 : 1;
  const hasBadge =
    kind === "verified" ||
    kind === "selectedVerified" ||
    kind === "emphasizedVerified";
  const selected = kind === "selected" || kind === "selectedVerified";

  ctx.globalAlpha = opacity;

  // Soft disc — category family stays paper/ink; selected fills ink
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  if (kind === "rejected") {
    ctx.fillStyle = REJECT;
  } else if (selected) {
    ctx.fillStyle = INK;
  } else {
    ctx.fillStyle = PAPER;
  }
  ctx.fill();

  ctx.lineWidth = selected || kind.startsWith("emphasized") ? 2.2 : 1.5;
  if (kind === "rejected") {
    ctx.strokeStyle = PAPER;
  } else if (selected) {
    ctx.strokeStyle = PAPER;
  } else if (hasBadge) {
    ctx.strokeStyle = SAGE;
  } else {
    ctx.strokeStyle = fill;
  }
  ctx.stroke();

  const glyphColor = selected || kind === "rejected" ? PAPER : fill;
  drawGlyph(ctx, iconId, cx, cy, big ? 0.58 : 0.52, glyphColor, big ? 1.85 : 1.65);

  // Verified: small green check in the corner (does NOT replace the category glyph)
  if (hasBadge) {
    drawVerifiedBadge(ctx, cx, cy, r);
  }

  if (kind === "loading") {
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 3, -Math.PI / 2, 0.4);
    ctx.strokeStyle = SAGE;
    ctx.lineWidth = 2;
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
  // Soft disc — not a QGIS pin
  ctx.beginPath();
  ctx.arc(cx, cy, 17, 0, Math.PI * 2);
  ctx.fillStyle = PAPER;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.font = "600 16px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("·", cx, cy + 1);
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
      if (map.hasImage(id)) continue;
      const data = renderSprite(iconId, kind);
      map.addImage(id, data, { pixelRatio: 2 });
    }
  }
  if (!map.hasImage("rydn-cluster")) {
    map.addImage("rydn-cluster", clusterSprite(), { pixelRatio: 2 });
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
