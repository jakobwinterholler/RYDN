"""Companion mobile GPX import — full desktop analysis pipeline with staged progress."""

from __future__ import annotations

import asyncio
import logging
import threading
from dataclasses import dataclass
from typing import Any, Literal

from companion_bundle import build_companion_bundle
from pipeline import analyze_race_gpx, roadbook_to_dict
from pipeline_watchdog import PipelineStalledError, StageWatchdog
from progress import ProgressReporter
from race_project import gpx_fingerprint, race_store
from settings_merge import effective_planning
from app_settings import app_settings_store

logger = logging.getLogger(__name__)

ConflictAction = Literal["create", "replace"]

IMPORT_STAGES: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("loading", "Loading…", ("reading_gpx",)),
    (
        "analyzing",
        "Analyzing route…",
        (
            "calculating_distance",
            "generate_map",
            "osm_surface_data",
            "detecting_surfaces",
            "calculating_gradients",
            "generating_route_visualization",
        ),
    ),
    ("climbs", "Detecting climbs…", ("detecting_climbs",)),
    (
        "resupply",
        "Finding resupply…",
        (
            "osm_poi_data",
            "finding_pois",
            "creating_resupply_zones",
            "calculating_resupply_quality",
        ),
    ),
    ("bundle", "Creating companion bundle…", ("preparing_dashboard",)),
    ("ready", "Ready to ride.", ("complete",)),
)

_STEP_TO_STAGE: dict[str, str] = {
    step_id: stage_id for stage_id, _, step_ids in IMPORT_STAGES for step_id in step_ids
}


def compute_gpx_fingerprint(gpx_bytes: bytes) -> str:
    return gpx_fingerprint(gpx_bytes)


@dataclass(frozen=True)
class DuplicateRaceMatch:
    id: str
    name: str
    distance_km: float | None
    elevation_gain_m: float | None
    updated_at: str | None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "distance_km": self.distance_km,
            "elevation_gain_m": self.elevation_gain_m,
            "updated_at": self.updated_at,
        }


def find_local_duplicates(fingerprint: str) -> list[DuplicateRaceMatch]:
    matches: list[DuplicateRaceMatch] = []
    for summary in race_store.list_races():
        race = race_store.get_race(summary.id)
        if race.meta.gpx_fingerprint == fingerprint:
            matches.append(
                DuplicateRaceMatch(
                    id=summary.id,
                    name=summary.name,
                    distance_km=summary.distance_km,
                    elevation_gain_m=summary.elevation_gain_m,
                    updated_at=summary.updated_at,
                )
            )
    return matches


class CompanionImportProgress(ProgressReporter):
    """Map pipeline steps to the six mobile import stages."""

    def __init__(self, callback) -> None:
        super().__init__(callback=callback)
        self._active_import_stage: str | None = None
        self._completed_stages: set[str] = set()

    def _emit_import_stage(
        self,
        stage_id: str,
        *,
        label: str,
        status: Literal["active", "complete"],
        percent: float | None = None,
    ) -> None:
        payload: dict[str, Any] = {
            "type": "import_stage",
            "stage_id": stage_id,
            "label": label,
            "status": status,
        }
        if percent is not None:
            payload["percent"] = percent
        self._emit(payload)

    def _advance_import_stage(self, step_id: str) -> None:
        stage_id = _STEP_TO_STAGE.get(step_id)
        if not stage_id:
            return
        stage_def = next(item for item in IMPORT_STAGES if item[0] == stage_id)
        label = stage_def[1]
        if self._active_import_stage and self._active_import_stage != stage_id:
            prev = self._active_import_stage
            if prev not in self._completed_stages:
                prev_def = next(item for item in IMPORT_STAGES if item[0] == prev)
                self._completed_stages.add(prev)
                self._emit_import_stage(prev, label=prev_def[1], status="complete")
        self._active_import_stage = stage_id
        self._emit_import_stage(stage_id, label=label, status="active", percent=self._overall_percent())

    def start(self, step_id: str, *, label: str | None = None, detail: str | None = None) -> None:
        super().start(step_id, label=label, detail=detail)
        self._advance_import_stage(step_id)

    def complete(self, step_id: str, *, label: str | None = None, detail: str | None = None) -> None:
        super().complete(step_id, label=label, detail=detail)
        stage_id = _STEP_TO_STAGE.get(step_id)
        if stage_id and stage_id not in self._completed_stages:
            stage_def = next(item for item in IMPORT_STAGES if item[0] == stage_id)
            self._completed_stages.add(stage_id)
            self._emit_import_stage(stage_id, label=stage_def[1], status="complete", percent=self._overall_percent())

    def finish_ready(self) -> None:
        for stage_id, label, _ in IMPORT_STAGES:
            if stage_id not in self._completed_stages:
                self._emit_import_stage(stage_id, label=label, status="complete", percent=100.0)
        self._emit_import_stage("ready", label="Ready to ride.", status="complete", percent=100.0)


def _effective_race_planning(race_id: str):
    app = app_settings_store.load()
    race = race_store.get_race(race_id)
    return effective_planning(app, race.settings)


def run_companion_import(
    *,
    filename: str,
    gpx_bytes: bytes,
    name: str | None,
    conflict_action: ConflictAction,
    replace_race_id: str | None,
    loop: asyncio.AbstractEventLoop,
    queue: asyncio.Queue,
) -> None:
    def emit(event: dict) -> None:
        asyncio.run_coroutine_threadsafe(queue.put(event), loop)

    watchdog: StageWatchdog | None = None
    try:
        fingerprint = gpx_fingerprint(gpx_bytes)
        emit(
            {
                "type": "import_stage",
                "stage_id": "loading",
                "label": "Loading…",
                "status": "active",
                "percent": 0,
            }
        )

        if conflict_action == "replace":
            if not replace_race_id:
                emit({"type": "error", "detail": "replace_race_id is required for replace action."})
                return
            race_id = replace_race_id
            try:
                race_store.get_race(race_id)
                race_store.replace_race_gpx(
                    race_id,
                    filename=filename,
                    gpx_bytes=gpx_bytes,
                    name=name,
                )
            except FileNotFoundError:
                race_store.create_race_with_id(
                    race_id,
                    filename=filename,
                    gpx_bytes=gpx_bytes,
                    name=name,
                )
        else:
            race = race_store.create_race(filename=filename, gpx_bytes=gpx_bytes, name=name)
            race_id = race.id

        emit(
            {
                "type": "race_created",
                "race_id": race_id,
                "fingerprint": fingerprint,
                "name": race_store.get_summary(race_id).name,
            }
        )

        watchdog = StageWatchdog()
        watchdog.start()
        reporter = CompanionImportProgress(callback=emit, watchdog=watchdog)
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

        emit(
            {
                "type": "import_stage",
                "stage_id": "bundle",
                "label": "Creating companion bundle…",
                "status": "active",
                "percent": 95,
            }
        )
        refreshed = race_store.get_race(race_id)
        bundle = build_companion_bundle(
            race_id,
            roadbook,
            refreshed.preparation.to_dict(),
            revision=1,
        )
        reporter.finish_ready()
        emit(
            {
                "type": "complete",
                "race_id": race_id,
                "bundle": bundle,
                "fingerprint": fingerprint,
            }
        )
    except PipelineStalledError as exc:
        emit({"type": "error", "detail": str(exc)})
    except FileNotFoundError as exc:
        emit({"type": "error", "detail": str(exc)})
    except ValueError as exc:
        emit({"type": "error", "detail": str(exc)})
    except RuntimeError as exc:
        emit({"type": "error", "detail": str(exc)})
    except Exception as exc:  # pragma: no cover
        logger.exception("Companion import failed")
        emit({"type": "error", "detail": f"Import failed: {exc}"})
    finally:
        if watchdog is not None:
            watchdog.stop()
        asyncio.run_coroutine_threadsafe(queue.put(None), loop)


def import_stage_catalog() -> list[dict[str, str]]:
    return [{"id": stage_id, "label": label} for stage_id, label, _ in IMPORT_STAGES]


def bundle_stats_for_compare(bundle: dict[str, Any]) -> dict[str, Any]:
    """Extract comparable stats for validation scripts."""
    race = bundle.get("race") or {}
    dashboard = bundle.get("dashboardStats") or {}
    return {
        "schemaVersion": bundle.get("schemaVersion"),
        "distanceKm": race.get("distanceKm"),
        "elevationGainM": race.get("elevationGainM"),
        "stopCount": len(bundle.get("stops") or []),
        "climbCount": len(bundle.get("climbs") or []),
        "unsupportedCount": len(bundle.get("unsupportedSections") or []),
        "readinessScore": dashboard.get("readinessScore"),
        "verifiedStops": dashboard.get("verifiedStops"),
        "bundleChecksum": bundle.get("bundleChecksum"),
    }


def bundles_match_within_tolerance(
    left: dict[str, Any],
    right: dict[str, Any],
    *,
    float_tol: float = 0.01,
) -> tuple[bool, list[str]]:
    """Compare two bundles for validation — checksum must match exactly."""
    mismatches: list[str] = []
    left_stats = bundle_stats_for_compare(left)
    right_stats = bundle_stats_for_compare(right)

    if left_stats["bundleChecksum"] != right_stats["bundleChecksum"]:
        mismatches.append(
            f"checksum: {left_stats['bundleChecksum']} != {right_stats['bundleChecksum']}"
        )

    float_keys = ("distanceKm", "elevationGainM", "readinessScore")
    for key in float_keys:
        lv = left_stats.get(key)
        rv = right_stats.get(key)
        if lv is None and rv is None:
            continue
        if isinstance(lv, (int, float)) and isinstance(rv, (int, float)):
            if abs(float(lv) - float(rv)) > float_tol:
                mismatches.append(f"{key}: {lv} != {rv}")
        elif lv != rv:
            mismatches.append(f"{key}: {lv} != {rv}")

    int_keys = ("stopCount", "climbCount", "unsupportedCount", "verifiedStops", "schemaVersion")
    for key in int_keys:
        if left_stats.get(key) != right_stats.get(key):
            mismatches.append(f"{key}: {left_stats.get(key)} != {right_stats.get(key)}")

    return len(mismatches) == 0, mismatches
