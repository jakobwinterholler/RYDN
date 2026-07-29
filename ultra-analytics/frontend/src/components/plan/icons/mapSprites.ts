/** Canvas sprite factory for MapLibre symbol layers. */

import type { Map as MapLibreMap } from "maplibre-gl";
import { PLAN_ICON_PATHS } from "./glyphs";
import type { PlanIconId } from "./types";

const INK = "#1a1a18";
const PAPER = "#f7f6f3";
const SAGE = "#2f5d50";
const REJECT = "#9a3412";
const MUTED = "#8a8a82";

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
) {
  const paths = PLAN_ICON_PATHS[iconId] || PLAN_ICON_PATHS.pin;
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
    ctx.stroke(p);
  }
  ctx.restore();
}

export type MarkerSpriteKind = "base" | "selected" | "verified" | "rejected" | "disabled" | "loading";

function spriteKey(iconId: PlanIconId, kind: MarkerSpriteKind): string {
  return `rydn-${iconId}-${kind}`;
}

function renderSprite(iconId: PlanIconId, kind: MarkerSpriteKind): ImageData {
  const size = kind === "selected" ? 56 : 48;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const cx = size / 2;
  const cy = size / 2;
  const r = kind === "selected" ? 18 : 15;

  const tone = toneForIcon(iconId);
  const fill = TONE_FILL[tone];
  const dim = kind === "disabled" || kind === "rejected";
  const opacity = dim ? 0.42 : kind === "loading" ? 0.55 : 1;

  ctx.globalAlpha = opacity;

  // Soft disc
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  if (kind === "verified") {
    ctx.fillStyle = SAGE;
  } else if (kind === "rejected") {
    ctx.fillStyle = REJECT;
  } else if (kind === "selected") {
    ctx.fillStyle = INK;
  } else {
    ctx.fillStyle = PAPER;
  }
  ctx.fill();

  ctx.lineWidth = kind === "selected" ? 2.5 : 1.5;
  ctx.strokeStyle = kind === "verified" || kind === "selected" ? PAPER : fill;
  if (kind !== "verified" && kind !== "selected" && kind !== "rejected") {
    ctx.strokeStyle = fill;
  }
  if (kind === "rejected") ctx.strokeStyle = PAPER;
  ctx.stroke();

  const glyphColor =
    kind === "verified" || kind === "selected" || kind === "rejected" ? PAPER : fill;
  drawGlyph(ctx, iconId, cx, cy, 0.55, glyphColor, 1.7);

  // Verified check badge
  if (kind === "verified") {
    ctx.globalAlpha = 1;
    const bx = cx + r * 0.62;
    const by = cy + r * 0.62;
    ctx.beginPath();
    ctx.arc(bx, by, 6.5, 0, Math.PI * 2);
    ctx.fillStyle = PAPER;
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = SAGE;
    ctx.stroke();
    ctx.strokeStyle = SAGE;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(bx - 3, by);
    ctx.lineTo(bx - 0.5, by + 2.5);
    ctx.lineTo(bx + 3.5, by - 2.5);
    ctx.stroke();
  }

  // Loading ring
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
  ctx.beginPath();
  ctx.arc(cx, cy, 18, 0, Math.PI * 2);
  ctx.fillStyle = INK;
  ctx.globalAlpha = 0.88;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 2;
  ctx.strokeStyle = PAPER;
  ctx.stroke();
  return ctx.getImageData(0, 0, size, size);
}

const ALL_ICONS = Object.keys(PLAN_ICON_PATHS) as PlanIconId[];
const KINDS: MarkerSpriteKind[] = ["base", "selected", "verified", "rejected", "disabled", "loading"];

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
  },
): string {
  if (opts.loading) return spriteKey(iconId, "loading");
  if (opts.disabled) return spriteKey(iconId, "disabled");
  if (opts.selected) return spriteKey(iconId, "selected");
  if (opts.verified) return spriteKey(iconId, "verified");
  if (opts.rejected) return spriteKey(iconId, "rejected");
  return spriteKey(iconId, "base");
}

export { spriteKey, toneForIcon };
