#!/usr/bin/env node
/**
 * Rasterize RYDN icons from the master SVG (not from a tiny favicon).
 * Apple / PWA recommended sizes. Requires: npm i -D @resvg/resvg-js (dev) or npx.
 *
 * Run from repo: node scripts/generate_icons.mjs
 * Or: cd frontend && node ../scripts/generate_icons.mjs
 */

import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, "../frontend/public");
const FRONTEND = join(__dirname, "../frontend");
const SOURCE = join(PUBLIC, "icon-source.svg");

/** Apple HIG + common PWA / Android sizes */
const SIZES = [16, 32, 48, 72, 96, 120, 128, 144, 152, 167, 180, 192, 256, 384, 512, 1024];
const MASKABLE = [192, 512];

async function loadResvg() {
  const require = createRequire(join(FRONTEND, "package.json"));
  try {
    return require("@resvg/resvg-js");
  } catch {
    // fall through
  }
  try {
    return await import(pathToFileURL(join(FRONTEND, "node_modules/@resvg/resvg-js/index.js")).href);
  } catch {
    console.error("Install @resvg/resvg-js in frontend first: cd frontend && npm i -D @resvg/resvg-js");
    process.exit(1);
  }
}

function maskableSvg(masterSvg, size) {
  // Safe zone ~80%: slightly more padding so the mark survives circular/squircle masks
  const pad = Math.round(size * 0.12);
  const inner = size - pad * 2;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none">
  <rect width="${size}" height="${size}" fill="#F7F6F3"/>
  <svg x="${pad}" y="${pad}" width="${inner}" height="${inner}" viewBox="0 0 1024 1024">
    ${masterSvg.replace(/<\?xml[^>]*>/, "").replace(/<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "")}
  </svg>
</svg>`;
}

async function main() {
  mkdirSync(PUBLIC, { recursive: true });
  const { Resvg } = await loadResvg();
  const master = readFileSync(SOURCE, "utf8");

  for (const size of SIZES) {
    const resvg = new Resvg(master, {
      fitTo: { mode: "width", value: size },
      background: "transparent",
    });
    const png = resvg.render().asPng();
    const out = join(PUBLIC, `icon-${size}.png`);
    writeFileSync(out, png);
    console.log(`wrote icon-${size}.png (${png.length} bytes)`);
  }

  for (const size of MASKABLE) {
    const svg = maskableSvg(master, size);
    const resvg = new Resvg(svg, {
      fitTo: { mode: "width", value: size },
    });
    const png = resvg.render().asPng();
    writeFileSync(join(PUBLIC, `icon-maskable-${size}.png`), png);
    console.log(`wrote icon-maskable-${size}.png`);
  }

  // Apple touch aliases (exact recommended pixel sizes)
  copyFileSync(join(PUBLIC, "icon-180.png"), join(PUBLIC, "apple-touch-icon.png"));
  copyFileSync(join(PUBLIC, "icon-152.png"), join(PUBLIC, "apple-touch-icon-152.png"));
  copyFileSync(join(PUBLIC, "icon-167.png"), join(PUBLIC, "apple-touch-icon-167.png"));
  console.log("wrote apple-touch-icon*.png");

  // Favicon: keep vector; also refresh PNG favicons from master
  writeFileSync(join(PUBLIC, "favicon.svg"), `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">
  <path d="M4 21.5C7.8 21.5 8.6 12.2 14.2 12.2c4.6 0 5.4 6.2 9.8 4.2V6.8" stroke="#1a1a18" stroke-width="2.55" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M24 6.8L29.2 10.25 24 13.7Z" fill="#1a1a18"/>
</svg>
`);
  console.log("refreshed favicon.svg");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
