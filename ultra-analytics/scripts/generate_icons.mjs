#!/usr/bin/env node
/**
 * Generate RYDN icons from the user's real logo files (LANCZOS downscale).
 *
 * Master: assets/brand/source/master-icon-square.png
 * (HighQuality white R+circle on dark square — never redraw / never upscale)
 *
 * Run: node scripts/generate_icons.mjs
 * Or:  python3 scripts/generate_brand_from_source.py
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PY = join(__dirname, "generate_brand_from_source.py");

if (!existsSync(PY)) {
  console.error("Missing generate_brand_from_source.py");
  process.exit(1);
}

const r = spawnSync("python3", [PY], { cwd: ROOT, stdio: "inherit" });
process.exit(r.status ?? 1);
