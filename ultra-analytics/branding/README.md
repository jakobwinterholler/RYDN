# RYDN Brand

**Source of truth:** the user’s exported logo files in `ultra-analytics/assets/brand/source/`.

Do **not** recreate the R as hand-drawn SVG paths. All favicon / PWA / apple-touch rasters are LANCZOS downscales from the HighQuality square master.

## Masters (`assets/brand/source/`)

| File | Role |
|------|------|
| `master-icon-square.png` | **Primary** — white R+circle on dark square (1024×1024). App icon / PWA / apple-touch / favicon / social |
| `master-stealth-square.png` | Alt / stealth dark-on-black mark |
| `master-wordmark-rydn.png` | **RYDN.** wordmark PNG |
| `master-wordmark-rydn-bike.png` | **RYDN.BIKE** wordmark PNG |
| `master-wordmark-rydn-bike.svg` | User Figma export (`Subtract.svg`) — preferred wordmark SVG |

## Rebuild

```bash
python3 scripts/generate_brand_from_source.py
# or
node scripts/generate_icons.mjs
```

Outputs land in `frontend/public/` (`icon-*.png`, `apple-touch-icon*.png`, `favicon.ico`, `brand/*`).

After deploy: **remove and re-add the iOS home-screen icon** so Springboard picks up the new 180×180 asset.
