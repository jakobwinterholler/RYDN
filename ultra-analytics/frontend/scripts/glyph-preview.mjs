/**
 * Render Water / Shops / Sleep — dock selected + premium map markers.
 * Mirrors production glyphs.ts + mapSprites.ts for visual QA.
 * Usage: node scripts/glyph-preview.mjs
 */
import { chromium } from "playwright";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "test-results");
mkdirSync(outDir, { recursive: true });

const glyphsSrc = readFileSync(
  join(__dirname, "..", "src/components/plan/icons/glyphs.ts"),
  "utf8",
);
function extractPaths(id) {
  const re = new RegExp(`${id}:\\s*\\[([\\s\\S]*?)\\],`, "m");
  const m = glyphsSrc.match(re);
  if (!m) throw new Error(`paths for ${id} not found`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}
const PATHS = {
  waterFountain: extractPaths("waterFountain"),
  supermarket: extractPaths("supermarket"),
  sleepSpot: extractPaths("sleepSpot"),
};
const MODES = {
  waterFountain: "solid",
  supermarket: "solid",
  sleepSpot: "solid",
};

const html = `<!DOCTYPE html>
<html><body style="margin:0;background:#e8e6e0;font-family:system-ui,sans-serif">
<canvas id="c" width="960" height="520"></canvas>
<script>
const PATHS = ${JSON.stringify(PATHS)};
const MODES = ${JSON.stringify(MODES)};
const PAPER = "#ffffff";
const INK = "#141412";
const SAGE = "#2f5d50";
const RINGS = { waterFountain: "#3d6a7c", supermarket: "#2f5d50", sleepSpot: "#4f4a58" };
const WASH = { waterFountain: "#e6eef2", supermarket: "#e8f0ec", sleepSpot: "#eceaf0" };
const CHECK = "#2f5d50";

function drawGlyph(ctx, iconId, cx, cy, scale, color, weight) {
  const paths = PATHS[iconId];
  const mode = MODES[iconId];
  ctx.save();
  ctx.translate(cx - 12 * scale, cy - 12 * scale);
  ctx.scale(scale, scale);
  ctx.strokeStyle = color; ctx.fillStyle = color;
  ctx.lineWidth = weight; ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const d of paths) {
    const p = new Path2D(d);
    if (mode === "solid") ctx.fill(p, "evenodd"); else ctx.stroke(p);
  }
  ctx.restore();
}

function drawVerifiedBadge(ctx, cx, cy, r) {
  const bx = cx + r * 0.74, by = cy + r * 0.74, br = Math.max(9, r * 0.28);
  ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2);
  ctx.fillStyle = CHECK; ctx.fill();
  ctx.lineWidth = 2.2; ctx.strokeStyle = PAPER; ctx.stroke();
  ctx.strokeStyle = PAPER; ctx.lineWidth = Math.max(2.2, br * 0.28);
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(bx - br * 0.42, by + 0.05);
  ctx.lineTo(bx - br * 0.06, by + br * 0.36);
  ctx.lineTo(bx + br * 0.46, by - br * 0.34);
  ctx.stroke();
}

function renderMarker(iconId, kind, size) {
  const selected = kind === "selected" || kind === "selectedVerified";
  const emphasized = kind === "emphasized" || kind === "emphasizedVerified";
  const hasBadge = kind.includes("Verified") || kind === "verified";
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  const cx = size/2, cy = size/2;
  const r = selected ? size * 0.36 : emphasized ? size * 0.345 : size * 0.335;
  const ring = RINGS[iconId];
  const solid = MODES[iconId] === "solid";

  ctx.beginPath(); ctx.arc(cx, cy + 2.6, r + 1.6, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(20,20,18,0.22)"; ctx.fill();

  if (emphasized && !selected) {
    ctx.beginPath(); ctx.arc(cx, cy, r + 6.5, 0, Math.PI * 2);
    ctx.strokeStyle = ring; ctx.lineWidth = 2.6; ctx.globalAlpha = 0.5; ctx.stroke(); ctx.globalAlpha = 1;
  }
  if (selected) {
    ctx.beginPath(); ctx.arc(cx, cy, r + 7.2, 0, Math.PI * 2);
    ctx.strokeStyle = SAGE; ctx.lineWidth = 3.4; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, r + 7.2, 0, Math.PI * 2);
    ctx.strokeStyle = PAPER; ctx.lineWidth = 1.3; ctx.stroke();
  }

  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = selected ? INK : WASH[iconId]; ctx.fill();

  if (!selected) {
    ctx.beginPath(); ctx.arc(cx, cy, r - 0.5, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(20,20,18,0.42)"; ctx.lineWidth = 2.2; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, r - 3.2, 0, Math.PI * 2);
    ctx.strokeStyle = ring; ctx.lineWidth = emphasized ? 2.8 : 2.5; ctx.stroke();
  } else {
    ctx.beginPath(); ctx.arc(cx, cy, r - 0.6, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.22)"; ctx.lineWidth = 1.3; ctx.stroke();
  }

  const scale = selected ? 1.52 : 1.44;
  const weight = solid ? (selected ? 1.5 : 1.4) : (selected ? 2.2 : 2.1);
  drawGlyph(ctx, iconId, cx, cy, scale, selected ? PAPER : INK, weight);
  if (hasBadge) drawVerifiedBadge(ctx, cx, cy, r);
  return canvas;
}

function renderDockSelected(iconId, size) {
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  const pad = 8;
  ctx.fillStyle = "rgba(47,93,80,0.18)";
  ctx.beginPath();
  ctx.roundRect(pad, pad, size - pad*2, size - pad*2, 12);
  ctx.fill();
  ctx.strokeStyle = "rgba(47,93,80,0.22)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  const mode = MODES[iconId];
  const cx = size/2, cy = size/2;
  // Match dock ~24px glyph in 38px well
  const scale = (24 / 24) * ((size - pad * 2) / 38);
  ctx.save();
  ctx.translate(cx - 12 * scale, cy - 12 * scale);
  ctx.scale(scale, scale);
  ctx.fillStyle = SAGE; ctx.strokeStyle = SAGE;
  ctx.lineWidth = mode === "solid" ? 0 : 2.1; ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const d of PATHS[iconId]) {
    const p = new Path2D(d);
    if (mode === "solid") ctx.fill(p, "evenodd"); else ctx.stroke(p);
  }
  ctx.restore();
  return canvas;
}

const strip = document.getElementById("c");
const sctx = strip.getContext("2d");
sctx.fillStyle = "#e8e6e0"; sctx.fillRect(0,0,960,520);
sctx.fillStyle = INK; sctx.font = "650 14px system-ui"; sctx.fillText("Dock selected", 40, 28);
sctx.fillText("Map base", 40, 170);
sctx.fillText("Map selected", 40, 310);
sctx.fillText("Map verified / emphasized", 40, 450);

const ids = [["waterFountain","Water"],["supermarket","Shops"],["sleepSpot","Sleep"]];
ids.forEach(([id, label], i) => {
  const x = 80 + i * 280;
  sctx.drawImage(renderDockSelected(id, 96), x, 40);
  sctx.drawImage(renderMarker(id, "base", 128), x - 16, 180);
  sctx.drawImage(renderMarker(id, "selected", 128), x - 16, 320);
  sctx.drawImage(renderMarker(id, id === "sleepSpot" ? "emphasizedVerified" : "verified", 128), x - 16, 430);
  sctx.fillStyle = "#5c5c56"; sctx.font = "12px system-ui"; sctx.textAlign = "center";
  sctx.fillText(label, x + 48, 150);
  sctx.textAlign = "start";
});
window.__done = true;
</script></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 960, height: 520 } });
await page.setContent(html);
await page.waitForFunction(() => window.__done === true);
await page.locator("#c").screenshot({ path: join(outDir, "glyph-preview.png") });

for (const id of Object.keys(PATHS)) {
  const dataUrl = await page.evaluate(
    ({ iconId, paths, mode }) => {
      const PAPER = "#ffffff";
      const INK = "#141412";
      const RINGS = { waterFountain: "#3d6a7c", supermarket: "#2f5d50", sleepSpot: "#4f4a58" };
      const WASH = { waterFountain: "#e6eef2", supermarket: "#e8f0ec", sleepSpot: "#eceaf0" };
      const ring = RINGS[iconId];
      const size = 192;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      const cx = size / 2,
        cy = size / 2,
        r = size * 0.335;
      ctx.fillStyle = "#2a2a28";
      ctx.fillRect(0, 0, size, size);
      ctx.beginPath();
      ctx.arc(cx, cy + 2.6, r + 1.6, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,0,0,0.28)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = WASH[iconId];
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, cy, r - 0.5, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(20,20,18,0.42)";
      ctx.lineWidth = 2.2 * (size / 120);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, r - 3.2, 0, Math.PI * 2);
      ctx.strokeStyle = ring;
      ctx.lineWidth = 2.5 * (size / 120);
      ctx.stroke();
      const scale = 1.44 * (size / 120);
      const weight = mode === "solid" ? 1.4 : 2.1;
      ctx.save();
      ctx.translate(cx - 12 * scale, cy - 12 * scale);
      ctx.scale(scale, scale);
      ctx.strokeStyle = INK;
      ctx.fillStyle = INK;
      ctx.lineWidth = weight;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const d of paths) {
        const p = new Path2D(d);
        if (mode === "solid") ctx.fill(p, "evenodd");
        else ctx.stroke(p);
      }
      ctx.restore();
      return canvas.toDataURL("image/png");
    },
    { iconId: id, paths: PATHS[id], mode: MODES[id] },
  );
  writeFileSync(join(outDir, `glyph-preview-${id}.png`), Buffer.from(dataUrl.split(",")[1], "base64"));
}

for (const id of Object.keys(PATHS)) {
  const dataUrl = await page.evaluate(
    ({ iconId, paths, mode }) => {
      const SAGE = "#2f5d50";
      const size = 160;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#f7f6f3";
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = "rgba(47,93,80,0.18)";
      ctx.beginPath();
      ctx.roundRect(24, 24, 112, 112, 18);
      ctx.fill();
      ctx.strokeStyle = "rgba(47,93,80,0.22)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // Match dock size ~24px glyph inside 38px chip → scale relative to 24 viewBox
      const scale = (24 / 24) * (112 / 38);
      ctx.save();
      ctx.translate(80 - 12 * scale, 80 - 12 * scale);
      ctx.scale(scale, scale);
      ctx.fillStyle = SAGE;
      ctx.strokeStyle = SAGE;
      ctx.lineWidth = 2.1;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const d of paths) {
        const p = new Path2D(d);
        if (mode === "solid") ctx.fill(p, "evenodd");
        else ctx.stroke(p);
      }
      ctx.restore();
      return canvas.toDataURL("image/png");
    },
    { iconId: id, paths: PATHS[id], mode: MODES[id] },
  );
  writeFileSync(
    join(outDir, `glyph-dock-selected-${id}.png`),
    Buffer.from(dataUrl.split(",")[1], "base64"),
  );
}

await browser.close();
console.log("wrote", join(outDir, "glyph-preview.png"));
console.log("paths", JSON.stringify(PATHS, null, 2));
