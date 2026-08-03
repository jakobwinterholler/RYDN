# Mobile GPX Import (Companion v0.2)

Companion can import and fully analyze GPX routes on iPhone without the desktop planner.

## Architecture

**Server-side analysis (preferred path):** `POST /api/sync/import-gpx` runs the same Python pipeline as desktop (`pipeline.py` → `companion_bundle.py`), streams staged progress via SSE, pushes to Supabase, and returns the schema v5 bundle for IndexedDB offline storage.

The companion calls **`/api/sync/import-gpx`** on the same origin in production (Vercel rewrites to the Render FastAPI service) or via the Vite dev proxy to `localhost:8000`. Optionally set `VITE_API_BASE_URL` to hit the API directly instead of the rewrite.

## Import methods

| Method | Support |
|--------|---------|
| **+ New Race** button | ✅ All platforms |
| Files app / file picker | ✅ `accept=".gpx,application/gpx+xml"` |
| AirDrop → Save to Files → pick in app | ✅ via file picker |
| Komoot / RideWithGPS / Safari downloads | ✅ save GPX, open in Companion |
| PWA `file_handlers` (installed app) | ✅ Chrome/Android; limited iOS 16.4+ |
| Web Share Target | ⚠️ Declared in manifest; **iOS Safari PWA does not deliver shared files reliably** |
| `launchQueue` (File Handling API) | ✅ Installed PWA on Chromium; **not available in iOS Safari** |

## iOS: Add to Home Screen

1. Open the Companion in **Safari** (not Chrome on iOS for best PWA support).
2. Tap **Share** → **Add to Home Screen**.
3. Launch from the home screen icon (standalone mode).
4. Tap **+ New Race** → **Browse** → select a `.gpx` from Files, iCloud, or AirDrop folder.

## Staged progress

1. Loading…
2. Analyzing route…
3. Detecting climbs…
4. Finding resupply…
5. Creating companion bundle…
6. Ready to ride.

Progress updates continuously via SSE (`import_stage` + pipeline `progress` events).

## Duplicate routes

Before analysis, the app checks `GET /api/sync/import-gpx/duplicates?fingerprint=<sha256[:16]>`. If a match exists (cloud or server-local), you can **Replace**, **Import as duplicate**, or **Cancel**.

## Offline

After import completes, the bundle + GPX + verifications live in IndexedDB. No network needed on ride day.

## Validation

```bash
PYTHONPATH=src python scripts/validate_mobile_import_bundle.py
```

Compares two full pipeline runs on the Collserola sample GPX — checksums and stats must match.

## Known limitations

- **Requires online analysis** — full pipeline cannot run offline on device.
- **Requires deployed FastAPI** — deploy `render.yaml` to Render; Companion proxies `/api/*` via `companion/vercel.json` (or set `VITE_API_BASE_URL` explicitly).
- **iOS Share Sheet → Companion** — not reliably supported for PWAs; use Files picker instead.
- **Share Target POST** — needs service-worker handling for full Android support; file picker works today.
- **Large races (800–2000 km)** — server-side background thread; keep app foreground for best results.
