# RYDN Brand

Production vectors recreated from Figma logo exports (not PNG traces).

`ultra-analytics/assets/brand/`

| Asset | Role |
|-------|------|
| `logo.svg` / `logo-light.svg` / `logo-dark.svg` / `logo-transparent.svg` | Primary **RYDN.BIKE** lockup |
| `wordmark.svg` / light / dark / transparent | Secondary **RYDN.** (in-app) |
| `brandmark.svg` / light / dark / transparent | Standalone notched italic **R** |
| `favicon.svg` / `favicon.ico` | 16/32/48-optimized mark |
| `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `maskable-icon.png` | App / PWA |
| `social-avatar.svg` / `icon-social.svg` | Standalone square social mark (R + bottom-left C), stealth charcoal on black |
| `social-avatar-light.svg` | Same square mark, ink on paper |
| `social-avatar.png` (1024) / `social-avatar-512.png` | Rasters from social SVG via resvg |
| `loading-logo.svg`, `loading-animation.svg` | Loader end-state + route→wordmark |

Rebuild (SVG masters → all rasters via resvg, never upscale PNG):

```bash
python3 scripts/build_brand_d9.py
```

**Mark DNA (from Figma):** bold geometric italic; open-bowl **R** with a horizontal right-side notch between bowl tip and waist/leg; circular period; **BIKE** at ~0.66 cap height on the baseline.

**App colors:** paper `#F7F6F3` + ink `#111111` / `#1A1A18` (sage accent unchanged).

After deploy: remove and re-add the iOS home-screen icon so Springboard picks up the new 180×180 asset.

## Earlier exploration boards (A–E)

| File | Direction | Concept |
|------|-----------|---------|
| `rydn-brand-direction-A.png` | **A — Ink Route Flag** | Monoline route ending in a finish pennant/flag |
| `rydn-brand-direction-B.png` | **B — Typographic R** | Editorial serif R whose leg becomes a route line *(superseded)* |
| `rydn-brand-direction-C.png` | **C — Contour Plate** | Nested topographic contour rings with one open escape/route |
| `rydn-brand-direction-D.png` | **D — Monoline Journey** | Single elevation-like journey path with a terminal dot |
| `rydn-brand-direction-E.png` | **E — Expedition Seal** | Circular brevet/certificate seal; optional sage `#2F5D50` ring |
