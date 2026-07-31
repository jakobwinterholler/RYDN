#!/usr/bin/env node
/**
 * Rasterize RYDN icons from Direction #9 SVG masters (never PNG upscale).
 *
 * Pipeline:
 *   1) Prefer scripts/build_brand_d9.py — regenerates SVG masters + resvg batch + softsnap
 *   2) Fallback: resvg each size from home/full SVG masters (+ favicon.svg for ≤48)
 *
 * Masters:
 *   - icon-source-home.svg — optical heavy R for ≤192 / apple-touch (home screen)
 *   - icon-source.svg — full geometric italic R for ≥256
 *   - favicon.svg — favicon-tuned R for 16–48 only
 *
 * Run: node scripts/generate_icons.mjs
 * Or:  python3 scripts/build_brand_d9.py
 */

import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PUBLIC = join(ROOT, "frontend/public");
const FRONTEND = join(ROOT, "frontend");
const BRAND_BUILD = join(__dirname, "build_brand_d9.py");

/** Prefer the full Direction #9 brand builder when available. */
if (existsSync(BRAND_BUILD)) {
  const r = spawnSync("python3", [BRAND_BUILD], { cwd: ROOT, stdio: "inherit" });
  process.exit(r.status ?? 1);
}

const SOURCE = join(PUBLIC, "icon-source.svg");
const SOURCE_HOME = join(PUBLIC, "icon-source-home.svg");
/** Every size is rendered from SVG at that pixel width — never scaled from a smaller PNG. */
const SIZES = [16, 32, 48, 64, 72, 96, 120, 128, 144, 152, 167, 180, 192, 256, 384, 512, 1024];
const MASKABLE = [192, 512];
const FAVICON_MAX = 48;
const HOME_MAX = 192;

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

function rasterize(Resvg, svgBytes, size) {
  const resvg = new Resvg(svgBytes, {
    fitTo: { mode: "width", value: size },
    background: "transparent",
  });
  return resvg.render().asPng();
}

async function main() {
  mkdirSync(PUBLIC, { recursive: true });
  const { Resvg } = await loadResvg();
  const master = readFileSync(SOURCE);
  const home = existsSync(SOURCE_HOME) ? readFileSync(SOURCE_HOME) : master;
  const fav = readFileSync(join(PUBLIC, "favicon.svg"));

  for (const size of SIZES) {
    const src = size <= FAVICON_MAX ? fav : size <= HOME_MAX ? home : master;
    writeFileSync(join(PUBLIC, `icon-${size}.png`), rasterize(Resvg, src, size));
    console.log(`wrote icon-${size}.png (SVG→${size}px)`);
  }

  const maskable = readFileSync(join(PUBLIC, "icon-maskable.svg"));
  for (const size of MASKABLE) {
    writeFileSync(join(PUBLIC, `icon-maskable-${size}.png`), rasterize(Resvg, maskable, size));
    console.log(`wrote icon-maskable-${size}.png (SVG→${size}px)`);
  }

  copyFileSync(join(PUBLIC, "icon-180.png"), join(PUBLIC, "apple-touch-icon.png"));
  copyFileSync(join(PUBLIC, "icon-152.png"), join(PUBLIC, "apple-touch-icon-152.png"));
  copyFileSync(join(PUBLIC, "icon-167.png"), join(PUBLIC, "apple-touch-icon-167.png"));
  console.log("Direction #9 icons refreshed (all sizes from SVG)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
