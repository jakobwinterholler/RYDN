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
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import store
from . import ultras as ultra_store
from . import routes_store
from .analysis.report import ANALYSIS_SCHEMA, build_report
from .auth import current_user
from .auth import router as auth_router
from .billing.router import router as billing_router
from .config import get_config
from .maps import router as maps_router
from .middleware_security import SecurityHeadersMiddleware
from .parsing.base import UnsupportedFormat, build_race, parse_upload
from .paths import data_root, frontend_dist
from .providers.router import analyze_provider_ride, ensure_map_polylines
from .providers.router import router as providers_router
from .subscription.codes import ensure_seed_codes
from .subscription.deps import require_can_import_route, require_route_planning_access
from .subscription.race_pass import apply_pass_after_import, has_global_pro
from .subscription.router import router as subscription_router
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
    ensure_seed_codes()
    validate_startup()
    cfg = get_config()
    from .billing.bootstrap import bootstrap_stripe
    from .billing.config import billing_configured as _billing_ready

    billing_boot: dict | None = None
    if os.environ.get("STRIPE_SECRET_KEY", "").strip():
        try:
            billing_boot = bootstrap_stripe()
        except Exception as e:  # noqa: BLE001
            log_exception("billing.bootstrap.startup_failed", e)
            billing_boot = {"ok": False, "reason": str(e)}
    log_event(
        "app.startup",
        env=cfg.env,
        on_railway=cfg.on_railway,
        data_dir=data_root(),
        api_url=cfg.api_url,
        app_url=cfg.app_url,
        port=os.environ.get("PORT", ""),
        google=cfg.google_enabled,
        google_maps=cfg.google_maps_enabled,
        strava=cfg.strava_enabled,
        billingConfigured=_billing_ready(),
        billingBootstrap=(billing_boot or {}).get("ok"),
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
app.include_router(subscription_router)
app.include_router(billing_router)
app.include_router(providers_router)
app.include_router(maps_router)


@app.get("/health")
@app.get("/api/health")
def health() -> dict:
    from .billing.config import billing_configured

    cfg = get_config()
    return {
        "status": "ok",
        "product": "RYDN",
        "phase": "release",
        "env": cfg.env,
        "secureCookies": cfg.cookie_secure,
        "oauthDebug": cfg.oauth_debug,
        "billingConfigured": billing_configured(),
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
    routes = routes_store.list_routes(user["id"])
    if not has_global_pro(user):
        # Free: only Race Pass–unlocked planned routes.
        routes = [r for r in routes if r.get("proUnlock")]
    payload["plannedRoutes"] = routes
    return JSONResponse(payload)


@app.get("/api/routes")
def list_routes(user: dict = Depends(current_user)) -> JSONResponse:
    routes = routes_store.list_routes(user["id"])
    if has_global_pro(user):
        return JSONResponse(routes)
    # Free: only Race Pass–unlocked planned routes.
    return JSONResponse([r for r in routes if r.get("proUnlock")])


@app.post("/api/routes/import")
async def import_planned_route(
    file: UploadFile = File(...),
    name: Optional[str] = Form(None),
    user: dict = Depends(require_can_import_route),
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
        if summary.get("id"):
            try:
                apply_pass_after_import(user["id"], summary["id"])
                full = routes_store.get_route(user["id"], summary["id"])
                if full:
                    summary = routes_store._summary(full)  # noqa: SLF001
            except ValueError as exc:
                raise HTTPException(status_code=403, detail=str(exc)) from exc
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
    user: dict = Depends(require_can_import_route),
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
            if summary.get("id"):
                apply_pass_after_import(uid, summary["id"])
                full = routes_store.get_route(uid, summary["id"])
                if full:
                    summary = routes_store._summary(full)  # noqa: SLF001
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
def get_route(route_id: str, user: dict = Depends(require_route_planning_access)) -> JSONResponse:
    detail = routes_store.get_route_detail(user["id"], route_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Route not found.")
    return JSONResponse(detail)


@app.get("/api/routes/{route_id}/export.gpx")
def export_planned_route_gpx(
    route_id: str, user: dict = Depends(require_route_planning_access)
) -> Response:
    """Download planned-route GPX: course + verified water/shop/hotel waypoints only.

    Excludes sleep, cafés, bike shops, and unverified POIs. Auth required;
    other users' routes 404.
    """
    exported = routes_store.export_route_gpx(user["id"], route_id)
    if not exported:
        raise HTTPException(status_code=404, detail="Route not found.")
    filename, body = exported
    # ASCII fallback + RFC 5987 for emoji-safe route names.
    ascii_name = filename.encode("ascii", "replace").decode("ascii").replace("?", "_")
    from urllib.parse import quote

    disposition = (
        f'attachment; filename="{ascii_name}"; '
        f"filename*=UTF-8''{quote(filename)}"
    )
    return Response(
        content=body,
        media_type="application/gpx+xml",
        headers={
            "Content-Disposition": disposition,
            "Cache-Control": "no-store",
        },
    )


@app.get("/api/routes/{route_id}/analysis")
def get_route_analysis(
    route_id: str,
    refresh: bool = False,
    targetStageKm: float = 250.0,
    user: dict = Depends(require_route_planning_access),
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
    limit: int = 15,
    exclude: str = "",
    user: dict = Depends(require_route_planning_access),
) -> JSONResponse:
    """Viewport POI search — corridor cache first (instant), Overpass only as fill.

    Query:
      south,west,north,east — map bbox (visible viewport only)
      group — water|resupply|fuel|sleep|all
      limit — batch size (default 15, max 40)
      exclude — comma-separated already-seen / verified stop ids

    Response includes `timings` + `stats` for instrumentation.
    """
    import time as _time

    t_req = _time.perf_counter()
    detail = routes_store.get_route_detail(user["id"], route_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Route not found.")
    from .analysis.route_pois import fetch_viewport_pois, ensure_search_corridor
    from .analysis.poi_corridor import normalize_viewport_bbox

    try:
        south, west, north, east = normalize_viewport_bbox(south, west, north, east)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc) or "Invalid bounding box.") from exc

    exclude_ids = [x.strip() for x in (exclude or "").split(",") if x.strip()]
    # Also skip permanently verified stops so Search-again never reloads them.
    reviews = detail.get("stopReviews") or {}
    for sid, st in reviews.items():
        if st == "verified" and sid not in exclude_ids:
            exclude_ids.append(sid)
    for sid in (detail.get("savedStops") or {}):
        if sid not in exclude_ids:
            exclude_ids.append(sid)

    route = routes_store.get_route(user["id"], route_id) or {}
    track = route.get("track") or route.get("points") or []
    batch_limit = max(1, min(40, int(limit or 15)))

    # Warm corridor from disk/memory/analysis (no Overpass) before filtering.
    if track and len(track) >= 2:
        try:
            ensure_search_corridor(track, force_refresh=False, build_if_missing=False)
        except Exception:
            pass

    payload = fetch_viewport_pois(
        south,
        west,
        north,
        east,
        group=group or "all",
        track=track,
        exclude_ids=exclude_ids,
        limit=batch_limit,
        # Stay under client SEARCH_TIMEOUT_MS=5s (RTT + filter + one Overpass try).
        overpass_budget_s=2.5,
    )
    timings = dict(payload.get("timings") or {})
    timings["requestMs"] = round((_time.perf_counter() - t_req) * 1000, 2)
    payload["timings"] = timings
    return JSONResponse(payload)


@app.post("/api/routes/{route_id}/pois/preload")
def preload_route_pois(
    route_id: str,
    user: dict = Depends(require_route_planning_access),
) -> JSONResponse:
    """Ensure Search corridor cache is warm (call on route open / import)."""
    import time as _time

    route = routes_store.get_route(user["id"], route_id)
    if not route:
        raise HTTPException(status_code=404, detail="Route not found.")
    track = route.get("track") or route.get("points") or []
    from .analysis.route_pois import ensure_search_corridor

    t0 = _time.perf_counter()
    corridor = ensure_search_corridor(track, force_refresh=False)
    ms = (_time.perf_counter() - t0) * 1000
    return JSONResponse(
        {
            "ok": True,
            "fingerprint": corridor.get("fingerprint"),
            "poiCount": len(corridor.get("pois") or []),
            "corridorPadM": corridor.get("corridorPadM"),
            "bbox": corridor.get("bbox"),
            "timings": {"totalMs": round(ms, 2)},
            "cache": "hit" if ms < 500 else "built",
        }
    )


@app.patch("/api/routes/{route_id}")
async def patch_route(
    route_id: str,
    payload: dict = Body(...),
    user: dict = Depends(require_route_planning_access),
) -> JSONResponse:
    updated = routes_store.update_route(user["id"], route_id, payload)
    if not updated:
        raise HTTPException(status_code=404, detail="Route not found.")
    return JSONResponse(updated)


@app.delete("/api/routes/{route_id}")
def delete_route(route_id: str, user: dict = Depends(require_route_planning_access)) -> JSONResponse:
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


def _athlete_weight_kg(user: dict) -> float | None:
    """Body weight for W/kg — prefer user profile, else provider athlete weight. Never invent."""
    profile = user.get("weightKg")
    if profile is not None:
        try:
            w = float(profile)
            if 30.0 <= w <= 200.0:
                return round(w, 2)
        except (TypeError, ValueError):
            pass
    for conn in (user.get("providers") or {}).values():
        athlete = (conn or {}).get("athlete") or {}
        raw = athlete.get("weight")
        if raw is None:
            continue
        try:
            w = float(raw)
        except (TypeError, ValueError):
            continue
        if w > 0:
            return round(w, 2)
    return None


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
    # Share-screen enrichments (not baked into cached analysis).
    payload = store.get_ride_payload(user["id"], ride_id) or {}
    out = dict(report)
    out["source"] = payload.get("source") or "upload"
    out["athleteWeightKg"] = _athlete_weight_kg(user)
    return JSONResponse(out)


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
