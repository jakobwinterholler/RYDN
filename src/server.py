"""FastAPI server for the Ultra Roadbook Generator web UI."""

import asyncio
import json
import logging
import threading
from dataclasses import asdict
from typing import Any
from pathlib import Path

from fastapi import BackgroundTasks, Depends, FastAPI, File, Form, Header, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel, Field
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from climb_config import ClimbDetectionConfig, DEFAULT_CLIMB_DETECTION_CONFIG
from excel_export import export_roadbook
from pipeline import (
    analyze_gpx_upload,
    analyze_race_gpx,
    clear_race_cache,
    clear_session_cache,
    ensure_race_cache,
    get_race_cache,
    recalculate_climbs,
    roadbook_to_dict,
    update_climb_nicknames,
)
from app_settings import AppSettings, app_settings_store
from race_project import RaceSettings, race_store
from route_preview_render import get_preview_status, start_preview_generation, start_preview_prepare
from race_open_trace import race_open_trace
from auth.dependencies import get_bearer_token, get_optional_user, require_user, resolve_sync_user
from auth.jwt import AuthUser
from cloud.config import cloud_config
from cloud.race_sync import (
    CloudSyncError,
    add_companion_verifications,
    compare_desktop_companion,
    find_cloud_races_by_gpx_fingerprint,
    get_companion_bundle,
    list_companion_verifications,
    list_sync_races,
    push_all_local_races,
    push_race,
    regenerate_all_cloud_bundles,
    regenerate_cloud_bundle,
    review_companion_verification,
    soft_delete_race,
)
from companion_import import (
    find_local_duplicates,
    import_stage_catalog,
    run_companion_import,
)

PREVIEW_NO_CACHE_HEADERS = {
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
}
from settings_merge import effective_planning, effective_settings_payload
from poi_profile import DEFAULT_ULTRA_POI_PROFILE, PoiPlanningProfile, profile_catalog
from pipeline_watchdog import PipelineStalledError, StageWatchdog
from progress import ProgressReporter, pipeline_step_catalog
from surface_gpx_export import export_surface_validation_gpx
from race_gpx_export import (
    DEVICE_PROFILES,
    GpsGpxExportOptions,
    GpxExportQualityError,
    GpxTrackModifiedError,
    build_gpx_export_preview,
    export_race_gpx_for_gps,
    export_report_json,
)

PROJECT_ROOT = Path(__file__).resolve().parent.parent
FRONTEND_DIST = PROJECT_ROOT / "frontend" / "dist"
EXPORT_DIR = PROJECT_ROOT / "output"

EXCEL_PATH = EXPORT_DIR / "Roadbook.xlsx"
VALIDATION_GPX_PATH = EXPORT_DIR / "surface_validation.gpx"

app = FastAPI(title="Ultra Roadbook Generator", version="0.15")
logger = logging.getLogger(__name__)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5175",
        "http://127.0.0.1:5175",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "https://companion-flax.vercel.app",
        "https://companion-road-book.vercel.app",
    ],
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Gps-Export-Summary"],
)


def _account_payload(user: AuthUser | None) -> dict[str, Any]:
    storage = app_settings_store.storage_summary()
    return {
        "signed_in": user is not None,
        "email": user.email if user else None,
        "display_name": None,
        "cloud_sync_enabled": cloud_config.sync_enabled,
        "storage": storage,
    }


def _safe_push_race(user_id: str, race_id: str, access_token: str | None = None) -> None:
    try:
        result = push_race(user_id, race_id, access_token)
        logger.info(
            "Cloud push succeeded for race %s (user %s, revision %s, has_bundle=%s)",
            race_id,
            user_id,
            result.get("companion_revision"),
            result.get("has_bundle"),
        )
    except Exception:
        logger.exception("Background cloud push failed for race %s (user %s)", race_id, user_id)


def _schedule_cloud_sync(
    background_tasks: BackgroundTasks,
    user: AuthUser | None,
    race_id: str,
    access_token: str | None = None,
) -> None:
    if user and (cloud_config.sync_enabled or access_token):
        background_tasks.add_task(_safe_push_race, user.id, race_id, access_token)


def _require_session():
    from pipeline import get_session_cache

    cache = get_session_cache()
    if cache is None:
        raise HTTPException(status_code=400, detail="Generate a roadbook first.")
    return cache


def _require_race(race_id: str):
    try:
        return race_store.get_race(race_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Race not found.") from exc


def _effective_race_planning(race_id: str):
    app = app_settings_store.load()
    race = race_store.get_race(race_id)
    return effective_planning(app, race.settings)


def _race_cache(race_id: str):
    race = _require_race(race_id)
    planning = _effective_race_planning(race_id)
    try:
        return ensure_race_cache(
            race_id,
            gpx_path=race_store.get_gpx_path(race_id),
            poi_profile=planning.poi_profile,
            climb_nicknames=race.preparation.climb_nicknames,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": "0.3.0"}


class AppSettingsBody(BaseModel):
    planning: dict | None = None
    analysis: dict | None = None
    appearance: dict | None = None


class RaceSettingsBody(BaseModel):
    use_app_defaults: bool | None = None
    planning: dict | None = None


@app.get("/api/settings")
def get_app_settings(user: AuthUser | None = Depends(get_optional_user)) -> dict:
    app = app_settings_store.load()
    return {
        **effective_settings_payload(app, None, scope="app"),
        "account": _account_payload(user),
    }


@app.patch("/api/settings")
def patch_app_settings(body: AppSettingsBody, user: AuthUser | None = Depends(get_optional_user)) -> dict:
    from app_settings import AnalysisDefaults, AppearanceDefaults, PlanningDefaults

    current = app_settings_store.load()
    if body.planning is not None:
        merged = {**current.planning.to_dict(), **body.planning}
        current.planning = PlanningDefaults.from_dict(merged)
    if body.analysis is not None:
        merged = {**current.analysis.to_dict(), **body.analysis}
        current.analysis = AnalysisDefaults.from_dict(merged)
    if body.appearance is not None:
        merged = {**current.appearance.to_dict(), **body.appearance}
        current.appearance = AppearanceDefaults.from_dict(merged)
    app_settings_store.save(current)
    return {
        **effective_settings_payload(current, None, scope="app"),
        "account": _account_payload(user),
    }


@app.get("/api/races/{race_id}/settings")
def get_race_settings(race_id: str, user: AuthUser | None = Depends(get_optional_user)) -> dict:
    race = _require_race(race_id)
    app = app_settings_store.load()
    return {
        **effective_settings_payload(app, race.settings, scope="race"),
        "race_id": race_id,
        "race_name": race.meta.name,
        "has_analysis": race_store.has_analysis(race_id),
        "account": _account_payload(user),
    }


@app.patch("/api/races/{race_id}/settings")
def patch_race_settings(race_id: str, body: RaceSettingsBody) -> dict:
    race = _require_race(race_id)
    settings = race.settings
    if body.use_app_defaults is not None:
        settings.use_app_defaults = body.use_app_defaults
    if body.planning is not None:
        planning = body.planning
        if "poi_profile" in planning:
            settings.poi_profile = PoiPlanningProfile.from_dict(planning["poi_profile"])
        if "climb_sensitivity" in planning:
            settings.climb_sensitivity = planning["climb_sensitivity"]
        if "climb_config" in planning:
            settings.climb_config = ClimbDetectionConfig.from_dict(planning["climb_config"])
        if "preferred_stage_length_km" in planning:
            settings.preferred_stage_length_km = int(planning["preferred_stage_length_km"])
        if "max_gap_without_resupply_km" in planning:
            settings.max_gap_without_resupply_km = int(planning["max_gap_without_resupply_km"])
        if "default_arrival_time_window" in planning:
            settings.default_arrival_time_window = planning["default_arrival_time_window"]
        if "default_zone_density" in planning:
            settings.default_zone_density = planning["default_zone_density"]
        settings.use_app_defaults = False
    race_store.update_settings(race_id, settings)
    return get_race_settings(race_id)


class ClimbDetectionConfigBody(BaseModel):
    smoothing_window_m: float = Field(default=60, ge=10, le=500)
    rolling_gradient_window_m: float = Field(default=100, ge=20, le=1000)
    gradient_threshold_pct: float = Field(default=1.0, ge=0.1, le=10)
    meaningful_descent_threshold_m: float = Field(default=50, ge=10, le=300)
    min_elevation_gain_m: float = Field(default=50, ge=10, le=500)
    min_average_gradient_pct: float = Field(default=3.0, ge=0.5, le=15)


@app.get("/api/climbs/config")
def climb_config_defaults() -> dict:
    return {"config": DEFAULT_CLIMB_DETECTION_CONFIG.to_dict()}


@app.post("/api/climbs/recalculate")
def recalculate_climbs_endpoint(body: ClimbDetectionConfigBody) -> dict:
    """Re-run climb detection on the cached route track."""
    try:
        config = ClimbDetectionConfig(
            smoothing_window_m=body.smoothing_window_m,
            rolling_gradient_window_m=body.rolling_gradient_window_m,
            gradient_threshold_pct=body.gradient_threshold_pct,
            meaningful_descent_threshold_m=body.meaningful_descent_threshold_m,
            min_elevation_gain_m=body.min_elevation_gain_m,
            min_average_gradient_pct=body.min_average_gradient_pct,
        )
        artifacts = recalculate_climbs(config)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "climbs": [asdict(climb) for climb in artifacts.roadbook.climbs],
        "climb_candidates": [
            asdict(candidate) for candidate in artifacts.roadbook.climb_candidates
        ],
        "summary": {"climb_count": artifacts.roadbook.summary.climb_count},
        "config": config.to_dict(),
    }


class ClimbNicknamesBody(BaseModel):
    nicknames: dict[str, str]


@app.post("/api/climbs/nicknames")
def save_climb_nicknames(body: ClimbNicknamesBody) -> dict:
    try:
        artifacts = update_climb_nicknames(body.nicknames)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "climbs": [asdict(climb) for climb in artifacts.roadbook.climbs],
    }


@app.get("/api/climbs/debug")
def climb_debug() -> dict:
    cache = _require_session()
    return {
        "climbs": [asdict(climb) for climb in cache.roadbook.climbs],
        "candidates": [asdict(candidate) for candidate in cache.roadbook.climb_candidates],
    }


@app.get("/api/progress/steps")
def progress_steps() -> dict:
    """Return the registered analysis pipeline steps for the loading UI."""
    return {"steps": pipeline_step_catalog()}


# Generous cap for very long ultra routes; still bounds memory per request and
# blocks oversized/malicious uploads. Matches the 50 MB companion asset bucket
# with headroom for uncompressed GPX text.
MAX_GPX_UPLOAD_BYTES = 60 * 1024 * 1024


async def _read_gpx_upload(file: UploadFile) -> bytes:
    """Read an uploaded GPX with a hard size cap so a single request can't
    exhaust server memory. Reads in 1 MB chunks and aborts once the cap is hit."""
    size_hint = getattr(file, "size", None)
    if isinstance(size_hint, int) and size_hint > MAX_GPX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="GPX file is too large (max 60 MB).")
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_GPX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="GPX file is too large (max 60 MB).")
        chunks.append(chunk)
    return b"".join(chunks)


def _validate_gpx_upload(file: UploadFile, file_bytes: bytes) -> None:
    if not file.filename or not file.filename.lower().endswith(".gpx"):
        raise HTTPException(status_code=400, detail="Please upload a .gpx file.")
    if not file_bytes:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")


def _parse_poi_profile(raw: str | None) -> PoiPlanningProfile:
    if not raw:
        return DEFAULT_ULTRA_POI_PROFILE
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Invalid poi_profile JSON.") from exc
    return PoiPlanningProfile.from_dict(payload)


@app.get("/api/poi/profile/default")
def poi_profile_default() -> dict:
    return {
        "profile": DEFAULT_ULTRA_POI_PROFILE.to_dict(),
        "catalog": profile_catalog(),
    }


# --- Race projects (local) ---


class RaceRenameBody(BaseModel):
    name: str


class RaceArchiveBody(BaseModel):
    archived: bool


class PreparationProgressBody(BaseModel):
    progress: dict[str, bool] = Field(default_factory=dict)
    verified_stops: dict[str, dict[str, Any]] | None = None


class PromoteDiscoveryBody(BaseModel):
    suggested_stop: dict[str, Any]
    verified_stop: dict[str, Any] | None = None


@app.get("/api/races")
def list_races(include_archived: bool = False) -> dict:
    return {
        "races": [
            summary.to_dict()
            for summary in race_store.list_races(include_archived=include_archived)
        ]
    }


@app.post("/api/races")
async def create_race(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    name: str | None = Form(default=None),
    user: AuthUser | None = Depends(get_optional_user),
    access_token: str | None = Depends(get_bearer_token),
) -> dict:
    file_bytes = await _read_gpx_upload(file)
    _validate_gpx_upload(file, file_bytes)
    race = race_store.create_race(filename=file.filename, gpx_bytes=file_bytes, name=name)
    _schedule_cloud_sync(background_tasks, user, race.id, access_token)
    return {"race": race_store.get_summary(race.id).to_dict()}


@app.get("/api/races/{race_id}")
def get_race(race_id: str) -> dict:
    race_open_trace("open_race.api.get_race.start", race_id=race_id)
    race = _require_race(race_id)
    race_store.touch_opened(race_id)
    race_open_trace("open_race.api.get_race.done", race_id=race_id)
    return {
        "race": race_store.get_summary(race_id).to_dict(),
        "settings": race.settings.to_dict(),
        "preparation": race.preparation.to_dict(),
        "exports": [record.to_dict() for record in race.exports],
    }


@app.patch("/api/races/{race_id}")
def patch_race(
    race_id: str,
    body: RaceRenameBody,
    background_tasks: BackgroundTasks,
    user: AuthUser | None = Depends(get_optional_user),
    access_token: str | None = Depends(get_bearer_token),
) -> dict:
    _require_race(race_id)
    race = race_store.rename_race(race_id, body.name)
    _schedule_cloud_sync(background_tasks, user, race_id, access_token)
    return {"race": race_store.get_summary(race.id).to_dict()}


@app.patch("/api/races/{race_id}/preparation")
def patch_race_preparation(
    race_id: str,
    body: PreparationProgressBody,
    background_tasks: BackgroundTasks,
    user: AuthUser | None = Depends(get_optional_user),
    access_token: str | None = Depends(get_bearer_token),
) -> dict:
    _require_race(race_id)
    race = race_store.update_preparation(
        race_id,
        progress=body.progress if body.progress else None,
        verified_stops=body.verified_stops,
    )
    _schedule_cloud_sync(background_tasks, user, race_id, access_token)
    return {
        "preparation": race.preparation.to_dict(),
        "race": race_store.get_summary(race_id).to_dict(),
    }


@app.post("/api/races/{race_id}/promote-discovery")
def promote_discovered_stop(
    race_id: str,
    body: PromoteDiscoveryBody,
    background_tasks: BackgroundTasks,
    user: AuthUser | None = Depends(get_optional_user),
    access_token: str | None = Depends(get_bearer_token),
) -> dict:
    _require_race(race_id)
    try:
        roadbook = race_store.promote_discovered_stop(
            race_id,
            body.suggested_stop,
            verified_stop=body.verified_stop,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    _schedule_cloud_sync(background_tasks, user, race_id, access_token)
    return {"roadbook": roadbook}


@app.delete("/api/races/{race_id}")
def delete_race(
    race_id: str,
    background_tasks: BackgroundTasks,
    user: AuthUser | None = Depends(get_optional_user),
    access_token: str | None = Depends(get_bearer_token),
) -> dict[str, str]:
    _require_race(race_id)
    clear_race_cache(race_id)
    race_store.delete_race(race_id)
    if user and (cloud_config.sync_enabled or access_token):
        background_tasks.add_task(soft_delete_race, user.id, race_id, access_token)
    return {"status": "deleted"}


@app.post("/api/races/{race_id}/duplicate")
def duplicate_race(
    race_id: str,
    background_tasks: BackgroundTasks,
    user: AuthUser | None = Depends(get_optional_user),
    access_token: str | None = Depends(get_bearer_token),
) -> dict:
    _require_race(race_id)
    race = race_store.duplicate_race(race_id)
    _schedule_cloud_sync(background_tasks, user, race.id, access_token)
    return {"race": race_store.get_summary(race.id).to_dict()}


@app.patch("/api/races/{race_id}/archive")
def archive_race(
    race_id: str,
    body: RaceArchiveBody,
    background_tasks: BackgroundTasks,
    user: AuthUser | None = Depends(get_optional_user),
    access_token: str | None = Depends(get_bearer_token),
) -> dict:
    _require_race(race_id)
    race = race_store.set_archived(race_id, body.archived)
    _schedule_cloud_sync(background_tasks, user, race_id, access_token)
    return {"race": race_store.get_summary(race.id).to_dict()}


@app.get("/api/races/{race_id}/roadbook")
def get_race_roadbook(race_id: str) -> dict:
    race_open_trace("open_race.api.get_roadbook.start", race_id=race_id)
    _require_race(race_id)
    roadbook = race_store.load_analysis(race_id)
    if roadbook is None:
        race_open_trace("open_race.api.get_roadbook.missing", race_id=race_id)
        raise HTTPException(status_code=404, detail="This race has not been analyzed yet.")
    race_open_trace("open_race.api.get_roadbook.done", race_id=race_id)
    return roadbook


def _run_race_analysis_with_progress(
    race_id: str,
    loop: asyncio.AbstractEventLoop,
    queue: asyncio.Queue,
) -> None:
    def emit(event: dict) -> None:
        asyncio.run_coroutine_threadsafe(queue.put(event), loop)

    watchdog = StageWatchdog()
    watchdog.start()
    reporter = ProgressReporter(callback=emit, watchdog=watchdog)

    try:
        race = race_store.get_race(race_id)
        gpx_path = race_store.get_gpx_path(race_id)
        planning = _effective_race_planning(race_id)
        artifacts = analyze_race_gpx(
            race_id,
            gpx_path,
            progress=reporter,
            poi_profile=planning.poi_profile,
            climb_nicknames=race.preparation.climb_nicknames,
        )
        roadbook = roadbook_to_dict(artifacts.roadbook)
        race_store.save_analysis(race_id, roadbook)
        emit({"type": "complete", "data": roadbook})
    except PipelineStalledError as exc:
        emit({"type": "error", "detail": str(exc)})
    except FileNotFoundError as exc:
        emit({"type": "error", "detail": str(exc)})
    except ValueError as exc:
        emit({"type": "error", "detail": str(exc)})
    except RuntimeError as exc:
        emit({"type": "error", "detail": str(exc)})
    except Exception as exc:  # pragma: no cover
        emit({"type": "error", "detail": f"Analysis failed: {exc}"})
    finally:
        watchdog.stop()
        asyncio.run_coroutine_threadsafe(queue.put(None), loop)


@app.post("/api/races/{race_id}/analyze")
def analyze_race(
    race_id: str,
    background_tasks: BackgroundTasks,
    user: AuthUser | None = Depends(get_optional_user),
    access_token: str | None = Depends(get_bearer_token),
) -> dict:
    _require_race(race_id)
    race = race_store.get_race(race_id)
    gpx_path = race_store.get_gpx_path(race_id)
    planning = _effective_race_planning(race_id)
    try:
        artifacts = analyze_race_gpx(
            race_id,
            gpx_path,
            poi_profile=planning.poi_profile,
            climb_nicknames=race.preparation.climb_nicknames,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    roadbook = roadbook_to_dict(artifacts.roadbook)
    race_store.save_analysis(race_id, roadbook)
    _schedule_cloud_sync(background_tasks, user, race_id, access_token)
    return roadbook


@app.post("/api/races/{race_id}/analyze/stream")
async def analyze_race_stream(
    race_id: str,
    background_tasks: BackgroundTasks,
    user: AuthUser | None = Depends(get_optional_user),
    access_token: str | None = Depends(get_bearer_token),
) -> StreamingResponse:
    _require_race(race_id)

    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()
    thread = threading.Thread(
        target=_run_race_analysis_with_progress,
        args=(race_id, loop, queue),
        daemon=True,
    )
    thread.start()

    async def event_stream():
        analysis_ok = False
        while True:
            event = await queue.get()
            if event is None:
                break
            if isinstance(event, dict) and event.get("type") == "complete":
                analysis_ok = True
            yield f"data: {json.dumps(event)}\n\n"
        if analysis_ok:
            _schedule_cloud_sync(background_tasks, user, race_id, access_token)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/races/{race_id}/climbs/recalculate")
def recalculate_race_climbs(race_id: str, body: ClimbDetectionConfigBody) -> dict:
    _race_cache(race_id)
    try:
        config = ClimbDetectionConfig(
            smoothing_window_m=body.smoothing_window_m,
            rolling_gradient_window_m=body.rolling_gradient_window_m,
            gradient_threshold_pct=body.gradient_threshold_pct,
            meaningful_descent_threshold_m=body.meaningful_descent_threshold_m,
            min_elevation_gain_m=body.min_elevation_gain_m,
            min_average_gradient_pct=body.min_average_gradient_pct,
        )
        artifacts = recalculate_climbs(config, race_id=race_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    roadbook = roadbook_to_dict(artifacts.roadbook)
    race_store.save_analysis(race_id, roadbook)
    return {
        "climbs": roadbook["climbs"],
        "climb_candidates": roadbook["climb_candidates"],
        "summary": {"climb_count": roadbook["summary"]["climb_count"]},
        "config": config.to_dict(),
    }


@app.post("/api/races/{race_id}/climbs/nicknames")
def save_race_climb_nicknames(
    race_id: str,
    body: ClimbNicknamesBody,
    background_tasks: BackgroundTasks,
    user: AuthUser | None = Depends(get_optional_user),
    access_token: str | None = Depends(get_bearer_token),
) -> dict:
    _race_cache(race_id)
    try:
        artifacts = update_climb_nicknames(body.nicknames, race_id=race_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    race_store.update_preparation(race_id, climb_nicknames=body.nicknames)
    _schedule_cloud_sync(background_tasks, user, race_id, access_token)
    return {"climbs": [asdict(climb) for climb in artifacts.roadbook.climbs]}


@app.get("/api/races/{race_id}/preview/status")
def get_route_preview_status(race_id: str) -> dict:
    _require_race(race_id)
    return get_preview_status(race_id)


@app.post("/api/races/{race_id}/preview/generate/stream")
async def generate_route_preview_stream(race_id: str) -> StreamingResponse:
    _require_race(race_id)
    if not race_store.has_analysis(race_id):
        raise HTTPException(status_code=400, detail="Analyze this race before generating a route preview.")

    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()

    def emit(event: dict) -> None:
        asyncio.run_coroutine_threadsafe(queue.put(event), loop)

    try:
        start_preview_generation(race_id, emit)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    async def event_stream():
        while True:
            event = await queue.get()
            if event is None:
                break
            yield f"data: {json.dumps(event)}\n\n"
            if event.get("type") in {"complete", "error"}:
                break
        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/api/races/{race_id}/preview/runtime")
def get_route_preview_runtime(race_id: str) -> FileResponse:
    _require_race(race_id)
    runtime_path = race_store.preview_runtime_path(race_id)
    if not runtime_path.is_file():
        raise HTTPException(status_code=404, detail="Route preview runtime has not been prepared yet.")
    return FileResponse(
        runtime_path,
        media_type="application/json",
        filename="runtime.json",
        headers=PREVIEW_NO_CACHE_HEADERS,
    )


@app.get("/api/races/{race_id}/preview/cache/{asset_path:path}")
def get_route_preview_cache_asset(race_id: str, asset_path: str) -> FileResponse:
    _require_race(race_id)
    cache_dir = race_store.preview_cache_dir(race_id).resolve()
    requested = (cache_dir / asset_path).resolve()
    if cache_dir not in requested.parents and requested != cache_dir:
        raise HTTPException(status_code=404, detail="Cache asset not found.")
    if not requested.is_file():
        raise HTTPException(status_code=404, detail="Cache asset not found.")
    media_types = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".json": "application/json",
        ".bin": "application/octet-stream",
    }
    return FileResponse(
        requested,
        media_type=media_types.get(requested.suffix.lower(), "application/octet-stream"),
        headers=PREVIEW_NO_CACHE_HEADERS,
    )


@app.post("/api/races/{race_id}/preview/prepare/stream")
async def prepare_route_preview_stream(race_id: str) -> StreamingResponse:
    _require_race(race_id)
    if not race_store.has_analysis(race_id):
        raise HTTPException(status_code=400, detail="Analyze this race before preparing a route preview.")

    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()

    def emit(event: dict) -> None:
        asyncio.run_coroutine_threadsafe(queue.put(event), loop)

    try:
        start_preview_prepare(race_id, emit)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    async def event_stream():
        while True:
            event = await queue.get()
            yield f"data: {json.dumps(event)}\n\n"
            if event.get("type") in {"complete", "error", "done"}:
                break

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/api/races/{race_id}/preview/video")
def get_route_preview_video(race_id: str) -> FileResponse:
    _require_race(race_id)
    video_path = race_store.preview_video_path(race_id)
    if not video_path.is_file():
        raise HTTPException(status_code=404, detail="Route preview video has not been generated yet.")
    return FileResponse(
        video_path,
        media_type="video/mp4",
        filename="route-preview.mp4",
        headers=PREVIEW_NO_CACHE_HEADERS,
    )


@app.get("/api/races/{race_id}/exports/excel")
def export_race_excel(race_id: str) -> FileResponse:
    cache = _race_cache(race_id)
    export_path = race_store.export_path(race_id, "Roadbook.xlsx")
    export_path.parent.mkdir(parents=True, exist_ok=True)
    export_roadbook(cache.climbs_with_gradients, export_path, nicknames=cache.climb_nicknames)
    race_store.record_export(race_id, export_type="excel", filename="Roadbook.xlsx")
    return FileResponse(
        export_path,
        filename="Roadbook.xlsx",
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@app.get("/api/races/{race_id}/exports/validation-gpx")
def export_race_validation_gpx(race_id: str) -> FileResponse:
    cache = _race_cache(race_id)
    export_path = race_store.export_path(race_id, "surface_validation.gpx")
    export_path.parent.mkdir(parents=True, exist_ok=True)
    export_surface_validation_gpx(cache.track, cache.surface_dataset, export_path)
    race_store.record_export(race_id, export_type="validation_gpx", filename="surface_validation.gpx")
    return FileResponse(
        export_path,
        filename="surface_validation.gpx",
        media_type="application/gpx+xml",
    )


@app.get("/api/races/{race_id}/exports/gps-gpx/preview")
def preview_race_gps_gpx(
    race_id: str,
    device: str = Query("coros"),
    verified_only: bool = Query(True),
    include_high_confidence: bool = Query(False),
    include_alternatives: bool = Query(False),
    include_optional: bool = Query(False),
) -> dict:
    if device not in DEVICE_PROFILES:
        raise HTTPException(status_code=400, detail=f"Unsupported device profile: {device}")

    race = race_store.get_race(race_id)
    if not race.meta.has_analysis:
        raise HTTPException(status_code=400, detail="Analyze the race before previewing GPS GPX export.")

    roadbook = race_store.load_analysis(race_id)
    if not roadbook:
        raise HTTPException(status_code=400, detail="Race analysis not found.")

    gpx_path = race_store.get_gpx_path(race_id)
    if not gpx_path.is_file():
        raise HTTPException(status_code=404, detail="Original GPX file not found.")

    options = GpsGpxExportOptions(
        device_profile=device,
        verified_only=verified_only,
        include_high_confidence=include_high_confidence,
        include_alternatives=include_alternatives,
        include_optional=include_optional,
    )
    verified_stops = {
        key: record.to_dict()
        for key, record in race.preparation.verified_stops.items()
    }
    return build_gpx_export_preview(
        original_gpx_path=gpx_path,
        roadbook=roadbook,
        verified_stops=verified_stops,
        options=options,
    )


@app.get("/api/races/{race_id}/exports/gps-gpx")
def export_race_gps_gpx(
    race_id: str,
    device: str = Query("coros"),
    verified_only: bool = Query(True),
    include_high_confidence: bool = Query(False),
    include_alternatives: bool = Query(False),
    include_optional: bool = Query(False),
) -> FileResponse:
    if device not in DEVICE_PROFILES:
        raise HTTPException(status_code=400, detail=f"Unsupported device profile: {device}")

    race = race_store.get_race(race_id)
    if not race.meta.has_analysis:
        raise HTTPException(status_code=400, detail="Analyze the race before exporting GPS GPX.")

    roadbook = race_store.load_analysis(race_id)
    if not roadbook:
        raise HTTPException(status_code=400, detail="Race analysis not found.")

    gpx_path = race_store.get_gpx_path(race_id)
    if not gpx_path.is_file():
        raise HTTPException(status_code=404, detail="Original GPX file not found.")

    slug = race.meta.name.strip().replace(" ", "-") or "race"
    filename = f"{slug}-gps-{device}.gpx"
    export_path = race_store.export_path(race_id, filename)
    options = GpsGpxExportOptions(
        device_profile=device,
        verified_only=verified_only,
        include_high_confidence=include_high_confidence,
        include_alternatives=include_alternatives,
        include_optional=include_optional,
    )

    try:
        verified_stops = {
            key: record.to_dict()
            for key, record in race.preparation.verified_stops.items()
        }
        report = export_race_gpx_for_gps(
            original_gpx_path=gpx_path,
            roadbook=roadbook,
            verified_stops=verified_stops,
            output_path=export_path,
            options=options,
        )
    except GpxTrackModifiedError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except GpxExportQualityError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    race_store.record_export(race_id, export_type="gps_gpx", filename=filename)
    return FileResponse(
        export_path,
        filename=filename,
        media_type="application/gpx+xml",
        headers={"X-Gps-Export-Summary": export_report_json(report)},
    )


def _run_analysis_with_progress(
    file_name: str,
    file_bytes: bytes,
    loop: asyncio.AbstractEventLoop,
    queue: asyncio.Queue,
    poi_profile: PoiPlanningProfile,
) -> None:
    def emit(event: dict) -> None:
        asyncio.run_coroutine_threadsafe(queue.put(event), loop)

    watchdog = StageWatchdog()
    watchdog.start()
    reporter = ProgressReporter(callback=emit, watchdog=watchdog)

    try:
        artifacts = analyze_gpx_upload(
            file_name,
            file_bytes,
            progress=reporter,
            poi_profile=poi_profile,
        )
        emit({"type": "complete", "data": roadbook_to_dict(artifacts.roadbook)})
    except PipelineStalledError as exc:
        emit({"type": "error", "detail": str(exc)})
    except FileNotFoundError as exc:
        emit({"type": "error", "detail": str(exc)})
    except ValueError as exc:
        emit({"type": "error", "detail": str(exc)})
    except RuntimeError as exc:
        emit({"type": "error", "detail": str(exc)})
    except Exception as exc:  # pragma: no cover - defensive fallback
        emit({"type": "error", "detail": f"Analysis failed: {exc}"})
    finally:
        watchdog.stop()
        asyncio.run_coroutine_threadsafe(queue.put(None), loop)


@app.post("/api/generate")
async def generate_roadbook(
    file: UploadFile = File(...),
    poi_profile: str | None = Form(default=None),
) -> dict:
    """Analyze an uploaded GPX file and return roadbook data as JSON."""
    file_bytes = await _read_gpx_upload(file)
    _validate_gpx_upload(file, file_bytes)
    profile = _parse_poi_profile(poi_profile)

    try:
        artifacts = analyze_gpx_upload(file.filename, file_bytes, poi_profile=profile)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return roadbook_to_dict(artifacts.roadbook)


@app.post("/api/generate/stream")
async def generate_roadbook_stream(
    file: UploadFile = File(...),
    poi_profile: str | None = Form(default=None),
) -> StreamingResponse:
    """Analyze a GPX upload and stream real pipeline progress events."""
    file_bytes = await _read_gpx_upload(file)
    _validate_gpx_upload(file, file_bytes)
    profile = _parse_poi_profile(poi_profile)

    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()
    thread = threading.Thread(
        target=_run_analysis_with_progress,
        args=(file.filename, file_bytes, loop, queue, profile),
        daemon=True,
    )
    thread.start()

    async def event_stream():
        while True:
            event = await queue.get()
            if event is None:
                break
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/session/clear")
def clear_session() -> dict[str, str]:
    """Clear cached analysis data (used when loading a new route)."""
    clear_session_cache()
    return {"status": "cleared"}


@app.get("/api/export/excel")
def export_excel() -> FileResponse:
    """Export the current roadbook as an Excel file."""
    cache = _require_session()
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    export_roadbook(cache.climbs_with_gradients, EXCEL_PATH, nicknames=cache.climb_nicknames)
    return FileResponse(
        EXCEL_PATH,
        filename="Roadbook.xlsx",
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@app.get("/api/export/validation-gpx")
def export_validation_gpx() -> FileResponse:
    """Export the current route as a colored surface-validation GPX."""
    cache = _require_session()
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    export_surface_validation_gpx(cache.track, cache.surface_dataset, VALIDATION_GPX_PATH)
    return FileResponse(
        VALIDATION_GPX_PATH,
        filename="surface_validation.gpx",
        media_type="application/gpx+xml",
    )


# --- Cloud sync (Companion + desktop background upload) ---


class SyncPushBody(BaseModel):
    race_id: str
    user_id: str | None = None


class SyncPushAllBody(BaseModel):
    user_id: str | None = None


class CompanionVerificationsBody(BaseModel):
    verifications: list[dict[str, Any]] = Field(default_factory=list)


class CompanionVerificationReviewBody(BaseModel):
    race_id: str
    action: str


@app.get("/api/auth/me")
def auth_me(user: AuthUser = Depends(require_user)) -> dict:
    return {"id": user.id, "email": user.email}


@app.get("/api/sync/races")
def sync_list_races(
    user: AuthUser = Depends(require_user),
    access_token: str | None = Depends(get_bearer_token),
) -> dict:
    try:
        races = list_sync_races(user.id, access_token)
    except CloudSyncError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {
        "races": [
            {
                "id": race["id"],
                "name": race["name"],
                "distance_km": race.get("distance_km"),
                "elevation_gain_m": race.get("elevation_gain_m"),
                "companion_revision": race.get("companion_revision") or 0,
                "updated_at": race.get("updated_at"),
                "analyzed_at": race.get("analyzed_at"),
                "has_bundle": bool(race.get("has_bundle")),
                "bundle_checksum": race.get("bundle_checksum"),
                "bundle_schema_version": race.get("bundle_schema_version"),
                "significant_climb_count": race.get("significant_climb_count"),
                "gpx_fingerprint": race.get("gpx_fingerprint"),
            }
            for race in races
        ]
    }


@app.get("/api/sync/races/{race_id}/compare")
def sync_compare_race(
    race_id: str,
    user: AuthUser = Depends(require_user),
    access_token: str | None = Depends(get_bearer_token),
) -> dict:
    _require_race(race_id)
    try:
        return compare_desktop_companion(user.id, race_id, access_token)
    except CloudSyncError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/api/sync/races/{race_id}/bundle")
def sync_get_bundle(
    race_id: str,
    user: AuthUser = Depends(require_user),
    access_token: str | None = Depends(get_bearer_token),
) -> JSONResponse:
    try:
        bundle = get_companion_bundle(user.id, race_id, access_token)
    except CloudSyncError as exc:
        message = str(exc)
        status = 404 if "not found" in message.lower() or "not been analyzed" in message.lower() else 502
        raise HTTPException(status_code=status, detail=message) from exc
    checksum = bundle.get("bundleChecksum") or ""
    revision = bundle.get("revision") or bundle.get("bundle_version") or 0
    return JSONResponse(
        content=bundle,
        headers={
            **PREVIEW_NO_CACHE_HEADERS,
            "ETag": f'"{revision}-{checksum[:16]}"' if checksum else f'"{revision}"',
        },
    )


@app.post("/api/sync/races/{race_id}/regenerate-bundle")
def sync_regenerate_bundle(
    race_id: str,
    user: AuthUser = Depends(require_user),
    access_token: str | None = Depends(get_bearer_token),
) -> dict:
    try:
        return regenerate_cloud_bundle(user.id, race_id, access_token)
    except CloudSyncError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/api/sync/regenerate-all-bundles")
def sync_regenerate_all_bundles(
    user: AuthUser = Depends(require_user),
    access_token: str | None = Depends(get_bearer_token),
) -> dict:
    try:
        return regenerate_all_cloud_bundles(user.id, access_token)
    except CloudSyncError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/api/sync/races/{race_id}/gpx")
def sync_get_original_gpx(race_id: str, user: AuthUser = Depends(require_user)) -> FileResponse:
    _require_race(race_id)
    gpx_path = race_store.get_gpx_path(race_id)
    if not gpx_path.is_file():
        raise HTTPException(status_code=404, detail="Original GPX file not found.")
    return FileResponse(
        gpx_path,
        filename=gpx_path.name,
        media_type="application/gpx+xml",
    )


@app.get("/api/sync/import-gpx/stages")
def sync_import_gpx_stages() -> dict:
    return {"stages": import_stage_catalog()}


@app.get("/api/sync/import-gpx/duplicates")
def sync_import_gpx_duplicates(
    fingerprint: str = Query(..., min_length=8, max_length=64),
    user: AuthUser = Depends(require_user),
    access_token: str | None = Depends(get_bearer_token),
) -> dict:
    local_matches = [match.to_dict() for match in find_local_duplicates(fingerprint)]
    cloud_matches: list[dict[str, Any]] = []
    try:
        cloud_matches = find_cloud_races_by_gpx_fingerprint(user.id, fingerprint, access_token)
    except CloudSyncError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    seen: set[str] = set()
    matches: list[dict[str, Any]] = []
    for entry in [*local_matches, *cloud_matches]:
        race_id = str(entry.get("id") or entry.get("race_id") or "")
        if not race_id or race_id in seen:
            continue
        seen.add(race_id)
        matches.append(
            {
                "id": race_id,
                "name": entry.get("name"),
                "distance_km": entry.get("distance_km"),
                "elevation_gain_m": entry.get("elevation_gain_m"),
                "updated_at": entry.get("updated_at"),
                "source": "local" if race_id in {m["id"] for m in local_matches} else "cloud",
            }
        )
    return {"fingerprint": fingerprint, "matches": matches}


@app.post("/api/sync/import-gpx")
async def sync_import_gpx(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    name: str | None = Form(default=None),
    conflict_action: str = Form(default="create"),
    replace_race_id: str | None = Form(default=None),
    user: AuthUser = Depends(require_user),
    access_token: str | None = Depends(get_bearer_token),
) -> StreamingResponse:
    file_bytes = await _read_gpx_upload(file)
    _validate_gpx_upload(file, file_bytes)
    if conflict_action not in {"create", "replace"}:
        raise HTTPException(status_code=400, detail="conflict_action must be create or replace.")

    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()
    thread = threading.Thread(
        target=run_companion_import,
        kwargs={
            "filename": file.filename or "route.gpx",
            "gpx_bytes": file_bytes,
            "name": name,
            "conflict_action": conflict_action,  # type: ignore[arg-type]
            "replace_race_id": replace_race_id,
            "loop": loop,
            "queue": queue,
        },
        daemon=True,
    )
    thread.start()

    async def event_stream():
        import_ok = False
        race_id: str | None = None
        while True:
            event = await queue.get()
            if event is None:
                break
            if isinstance(event, dict):
                if event.get("type") == "complete":
                    import_ok = True
                    race_id = str(event.get("race_id") or "")
                yield f"data: {json.dumps(event)}\n\n"
        if import_ok and race_id:
            try:
                sync_result = push_race(user.id, race_id, access_token)
                yield f"data: {json.dumps({'type': 'synced', 'sync': sync_result})}\n\n"
            except Exception as exc:
                logger.exception("Cloud push after companion import failed for race %s", race_id)
                yield f"data: {json.dumps({'type': 'sync_warning', 'detail': str(exc)})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/sync/push")
def sync_push_race(
    body: SyncPushBody,
    user: AuthUser = Depends(require_user),
    access_token: str | None = Depends(get_bearer_token),
) -> dict:
    _require_race(body.race_id)
    try:
        return push_race(user.id, body.race_id, access_token)
    except CloudSyncError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/api/sync/push-now")
def sync_push_race_now(
    body: SyncPushBody,
    request: Request,
    authorization: str | None = Header(default=None),
    access_token: str | None = Depends(get_bearer_token),
) -> dict:
    user = resolve_sync_user(request, authorization, body.user_id)
    _require_race(body.race_id)
    try:
        return push_race(user.id, body.race_id, access_token)
    except CloudSyncError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/api/sync/push-all")
def sync_push_all(
    request: Request,
    body: SyncPushAllBody | None = None,
    authorization: str | None = Header(default=None),
    access_token: str | None = Depends(get_bearer_token),
) -> dict:
    user = resolve_sync_user(request, authorization, body.user_id if body else None)
    try:
        return push_all_local_races(user.id, access_token)
    except CloudSyncError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/api/sync/verifications")
def sync_submit_verifications(
    body: CompanionVerificationsBody,
    user: AuthUser = Depends(require_user),
    access_token: str | None = Depends(get_bearer_token),
) -> dict:
    try:
        accepted = add_companion_verifications(user.id, body.verifications, access_token)
    except CloudSyncError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"accepted": accepted}


@app.get("/api/sync/verifications")
def sync_list_verifications(
    race_id: str,
    status: str = "pending",
    user: AuthUser = Depends(require_user),
    access_token: str | None = Depends(get_bearer_token),
) -> dict:
    if status not in {"pending", "history", "all"}:
        raise HTTPException(status_code=400, detail="status must be pending, history, or all")
    try:
        verifications = list_companion_verifications(
            user.id,
            race_id,
            access_token,
            status=status,
        )
    except CloudSyncError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"verifications": verifications}


@app.post("/api/sync/verifications/{verification_id}/review")
def sync_review_verification(
    verification_id: str,
    body: CompanionVerificationReviewBody,
    background_tasks: BackgroundTasks,
    user: AuthUser = Depends(require_user),
    access_token: str | None = Depends(get_bearer_token),
) -> dict:
    if body.action not in {"accept", "reject"}:
        raise HTTPException(status_code=400, detail="action must be accept or reject")
    try:
        ok = review_companion_verification(
            user.id,
            body.race_id,
            verification_id,
            action=body.action,
            access_token=access_token,
        )
    except CloudSyncError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    if not ok:
        raise HTTPException(status_code=404, detail="Verification not found.")
    background_tasks.add_task(_safe_push_race, user.id, body.race_id, access_token)
    return {"status": body.action, "verification_id": verification_id}


# Serve the built React app when available (production / single-server mode).
if FRONTEND_DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def serve_frontend(full_path: str) -> FileResponse:
        file_path = FRONTEND_DIST / full_path
        if file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(FRONTEND_DIST / "index.html")
