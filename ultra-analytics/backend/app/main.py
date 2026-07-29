"""Ultra — analysis API.

Accounts (Continue with Google, or a local dev fallback), Strava as the central
integration, and manual FIT/TCX/GPX upload as a secondary path. Every ride is
owned by a user and analysed by the same canonical pipeline.
"""

from __future__ import annotations

import os
import tempfile
import traceback
from contextlib import asynccontextmanager
from typing import List, Optional

from fastapi import Body, Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import store
from . import ultras as ultra_store
from . import routes_store
from .analysis.report import ANALYSIS_SCHEMA, build_report
from .auth import current_user
from .auth import router as auth_router
from .config import get_config
from .middleware_security import SecurityHeadersMiddleware
from .parsing.base import UnsupportedFormat, build_race, parse_upload
from .paths import data_root, frontend_dist
from .providers.router import analyze_provider_ride, ensure_map_polylines
from .providers.router import router as providers_router
from .util.http_errors import MSG_ANALYSIS, MSG_IMPORT_CORRUPT, MSG_ULTRA_ANALYSIS
from .util.logging_util import log_event, log_exception, sanitize_client_payload

MAX_FILE_MB = 80


def _report_stale(report: dict) -> bool:
    """True when a cached report predates current analysis semantics."""
    if int(report.get("analysisSchema") or 0) < ANALYSIS_SCHEMA:
        return True
    curves = report.get("curves") or {}
    for key in ("speedMoving", "speedElapsed"):
        pts = (curves.get(key) or {}).get("points") or []
        if any(int(p.get("d") or 0) < 5 for p in pts):
            return True
    return False


@asynccontextmanager
async def lifespan(app: FastAPI):
    from .config import validate_startup
    from .util.logging_util import configure_logging

    configure_logging()
    os.makedirs(data_root(), exist_ok=True)
    validate_startup()
    cfg = get_config()
    log_event(
        "app.startup",
        env=cfg.env,
        on_railway=cfg.on_railway,
        data_dir=data_root(),
        api_url=cfg.api_url,
        app_url=cfg.app_url,
        port=os.environ.get("PORT", ""),
        google=cfg.google_enabled,
        strava=cfg.strava_enabled,
    )
    yield
    log_event("app.shutdown")


app = FastAPI(title="RYDN", version="0.4.0", lifespan=lifespan)

# Order: last added runs first on request. Security → GZip → CORS.
_cfg = get_config()
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(_cfg.cors_origins),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)
app.add_middleware(GZipMiddleware, minimum_size=500)
app.add_middleware(SecurityHeadersMiddleware)

app.include_router(auth_router)
app.include_router(providers_router)


@app.get("/health")
@app.get("/api/health")
def health() -> dict:
    cfg = get_config()
    return {
        "status": "ok",
        "product": "RYDN",
        "phase": "release",
        "env": cfg.env,
        "secureCookies": cfg.cookie_secure,
        "oauthDebug": cfg.oauth_debug,
    }


@app.post("/api/telemetry/client-error")
async def client_error(request: Request) -> JSONResponse:
    """Browser reliability reports — no auth required; no PII stored beyond URL path."""
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        body = {}
    payload = sanitize_client_payload(body if isinstance(body, dict) else {})
    log_event("client.error", **payload)
    return JSONResponse({"ok": True})


# --------------------------------------------------------------------------- #
# ride library (user-scoped)
# --------------------------------------------------------------------------- #
@app.get("/api/rides")
def list_rides(user: dict = Depends(current_user)) -> JSONResponse:
    return JSONResponse(store.list_rides(user["id"]))


@app.get("/api/cabinet")
def get_cabinet(user: dict = Depends(current_user)) -> JSONResponse:
    """Completed trophy cabinet + planning Ultras + planned routes + Library rides."""
    rides = store.list_rides(user["id"])
    payload = ultra_store.cabinet_payload(user["id"], rides)
    # Routes are a separate object type — never mixed into ungroupedRides.
    payload["plannedRoutes"] = routes_store.list_routes(user["id"])
    return JSONResponse(payload)


@app.get("/api/routes")
def list_routes(user: dict = Depends(current_user)) -> JSONResponse:
    return JSONResponse(routes_store.list_routes(user["id"]))


@app.post("/api/routes/import")
async def import_planned_route(
    file: UploadFile = File(...),
    name: Optional[str] = Form(None),
    user: dict = Depends(current_user),
) -> JSONResponse:
    """Import a GPX as a Planned Route — never creates a Ride."""
    filename = file.filename or "route.gpx"
    suffix = os.path.splitext(filename)[1].lower()
    if suffix != ".gpx":
        raise HTTPException(
            status_code=400,
            detail="Planned routes require a GPX file. Use Completed Ride for FIT, TCX, or activity GPX.",
        )
    raw = await file.read()
    if len(raw) > MAX_FILE_MB * 1024 * 1024:
        raise HTTPException(
            status_code=400,
            detail=f"{filename} is larger than {MAX_FILE_MB} MB.",
        )
    with tempfile.NamedTemporaryFile(suffix=".gpx", delete=False) as tmp:
        tmp.write(raw)
        tmp_path = tmp.name
    try:
        summary = routes_store.create_route_from_gpx(
            user["id"],
            gpx_path=tmp_path,
            filename=filename,
            name=(name or "").strip() or None,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc) or MSG_IMPORT_CORRUPT)
    except Exception as exc:  # noqa: BLE001
        log_exception("routes.import_failed", exc, filename=filename)
        raise HTTPException(status_code=400, detail=MSG_IMPORT_CORRUPT)
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
    log_event("routes.imported", user_id=user["id"], route_id=summary.get("id"))
    return JSONResponse(summary)


@app.post("/api/routes/import/stream")
async def import_planned_route_stream(
    file: UploadFile = File(...),
    name: Optional[str] = Form(None),
    user: dict = Depends(current_user),
) -> StreamingResponse:
    """SSE progress for Planned Route import — same work as /api/routes/import."""
    import json as _json
    import queue
    import threading

    filename = file.filename or "route.gpx"
    suffix = os.path.splitext(filename)[1].lower()
    if suffix != ".gpx":
        raise HTTPException(
            status_code=400,
            detail="Planned routes require a GPX file. Use Completed Ride for FIT, TCX, or activity GPX.",
        )
    raw = await file.read()
    if len(raw) > MAX_FILE_MB * 1024 * 1024:
        raise HTTPException(
            status_code=400,
            detail=f"{filename} is larger than {MAX_FILE_MB} MB.",
        )
    with tempfile.NamedTemporaryFile(suffix=".gpx", delete=False) as tmp:
        tmp.write(raw)
        tmp_path = tmp.name

    uid = user["id"]
    display_name = (name or "").strip() or None
    events: queue.Queue = queue.Queue()

    def emit(payload: dict) -> None:
        events.put(payload)

    def worker() -> None:
        try:
            emit(
                {
                    "type": "progress",
                    "stage": "uploading",
                    "label": "Upload complete",
                    "pct": 4,
                    "stats": {},
                }
            )

            def on_progress(stage: str, label: str, pct: int, stats=None) -> None:
                emit(
                    {
                        "type": "progress",
                        "stage": stage,
                        "label": label,
                        "pct": int(max(0, min(99, pct))),
                        "stats": stats or {},
                    }
                )

            summary = routes_store.create_route_from_gpx(
                uid,
                gpx_path=tmp_path,
                filename=filename,
                name=display_name,
                on_progress=on_progress,
            )
            log_event("routes.imported", user_id=uid, route_id=summary.get("id"))
            emit({"type": "done", "summary": summary, "pct": 100, "label": "Route imported successfully"})
        except ValueError as exc:
            emit({"type": "error", "message": str(exc) or MSG_IMPORT_CORRUPT})
        except Exception as exc:  # noqa: BLE001
            log_exception("routes.import_stream_failed", exc, filename=filename)
            emit({"type": "error", "message": MSG_IMPORT_CORRUPT})
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            events.put(None)

    threading.Thread(target=worker, daemon=True).start()

    def event_stream():
        while True:
            item = events.get()
            if item is None:
                break
            yield f"data: {_json.dumps(item)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/api/routes/{route_id}")
def get_route(route_id: str, user: dict = Depends(current_user)) -> JSONResponse:
    detail = routes_store.get_route_detail(user["id"], route_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Route not found.")
    return JSONResponse(detail)


@app.get("/api/routes/{route_id}/analysis")
def get_route_analysis(
    route_id: str,
    refresh: bool = False,
    targetStageKm: float = 250.0,
    user: dict = Depends(current_user),
) -> JSONResponse:
    """Planning intelligence — climbs, services, sleep, remote gaps, stages."""
    analysis = routes_store.get_route_analysis(
        user["id"],
        route_id,
        force=refresh,
        target_stage_km=targetStageKm,
    )
    if not analysis:
        raise HTTPException(status_code=404, detail="Route not found.")
    return JSONResponse(analysis)


@app.get("/api/routes/{route_id}/pois")
def get_route_viewport_pois(
    route_id: str,
    south: float,
    west: float,
    north: float,
    east: float,
    group: str = "all",
    user: dict = Depends(current_user),
) -> JSONResponse:
    """Viewport POI search (Overpass proxy) for Planning map Search-this-area."""
    detail = routes_store.get_route_detail(user["id"], route_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Route not found.")
    if south >= north or west >= east:
        raise HTTPException(status_code=400, detail="Invalid bounding box.")
    from .analysis.route_pois import fetch_viewport_pois

    payload = fetch_viewport_pois(south, west, north, east, group=group or "all")
    return JSONResponse(payload)


@app.patch("/api/routes/{route_id}")
async def patch_route(
    route_id: str,
    payload: dict = Body(...),
    user: dict = Depends(current_user),
) -> JSONResponse:
    updated = routes_store.update_route(user["id"], route_id, payload)
    if not updated:
        raise HTTPException(status_code=404, detail="Route not found.")
    return JSONResponse(updated)


@app.delete("/api/routes/{route_id}")
def delete_route(route_id: str, user: dict = Depends(current_user)) -> JSONResponse:
    if not routes_store.delete_route(user["id"], route_id):
        raise HTTPException(status_code=404, detail="Route not found.")
    return JSONResponse({"ok": True})


@app.post("/api/import")
async def import_ride(
    files: List[UploadFile],
    kind: str = Form("race"),
    name: Optional[str] = Form(None),
    purpose: str = Form("completed"),
    user: dict = Depends(current_user),
) -> JSONResponse:
    """Import a completed activity into the Ride Library.

    Planned routes must use ``POST /api/routes/import`` — this endpoint refuses
    ``purpose=planned`` so planning GPXs never become Rides by accident.
    """
    if purpose == "planned":
        raise HTTPException(
            status_code=400,
            detail="Use Planned Route import for course GPX files. This endpoint only creates completed rides.",
        )
    if kind not in ("training", "race"):
        raise HTTPException(status_code=400, detail="kind must be 'training' or 'race'.")
    if not files:
        raise HTTPException(status_code=400, detail="Upload at least one ride file.")

    activities = []
    for upload in files:
        raw = await upload.read()
        if len(raw) > MAX_FILE_MB * 1024 * 1024:
            raise HTTPException(
                status_code=400,
                detail=f"{upload.filename} is larger than {MAX_FILE_MB} MB.",
            )
        suffix = os.path.splitext(upload.filename or "ride")[1] or ".dat"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(raw)
            tmp_path = tmp.name
        try:
            activities.append(parse_upload(tmp_path, upload.filename or "ride"))
        except UnsupportedFormat:
            raise HTTPException(
                status_code=400,
                detail="Unsupported file type. Upload a FIT, TCX, or GPX file.",
            )
        except Exception as exc:  # noqa: BLE001
            log_exception("import.parse_failed", exc, filename=upload.filename or "")
            traceback.print_exc()
            raise HTTPException(status_code=400, detail=MSG_IMPORT_CORRUPT)
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    # Guard: GPX without timestamps cannot be a completed ride.
    empty = [a for a in activities if not a.samples]
    if empty:
        raise HTTPException(
            status_code=400,
            detail=(
                "This file has no timestamps, so it cannot be a completed ride. "
                "Import it as a Planned Route instead."
            ),
        )

    default_name = (
        os.path.splitext(files[0].filename or "")[0]
        or ("Ultra Race" if kind == "race" else "Training Ride")
    )
    race = build_race(activities, kind=kind, name=(name or default_name).strip())

    try:
        report = build_report(race)
    except Exception as exc:  # noqa: BLE001
        log_exception("import.analysis_failed", exc)
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=MSG_ANALYSIS)

    return JSONResponse(store.save_ride(user["id"], report, source="upload", activities=race.activities))


@app.get("/api/ultras")
def list_ultras(user: dict = Depends(current_user)) -> JSONResponse:
    return JSONResponse(ultra_store.list_ultras(user["id"]))


@app.post("/api/ultras")
async def create_ultra(
    payload: dict = Body(...),
    user: dict = Depends(current_user),
) -> JSONResponse:
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required.")
    activity_ids = payload.get("activityIds") or []
    conflicts = ultra_store.find_membership_conflicts(user["id"], list(activity_ids))
    if conflicts:
        raise HTTPException(
            status_code=409,
            detail=f"Activity already belongs to another Ultra: {conflicts[0]}",
        )
    activities = []
    rides_by_id = {r["id"]: r for r in store.list_rides(user["id"])}
    for aid in activity_ids:
        if aid not in rides_by_id:
            raise HTTPException(status_code=400, detail=f"Unknown activity: {aid}")
        activities.append(rides_by_id[aid])
    if activities:
        ultra = ultra_store.ultra_from_activities(
            user["id"],
            name,
            activities,
            year=payload.get("year"),
            kind=payload.get("kind", "ultra"),
            status=payload.get("status", "reviewed"),
            country=payload.get("country"),
            countryCode=payload.get("countryCode"),
            countryCodes=payload.get("countryCodes"),
            countriesManual=bool(payload.get("countriesManual")),
            result=payload.get("result") or payload.get("finishPlace"),
            dateStart=payload.get("dateStart"),
            dateEnd=payload.get("dateEnd"),
            finishPercentile=payload.get("finishPercentile"),
            rating=payload.get("rating"),
            coverUrl=payload.get("coverUrl"),
            logoUrl=payload.get("logoUrl"),
        )
    else:
        ultra = ultra_store.create_ultra(
            user["id"],
            name=name,
            year=payload.get("year"),
            status=payload.get("status", "draft"),
            kind=payload.get("kind", "ultra"),
            country=payload.get("country"),
            country_code=payload.get("countryCode"),
            country_codes=payload.get("countryCodes"),
            countries_manual=bool(payload.get("countriesManual")),
            result=payload.get("result") or payload.get("finishPlace"),
            date_start=payload.get("dateStart"),
            date_end=payload.get("dateEnd"),
            finish_percentile=payload.get("finishPercentile"),
            rating=payload.get("rating"),
            cover_url=payload.get("coverUrl"),
            logo_url=payload.get("logoUrl"),
        )
    return JSONResponse(ultra)


@app.get("/api/ultras/{ultra_id}")
async def get_ultra(ultra_id: str, user: dict = Depends(current_user)) -> JSONResponse:
    ultra = ultra_store.get_ultra(user["id"], ultra_id)
    if not ultra:
        raise HTTPException(status_code=404, detail="Ultra not found.")
    # Backfill Strava summary polylines so route preview can render.
    await ensure_map_polylines(user, ultra.get("activityIds") or [])
    rides = store.list_rides(user["id"])
    # Heal derived fields (prune deleted members, refresh totals/countries/year).
    ultra_store.recompute_ultra(user["id"], ultra_id, rides=rides)
    ultra = ultra_store.get_ultra(user["id"], ultra_id) or ultra
    by_id = {r["id"]: r for r in rides}
    # Chronological day order unless the rider locked a custom order.
    if not ultra.get("activityOrderManual"):
        sorted_ids = ultra_store.sort_activity_ids(list(ultra.get("activityIds") or []), by_id)
        if sorted_ids != list(ultra.get("activityIds") or []):
            ultra_store.update_ultra(
                user["id"],
                ultra_id,
                {"activityIds": sorted_ids, "activityOrderManual": False},
            )
            ultra_store.recompute_ultra(user["id"], ultra_id, rides=rides)
            ultra = ultra_store.get_ultra(user["id"], ultra_id) or ultra
    # Clean legacy long Strava titles stored as Ultra names.
    cleaned = ultra_store.clean_ultra_name(ultra.get("name") or "")
    patch_fix: dict = {}
    if ultra.get("name") != cleaned:
        patch_fix["name"] = cleaned
    if not (ultra.get("result") or ultra.get("finishPlace")):
        extracted = ultra_store.extract_result_from_name(ultra.get("name") or "")
        if extracted:
            patch_fix["result"] = extracted
    if patch_fix:
        ultra_store.update_ultra(user["id"], ultra_id, patch_fix)
    detail = ultra_store.ultra_detail(user["id"], ultra_id, store.list_rides(user["id"]))
    if not detail:
        raise HTTPException(status_code=404, detail="Ultra not found.")
    return JSONResponse(detail)


@app.get("/api/ultras/{ultra_id}/analysis")
async def get_ultra_analysis(
    ultra_id: str,
    force: bool = False,
    user: dict = Depends(current_user),
) -> JSONResponse:
    """Stitched expedition analytics — one Ultra as one activity."""
    from .analysis.ultra_report import build_ultra_analysis

    ultra = ultra_store.get_ultra(user["id"], ultra_id)
    if not ultra:
        raise HTTPException(status_code=404, detail="Ultra not found.")
    try:
        payload = await build_ultra_analysis(user, ultra_id, force=force)
    except KeyError:
        raise HTTPException(status_code=404, detail="Ultra not found.")
    except Exception as exc:  # noqa: BLE001
        log_exception("ultra.analysis_failed", exc, ultra_id=ultra_id)
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=MSG_ULTRA_ANALYSIS)
    return JSONResponse(payload)


@app.patch("/api/ultras/{ultra_id}")
async def patch_ultra(
    ultra_id: str,
    payload: dict = Body(...),
    user: dict = Depends(current_user),
) -> JSONResponse:
    rides = store.list_rides(user["id"])
    by_id = {r["id"]: r for r in rides}
    existing = ultra_store.get_ultra(user["id"], ultra_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Ultra not found.")

    patch = dict(payload)
    if "activityIds" in patch:
        ids = list(patch.get("activityIds") or [])
        missing = [aid for aid in ids if aid not in by_id]
        if missing:
            raise HTTPException(status_code=400, detail=f"Unknown activity: {missing[0]}")
        conflicts = ultra_store.find_membership_conflicts(
            user["id"], ids, except_ultra_id=ultra_id
        )
        if conflicts:
            raise HTTPException(
                status_code=409,
                detail=f"Activity already belongs to another Ultra: {conflicts[0]}",
            )
        order_manual = bool(patch.get("activityOrderManual", existing.get("activityOrderManual")))
        if not order_manual:
            ids = ultra_store.sort_activity_ids(ids, by_id)
            patch["activityOrderManual"] = False
        patch["activityIds"] = ids
        if "countryCodes" in patch:
            patch["countriesManual"] = True
        membership_patch = {
            "activityIds": ids,
            "activityOrderManual": patch.get("activityOrderManual", order_manual),
        }
        if "countryCodes" in patch:
            membership_patch["countryCodes"] = patch["countryCodes"]
            membership_patch["countriesManual"] = True
        ultra = ultra_store.update_ultra(user["id"], ultra_id, membership_patch)
        if not ultra:
            raise HTTPException(status_code=404, detail="Ultra not found.")
        ultra_store.recompute_ultra(user["id"], ultra_id, rides=rides)
        detail = ultra_store.ultra_detail(user["id"], ultra_id, store.list_rides(user["id"]))
        return JSONResponse(detail)

    if "countryCodes" in patch:
        patch["countriesManual"] = True

    ultra = ultra_store.update_ultra(user["id"], ultra_id, patch)
    if not ultra:
        raise HTTPException(status_code=404, detail="Ultra not found.")
    detail = ultra_store.ultra_detail(user["id"], ultra_id, store.list_rides(user["id"]))
    return JSONResponse(detail)


@app.delete("/api/ultras/{ultra_id}")
def delete_ultra(ultra_id: str, user: dict = Depends(current_user)) -> JSONResponse:
    if not ultra_store.delete_ultra(user["id"], ultra_id):
        raise HTTPException(status_code=404, detail="Ultra not found.")
    return JSONResponse({"deleted": ultra_id})


@app.get("/api/rides/{ride_id}")
async def get_ride(ride_id: str, user: dict = Depends(current_user)) -> JSONResponse:
    report = store.get_ride(user["id"], ride_id)
    if report is not None and _report_stale(report) and store.get_stub(user["id"], ride_id):
        # Re-fetch provider streams so speed curves (and other schema bumps) refresh.
        report = await analyze_provider_ride(user, ride_id)
    if report is None:
        report = await analyze_provider_ride(user, ride_id)  # lazy provider analysis
    if report is None:
        raise HTTPException(status_code=404, detail="Ride not found.")
    return JSONResponse(report)


@app.delete("/api/rides/{ride_id}")
def delete_ride(ride_id: str, user: dict = Depends(current_user)) -> JSONResponse:
    # Detach from Ultras first so recomputation can still see other members.
    affected = ultra_store.detach_activity_from_ultras(user["id"], ride_id)
    if not store.delete_ride(user["id"], ride_id):
        raise HTTPException(status_code=404, detail="Ride not found.")
    # Recompute again after file removal (ids already pruned).
    for uid_ultra in affected:
        ultra_store.recompute_ultra(user["id"], uid_ultra)
    return JSONResponse({"deleted": ride_id, "ultrasUpdated": affected})


@app.post("/api/sample")
def import_sample(user: dict = Depends(current_user)) -> JSONResponse:
    """Analyze the bundled synthetic 2-day ultra (if generated), save it to the
    user's library, and return the ride summary."""
    sample_dir = os.path.join(os.path.dirname(__file__), "..", "sample_data")
    day1 = os.path.join(sample_dir, "Day1.gpx")
    day2 = os.path.join(sample_dir, "Day2.gpx")
    if not (os.path.exists(day1) and os.path.exists(day2)):
        raise HTTPException(
            status_code=404,
            detail="Sample not generated. Run: python -m tests.make_sample",
        )
    activities = [parse_upload(day1, "Day1.gpx"), parse_upload(day2, "Day2.gpx")]
    race = build_race(activities, kind="race", name="Sample Ultra (2 days)")
    report = build_report(race)
    return JSONResponse(store.save_ride(user["id"], report, activities=race.activities))


# --------------------------------------------------------------------------- #
# Production SPA (built frontend). Local `./dev.sh` does not use this —
# Vite serves the UI and proxies /api to uvicorn.
# --------------------------------------------------------------------------- #
_DIST = frontend_dist()
if os.path.isdir(_DIST) and os.path.isfile(os.path.join(_DIST, "index.html")):
    _assets = os.path.join(_DIST, "assets")
    if os.path.isdir(_assets):
        app.mount("/assets", StaticFiles(directory=_assets), name="assets")

    @app.get("/")
    def spa_index() -> FileResponse:
        return FileResponse(os.path.join(_DIST, "index.html"))

    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str) -> FileResponse:
        # Never swallow API / health — those are registered above.
        if full_path.startswith("api/") or full_path == "health":
            raise HTTPException(status_code=404, detail="Not found.")
        candidate = os.path.join(_DIST, full_path)
        if os.path.isfile(candidate) and os.path.commonpath([_DIST, candidate]) == _DIST:
            return FileResponse(candidate)
        return FileResponse(os.path.join(_DIST, "index.html"))
