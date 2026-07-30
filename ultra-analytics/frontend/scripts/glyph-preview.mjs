/**
 * Render Water / Shops / Sleep marker sprites via Playwright Chromium.
 * Usage: node scripts/glyph-preview.mjs
 */
import { chromium } from "playwright";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "test-results");
mkdirSync(outDir, { recursive: true });

// Pull live paths from glyphs.ts so preview can't drift from production.
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

const html = `<!DOCTYPE html>
<html><body style="margin:0;background:#e8e6e0">
<canvas id="c" width="640" height="240"></canvas>
<script>
const PATHS = ${JSON.stringify(PATHS)};
const TONES = { waterFountain: "#2f6fad", supermarket: "#2f5d50", sleepSpot: "#5c4a6e" };
const PAPER = "#f7f6f3";
function drawGlyph(ctx, paths, cx, cy, scale, color, weight) {
  ctx.save();
  ctx.translate(cx - 12 * scale, cy - 12 * scale);
  ctx.scale(scale, scale);
  ctx.strokeStyle = color; ctx.fillStyle = color;
  ctx.lineWidth = weight; ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const d of paths) { const p = new Path2D(d); ctx.fill(p); ctx.stroke(p); }
  ctx.restore();
}
function renderMarker(iconId, size) {
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  const cx = size/2, cy = size/2, r = size * 0.3;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2);
  ctx.fillStyle = TONES[iconId]; ctx.fill();
  ctx.lineWidth = 6; ctx.strokeStyle = PAPER; ctx.stroke();
  drawGlyph(ctx, PATHS[iconId], cx, cy, 0.9 * (size/96), PAPER, 1.55 * (size/96));
  return canvas;
}
const strip = document.getElementById("c");
const sctx = strip.getContext("2d");
sctx.fillStyle = "#e8e6e0"; sctx.fillRect(0,0,640,240);
const labels = [["waterFountain","💧 Water"],["supermarket","🛒 Shops"],["sleepSpot","🛏️ Sleep"]];
labels.forEach(([id, label], i) => {
  sctx.drawImage(renderMarker(id, 160), 40 + i*200, 20);
  sctx.fillStyle = "#1a1a18"; sctx.font = "bold 18px system-ui,sans-serif";
  sctx.textAlign = "center"; sctx.fillText(label, 120 + i*200, 210);
});
window.__done = true;
</script></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 640, height: 240 } });
await page.setContent(html);
await page.waitForFunction(() => window.__done === true);
await page.locator("#c").screenshot({ path: join(outDir, "glyph-preview.png") });
for (const id of Object.keys(PATHS)) {
  const dataUrl = await page.evaluate(
    ({ iconId, paths }) => {
      const TONES = { waterFountain: "#2f6fad", supermarket: "#2f5d50", sleepSpot: "#5c4a6e" };
      const PAPER = "#f7f6f3";
      const size = 192;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      const cx = size / 2,
        cy = size / 2,
        r = size * 0.3;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = TONES[iconId];
      ctx.fill();
      ctx.lineWidth = 6;
      ctx.strokeStyle = PAPER;
      ctx.stroke();
      const scale = 0.9 * (size / 96);
      ctx.save();
      ctx.translate(cx - 12 * scale, cy - 12 * scale);
      ctx.scale(scale, scale);
      ctx.strokeStyle = PAPER;
      ctx.fillStyle = PAPER;
      ctx.lineWidth = 1.55 * (size / 96);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const d of paths) {
        const p = new Path2D(d);
        ctx.fill(p);
        ctx.stroke(p);
      }
      ctx.restore();
      return canvas.toDataURL("image/png");
    },
    { iconId: id, paths: PATHS[id] },
  );
  writeFileSync(join(outDir, `glyph-preview-${id}.png`), Buffer.from(dataUrl.split(",")[1], "base64"));
}
await browser.close();
console.log("wrote", join(outDir, "glyph-preview.png"));
console.log("paths", JSON.stringify(PATHS, null, 2));
