"""Local race project storage — one folder per race."""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from climb_config import ClimbDetectionConfig, DEFAULT_CLIMB_DETECTION_CONFIG
from poi_profile import DEFAULT_ULTRA_POI_PROFILE, PoiPlanningProfile
from preview_versions import (
    CAMERA_VERSION,
    PREVIEW_PIPELINE_VERSION,
    RUNTIME_VERSION,
    STORY_VERSION,
)
from race_dashboard import compute_race_dashboard_stats
from race_open_trace import race_open_trace

SCHEMA_VERSION = 1
PIPELINE_VERSION = "0.15"

PROJECT_ROOT = Path(__file__).resolve().parent.parent
RACES_ROOT = PROJECT_ROOT / "data" / "races"

PREPARATION_LABELS: dict[str, str] = {
    "route_understood": "Route understood",
    "unsupported_reviewed": "Unsupported sections reviewed",
    "stops_verified": "Stops verified",
    "key_climbs_reviewed": "Key climbs reviewed",
    "equipment_decided": "Equipment decided",
    "stages_planned": "Stages planned",
    "export_generated": "Export generated",
}


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or "race"


def gpx_fingerprint(gpx_bytes: bytes) -> str:
    return hashlib.sha256(gpx_bytes).hexdigest()[:16]


def default_name_from_filename(filename: str) -> str:
    stem = Path(filename).stem.replace("_", " ").replace("-", " ")
    return re.sub(r"\s+", " ", stem).strip() or "Untitled race"


@dataclass
class PreparationProgress:
    route_understood: bool = False
    unsupported_reviewed: bool = False
    stops_verified: bool = False
    key_climbs_reviewed: bool = False
    equipment_decided: bool = False
    stages_planned: bool = False
    export_generated: bool = False

    def to_dict(self) -> dict[str, bool]:
        return asdict(self)

    @classmethod
    def from_dict(cls, payload: dict | None) -> PreparationProgress:
        if not payload:
            return cls()
        known = {field.name for field in cls.__dataclass_fields__.values()}
        return cls(**{key: bool(value) for key, value in payload.items() if key in known})

    def completed_count(self) -> int:
        return sum(1 for value in asdict(self).values() if value)

    @property
    def total_count(self) -> int:
        return len(PREPARATION_LABELS)


@dataclass
class RaceSettings:
    use_app_defaults: bool = True
    poi_profile: PoiPlanningProfile | None = None
    climb_sensitivity: str | None = None
    climb_config: ClimbDetectionConfig | None = None
    preferred_stage_length_km: int | None = None
    max_gap_without_resupply_km: int | None = None
    default_arrival_time_window: str | None = None
    default_zone_density: str | None = None

    def to_dict(self) -> dict:
        payload: dict = {"use_app_defaults": self.use_app_defaults}
        if self.poi_profile is not None:
            payload["poi_profile"] = self.poi_profile.to_dict()
        if self.climb_sensitivity is not None:
            payload["climb_sensitivity"] = self.climb_sensitivity
        if self.climb_config is not None:
            payload["climb_config"] = self.climb_config.to_dict()
        if self.preferred_stage_length_km is not None:
            payload["preferred_stage_length_km"] = self.preferred_stage_length_km
        if self.max_gap_without_resupply_km is not None:
            payload["max_gap_without_resupply_km"] = self.max_gap_without_resupply_km
        if self.default_arrival_time_window is not None:
            payload["default_arrival_time_window"] = self.default_arrival_time_window
        if self.default_zone_density is not None:
            payload["default_zone_density"] = self.default_zone_density
        return payload

    @classmethod
    def from_dict(cls, payload: dict | None) -> RaceSettings:
        if not payload:
            return cls()
        climb_payload = payload.get("climb_config")
        return cls(
            use_app_defaults=bool(payload.get("use_app_defaults", True)),
            poi_profile=PoiPlanningProfile.from_dict(payload["poi_profile"])
            if payload.get("poi_profile") is not None
            else None,
            climb_sensitivity=payload.get("climb_sensitivity"),
            climb_config=ClimbDetectionConfig.from_dict(climb_payload) if climb_payload else None,
            preferred_stage_length_km=payload.get("preferred_stage_length_km"),
            max_gap_without_resupply_km=payload.get("max_gap_without_resupply_km"),
            default_arrival_time_window=payload.get("default_arrival_time_window"),
            default_zone_density=payload.get("default_zone_density"),
        )


@dataclass
class VerifiedStopRecord:
    status: str  # verified | rejected | deferred
    reject_reason: str | None = None
    reject_notes: str | None = None
    feedback_context: dict[str, Any] | None = None
    poi_key: str | None = None
    updated_at: str = field(default_factory=_utc_now)

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "status": self.status,
            "updated_at": self.updated_at,
        }
        if self.reject_reason is not None:
            payload["reject_reason"] = self.reject_reason
        if self.reject_notes is not None:
            payload["reject_notes"] = self.reject_notes
        if self.feedback_context is not None:
            payload["feedback_context"] = self.feedback_context
        if self.poi_key is not None:
            payload["poi_key"] = self.poi_key
        return payload

    @classmethod
    def from_dict(cls, payload: dict) -> VerifiedStopRecord:
        feedback_context = payload.get("feedback_context")
        return cls(
            status=str(payload.get("status", "deferred")),
            reject_reason=payload.get("reject_reason"),
            reject_notes=payload.get("reject_notes"),
            feedback_context=feedback_context if isinstance(feedback_context, dict) else None,
            poi_key=payload.get("poi_key"),
            updated_at=str(payload.get("updated_at") or _utc_now()),
        )


@dataclass
class CompanionVerificationRecord:
    id: str
    race_id: str
    zone_id: int
    stop_name: str
    submitted_at: str
    source: str = "companion"
    review_status: str = "pending"
    lat: float | None = None
    lon: float | None = None
    updates: dict[str, Any] = field(default_factory=dict)
    reviewed_at: str | None = None
    review_action: str | None = None

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "id": self.id,
            "raceId": self.race_id,
            "zoneId": self.zone_id,
            "stopName": self.stop_name,
            "submittedAt": self.submitted_at,
            "source": self.source,
            "reviewStatus": self.review_status,
            "updates": self.updates,
        }
        if self.lat is not None:
            payload["lat"] = self.lat
        if self.lon is not None:
            payload["lon"] = self.lon
        if self.reviewed_at is not None:
            payload["reviewedAt"] = self.reviewed_at
        if self.review_action is not None:
            payload["reviewAction"] = self.review_action
        return payload

    @classmethod
    def from_dict(cls, payload: dict) -> CompanionVerificationRecord:
        updates = payload.get("updates")
        return cls(
            id=str(payload.get("id") or ""),
            race_id=str(payload.get("raceId") or payload.get("race_id") or ""),
            zone_id=int(payload.get("zoneId") or payload.get("zone_id") or 0),
            stop_name=str(payload.get("stopName") or payload.get("stop_name") or ""),
            submitted_at=str(payload.get("submittedAt") or payload.get("submitted_at") or _utc_now()),
            source=str(payload.get("source") or "companion"),
            review_status=str(payload.get("reviewStatus") or payload.get("review_status") or "pending"),
            lat=payload.get("lat"),
            lon=payload.get("lon"),
            updates=updates if isinstance(updates, dict) else {},
            reviewed_at=payload.get("reviewedAt") or payload.get("reviewed_at"),
            review_action=payload.get("reviewAction") or payload.get("review_action"),
        )


@dataclass
class PreparationState:
    climb_nicknames: dict[str, str] = field(default_factory=dict)
    progress: PreparationProgress = field(default_factory=PreparationProgress)
    verified_stops: dict[str, VerifiedStopRecord] = field(default_factory=dict)
    companion_pending_verifications: dict[str, CompanionVerificationRecord] = field(default_factory=dict)
    companion_verification_history: dict[str, CompanionVerificationRecord] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "climb_nicknames": self.climb_nicknames,
            "progress": self.progress.to_dict(),
            "verified_stops": {
                key: record.to_dict() for key, record in self.verified_stops.items()
            },
            "companion_pending_verifications": {
                key: record.to_dict() for key, record in self.companion_pending_verifications.items()
            },
            "companion_verification_history": {
                key: record.to_dict() for key, record in self.companion_verification_history.items()
            },
        }

    @classmethod
    def from_dict(cls, payload: dict | None) -> PreparationState:
        if not payload:
            return cls()
        verified_raw = payload.get("verified_stops") or {}
        verified_stops = {
            str(key): VerifiedStopRecord.from_dict(value)
            for key, value in verified_raw.items()
            if isinstance(value, dict)
        }
        pending_raw = payload.get("companion_pending_verifications") or {}
        companion_pending_verifications = {
            str(key): CompanionVerificationRecord.from_dict(value)
            for key, value in pending_raw.items()
            if isinstance(value, dict)
        }
        history_raw = payload.get("companion_verification_history") or {}
        companion_verification_history = {
            str(key): CompanionVerificationRecord.from_dict(value)
            for key, value in history_raw.items()
            if isinstance(value, dict)
        }
        return cls(
            climb_nicknames=dict(payload.get("climb_nicknames") or {}),
            progress=PreparationProgress.from_dict(payload.get("progress")),
            verified_stops=verified_stops,
            companion_pending_verifications=companion_pending_verifications,
            companion_verification_history=companion_verification_history,
        )


@dataclass
class ExportRecord:
    id: str
    type: str
    filename: str
    created_at: str
    analysis_snapshot_id: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, payload: dict) -> ExportRecord:
        return cls(
            id=payload["id"],
            type=payload["type"],
            filename=payload["filename"],
            created_at=payload["created_at"],
            analysis_snapshot_id=payload.get("analysis_snapshot_id"),
        )


@dataclass
class RaceMeta:
    name: str
    created_at: str
    updated_at: str
    last_opened_at: str
    gpx_original_name: str
    gpx_fingerprint: str
    distance_km: float | None = None
    elevation_gain_m: float | None = None
    climb_count: int | None = None
    archived_at: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, payload: dict) -> RaceMeta:
        return cls(**{key: payload[key] for key in cls.__dataclass_fields__ if key in payload})


@dataclass
class RaceProject:
    id: str
    schema_version: int
    meta: RaceMeta
    settings: RaceSettings
    preparation: PreparationState
    exports: list[ExportRecord]
    analysis: dict[str, Any]

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "schema_version": self.schema_version,
            "meta": self.meta.to_dict(),
            "settings": self.settings.to_dict(),
            "preparation": self.preparation.to_dict(),
            "exports": [record.to_dict() for record in self.exports],
            "analysis": self.analysis,
        }

    @classmethod
    def from_dict(cls, payload: dict) -> RaceProject:
        return cls(
            id=payload["id"],
            schema_version=payload.get("schema_version", SCHEMA_VERSION),
            meta=RaceMeta.from_dict(payload["meta"]),
            settings=RaceSettings.from_dict(payload.get("settings")),
            preparation=PreparationState.from_dict(payload.get("preparation")),
            exports=[ExportRecord.from_dict(record) for record in payload.get("exports", [])],
            analysis=dict(payload.get("analysis") or {}),
        )


@dataclass
class PreparationProgressItem:
    id: str
    label: str
    complete: bool


@dataclass
class RaceSummary:
    id: str
    name: str
    created_at: str
    updated_at: str
    last_opened_at: str
    gpx_original_name: str
    distance_km: float | None
    elevation_gain_m: float | None
    climb_count: int | None
    has_analysis: bool
    preparation_completed: int
    preparation_total: int
    preparation_items: list[PreparationProgressItem]
    gpx_fingerprint: str | None = None
    archived_at: str | None = None
    dashboard_stats: dict[str, Any] | None = None

    def to_dict(self) -> dict:
        payload = {
            "id": self.id,
            "name": self.name,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "last_opened_at": self.last_opened_at,
            "gpx_original_name": self.gpx_original_name,
            "distance_km": self.distance_km,
            "elevation_gain_m": self.elevation_gain_m,
            "climb_count": self.climb_count,
            "gpx_fingerprint": self.gpx_fingerprint,
            "has_analysis": self.has_analysis,
            "preparation_completed": self.preparation_completed,
            "preparation_total": self.preparation_total,
            "preparation_items": [asdict(item) for item in self.preparation_items],
            "archived_at": self.archived_at,
        }
        if self.dashboard_stats is not None:
            payload["dashboard_stats"] = self.dashboard_stats
        return payload


class RaceProjectStore:
    def __init__(self, root: Path = RACES_ROOT) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    def _race_dir(self, race_id: str) -> Path:
        return self.root / race_id

    def _manifest_path(self, race_id: str) -> Path:
        return self._race_dir(race_id) / "race.json"

    def _gpx_path(self, race_id: str) -> Path:
        return self._race_dir(race_id) / "route.gpx"

    def _analysis_path(self, race_id: str) -> Path:
        return self._race_dir(race_id) / "analysis" / "latest.json"

    def _exports_dir(self, race_id: str) -> Path:
        return self._race_dir(race_id) / "exports"

    def _previews_dir(self, race_id: str) -> Path:
        return self._race_dir(race_id) / "previews"

    def preview_segment_path(self, race_id: str) -> Path:
        return self._previews_dir(race_id) / "segment.json"

    def preview_video_path(self, race_id: str) -> Path:
        return self._previews_dir(race_id) / "route-preview.mp4"

    def preview_frames_dir(self, race_id: str) -> Path:
        return self._previews_dir(race_id) / "frames"

    def preview_cache_dir(self, race_id: str) -> Path:
        return self._previews_dir(race_id) / "cache"

    def preview_runtime_path(self, race_id: str) -> Path:
        return self._previews_dir(race_id) / "runtime.json"

    def has_route_preview_runtime(self, race_id: str) -> bool:
        return self.preview_runtime_path(race_id).is_file()

    def has_route_preview_cache(self, race_id: str) -> bool:
        manifest = self.preview_cache_dir(race_id) / "manifest.json"
        return manifest.is_file()

    def has_route_preview(self, race_id: str) -> bool:
        return self.preview_video_path(race_id).is_file()

    def record_route_preview(self, race_id: str) -> RaceProject:
        race = self.get_race(race_id)
        race.meta.updated_at = _utc_now()
        race.analysis = {
            **race.analysis,
            "route_preview_at": _utc_now(),
        }
        self._save_race(race)
        return race

    def preview_source_fingerprint(self, race: RaceProject) -> str:
        payload = {
            "analyzed_at": race.analysis.get("analyzed_at"),
            "gpx_fingerprint": race.meta.gpx_fingerprint,
            "climb_nicknames": race.preparation.climb_nicknames,
            "verified_stops": {
                key: record.to_dict()
                for key, record in sorted(race.preparation.verified_stops.items())
            },
        }
        encoded = json.dumps(payload, sort_keys=True, default=str)
        return hashlib.sha256(encoded.encode("utf-8")).hexdigest()[:16]

    def clear_route_preview_artifacts(self, race_id: str, *, keep_video: bool = True) -> None:
        previews_dir = self._previews_dir(race_id)
        if not previews_dir.is_dir():
            return
        for filename in ("runtime.json", "segment.json"):
            path = previews_dir / filename
            if path.is_file():
                path.unlink()
        cache_dir = self.preview_cache_dir(race_id)
        if cache_dir.is_dir():
            shutil.rmtree(cache_dir)
        if not keep_video:
            video_path = self.preview_video_path(race_id)
            if video_path.is_file():
                video_path.unlink()

    def preview_runtime_meta(self, race_id: str) -> dict[str, Any]:
        runtime_path = self.preview_runtime_path(race_id)
        if not runtime_path.is_file():
            return {}
        try:
            payload = json.loads(runtime_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {"parse_error": True}
        meta = payload.get("meta") or {}
        stat = runtime_path.stat()
        return {
            "generated_at": meta.get("generatedAt") or datetime.fromtimestamp(
                stat.st_mtime, tz=timezone.utc
            ).isoformat(),
            "story_version": meta.get("storyVersion"),
            "runtime_version": meta.get("runtimeVersion"),
            "pipeline_version": meta.get("pipelineVersion"),
            "file_mtime": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
            "file_size_bytes": stat.st_size,
        }

    def preview_cache_meta(self, race_id: str) -> dict[str, Any]:
        manifest_path = self.preview_cache_dir(race_id) / "manifest.json"
        if not manifest_path.is_file():
            return {"present": False}
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {"present": True, "parse_error": True}
        stat = manifest_path.stat()
        return {
            "present": True,
            "segment_hash": manifest.get("segment_hash"),
            "terrain_zoom": manifest.get("terrain_zoom"),
            "tile_count": manifest.get("tile_count"),
            "updated_at": manifest.get("updated_at"),
            "file_mtime": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
        }

    def record_route_preview_prepare(
        self,
        race_id: str,
        *,
        cache_hit: bool | None = None,
    ) -> RaceProject:
        race = self.get_race(race_id)
        race.analysis = {
            **race.analysis,
            "route_preview_prepared_at": _utc_now(),
            "route_preview_source_fingerprint": self.preview_source_fingerprint(race),
            "route_preview_pipeline_version": PREVIEW_PIPELINE_VERSION,
            "route_preview_last_cache_hit": cache_hit,
        }
        self._save_race(race)
        return race

    def route_preview_stale_info(self, race_id: str) -> dict[str, Any]:
        if not self.has_route_preview_runtime(race_id):
            return {
                "is_stale": False,
                "reasons": [],
                "prepared_at": None,
                "pipeline_version": PREVIEW_PIPELINE_VERSION,
                "stored_pipeline_version": None,
                "source_fingerprint": None,
                "stored_source_fingerprint": None,
            }

        race = self.get_race(race_id)
        prepared_at = race.analysis.get("route_preview_prepared_at")
        stored_source = race.analysis.get("route_preview_source_fingerprint") or race.analysis.get(
            "route_preview_fingerprint"
        )
        stored_pipeline = race.analysis.get("route_preview_pipeline_version")
        current_source = self.preview_source_fingerprint(race)
        reasons: list[str] = []

        if not stored_source or not stored_pipeline:
            reasons.append(
                "Preview was generated before reliable version tracking — regenerate to refresh."
            )
        elif stored_pipeline != PREVIEW_PIPELINE_VERSION:
            reasons.append(
                "Preview engine or story logic has changed since this preview was generated."
            )
        elif stored_source != current_source:
            reasons.append("Your route or planning data has changed since this preview was generated.")

        runtime_meta = self.preview_runtime_meta(race_id)
        if runtime_meta.get("pipeline_version") and runtime_meta["pipeline_version"] != PREVIEW_PIPELINE_VERSION:
            if not any("engine" in reason for reason in reasons):
                reasons.append("On-disk runtime.json was built with an older preview version.")

        return {
            "is_stale": len(reasons) > 0,
            "reasons": reasons,
            "prepared_at": prepared_at,
            "pipeline_version": PREVIEW_PIPELINE_VERSION,
            "stored_pipeline_version": stored_pipeline,
            "source_fingerprint": current_source,
            "stored_source_fingerprint": stored_source,
            "story_version": STORY_VERSION,
            "runtime_version": RUNTIME_VERSION,
            "camera_version": CAMERA_VERSION,
            "last_cache_hit": race.analysis.get("route_preview_last_cache_hit"),
        }

    def route_preview_debug_info(self, race_id: str) -> dict[str, Any]:
        stale = self.route_preview_stale_info(race_id)
        runtime_meta = self.preview_runtime_meta(race_id)
        cache_meta = self.preview_cache_meta(race_id)
        return {
            **stale,
            "has_runtime": self.has_route_preview_runtime(race_id),
            "has_cache": self.has_route_preview_cache(race_id),
            "has_video": self.has_route_preview(race_id),
            "runtime": runtime_meta,
            "cache": cache_meta,
        }

    def sync_preview_segment_from_runtime(self, race_id: str) -> None:
        runtime_path = self.preview_runtime_path(race_id)
        segment_path = self.preview_segment_path(race_id)
        if not runtime_path.is_file():
            return
        runtime = json.loads(runtime_path.read_text(encoding="utf-8"))
        track = runtime.get("track") or runtime.get("routeSamples") or []
        segment_path.parent.mkdir(parents=True, exist_ok=True)
        segment_path.write_text(
            json.dumps({"track": track}, indent=2),
            encoding="utf-8",
        )

    def list_races(self, include_archived: bool = False) -> list[RaceSummary]:
        summaries: list[RaceSummary] = []
        if not self.root.is_dir():
            return summaries

        for entry in sorted(self.root.iterdir(), key=lambda path: path.stat().st_mtime, reverse=True):
            if not entry.is_dir():
                continue
            manifest = entry / "race.json"
            if not manifest.is_file():
                continue
            race = self._load_race(entry.name)
            if not include_archived and race.meta.archived_at:
                continue
            summaries.append(self._to_summary(race))
        return summaries

    def create_race(self, *, filename: str, gpx_bytes: bytes, name: str | None = None) -> RaceProject:
        return self.create_race_with_id(
            str(uuid.uuid4()),
            filename=filename,
            gpx_bytes=gpx_bytes,
            name=name,
        )

    def create_race_with_id(
        self,
        race_id: str,
        *,
        filename: str,
        gpx_bytes: bytes,
        name: str | None = None,
    ) -> RaceProject:
        race_dir = self._race_dir(race_id)
        if race_dir.exists():
            raise ValueError(f"Race {race_id} already exists.")
        race_dir.mkdir(parents=True)
        (race_dir / "analysis").mkdir()
        self._exports_dir(race_id).mkdir()

        now = _utc_now()
        display_name = (name or default_name_from_filename(filename)).strip() or "Untitled race"
        race = RaceProject(
            id=race_id,
            schema_version=SCHEMA_VERSION,
            meta=RaceMeta(
                name=display_name,
                created_at=now,
                updated_at=now,
                last_opened_at=now,
                gpx_original_name=filename,
                gpx_fingerprint=gpx_fingerprint(gpx_bytes),
            ),
            settings=RaceSettings(),
            preparation=PreparationState(),
            exports=[],
            analysis={"latest_snapshot_id": None, "pipeline_version": PIPELINE_VERSION},
        )
        self._gpx_path(race_id).write_bytes(gpx_bytes)
        self._save_race(race)
        return race

    def get_race(self, race_id: str) -> RaceProject:
        return self._load_race(race_id)

    def get_summary(self, race_id: str) -> RaceSummary:
        return self._to_summary(self.get_race(race_id))

    def touch_opened(self, race_id: str) -> RaceProject:
        race = self.get_race(race_id)
        race.meta.last_opened_at = _utc_now()
        race.meta.updated_at = race.meta.last_opened_at
        self._save_race(race)
        return race

    def rename_race(self, race_id: str, name: str) -> RaceProject:
        race = self.get_race(race_id)
        cleaned = name.strip()
        if not cleaned:
            raise ValueError("Race name cannot be empty.")
        race.meta.name = cleaned
        race.meta.updated_at = _utc_now()
        self._save_race(race)
        return race

    def update_settings(self, race_id: str, settings: RaceSettings) -> RaceProject:
        race = self.get_race(race_id)
        race.settings = settings
        race.meta.updated_at = _utc_now()
        self._save_race(race)
        return race

    def _max_gap_for_race(self, race: RaceProject) -> float:
        max_gap = 45.0
        if race.settings.max_gap_without_resupply_km is not None:
            return float(race.settings.max_gap_without_resupply_km)
        if race.settings.use_app_defaults:
            try:
                from app_settings import app_settings_store

                return float(app_settings_store.load().planning.max_gap_without_resupply_km)
            except Exception:
                return max_gap
        return max_gap

    def _refresh_dashboard_stats_cache(
        self,
        race: RaceProject,
        roadbook: dict | None = None,
    ) -> dict[str, Any] | None:
        if roadbook is None:
            roadbook = self.load_analysis(race.id)
        if not roadbook:
            race.analysis.pop("dashboard_stats", None)
            return None
        stats = compute_race_dashboard_stats(
            roadbook,
            race.preparation.to_dict(),
            max_gap_km=self._max_gap_for_race(race),
        )
        race.analysis["dashboard_stats"] = stats
        return stats

    def update_preparation(
        self,
        race_id: str,
        *,
        climb_nicknames: dict[str, str] | None = None,
        progress: dict[str, bool] | None = None,
        verified_stops: dict[str, dict[str, Any]] | None = None,
    ) -> RaceProject:
        race = self.get_race(race_id)
        if climb_nicknames is not None:
            race.preparation.climb_nicknames = climb_nicknames
        if progress is not None:
            current = race.preparation.progress.to_dict()
            for key, value in progress.items():
                if key in PREPARATION_LABELS:
                    current[key] = bool(value)
            race.preparation.progress = PreparationProgress.from_dict(current)
        if verified_stops is not None:
            for key, payload in verified_stops.items():
                if not isinstance(payload, dict):
                    continue
                if payload.get("_delete"):
                    race.preparation.verified_stops.pop(str(key), None)
                    continue
                race.preparation.verified_stops[str(key)] = VerifiedStopRecord.from_dict(payload)
        race.meta.updated_at = _utc_now()
        if verified_stops is not None and self.has_analysis(race_id):
            self._refresh_dashboard_stats_cache(race)
        self._save_race(race)
        return race

    def promote_discovered_stop(
        self,
        race_id: str,
        suggested_stop: dict[str, Any],
        *,
        verified_stop: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        roadbook = self.load_analysis(race_id)
        if roadbook is None:
            raise ValueError("Generate a roadbook before promoting discovered stops.")

        suggested = list(roadbook.get("suggested_stops") or [])
        osm_id = suggested_stop.get("osm_id")
        osm_type = suggested_stop.get("osm_type")
        zone_id = suggested_stop.get("zone_id")

        suggested = [
            item
            for item in suggested
            if not (
                item.get("osm_id") == osm_id
                and item.get("osm_type") == osm_type
            )
        ]
        if zone_id is not None:
            suggested = [item for item in suggested if item.get("zone_id") != zone_id]
        suggested.append(suggested_stop)
        suggested.sort(key=lambda item: float(item.get("distance_along_km") or 0))
        roadbook["suggested_stops"] = suggested
        self.save_analysis(race_id, roadbook)

        if verified_stop:
            race = self.get_race(race_id)
            zone_key = str(verified_stop.get("zone_id"))
            record = verified_stop.get("record")
            if zone_key and isinstance(record, dict):
                race.preparation.verified_stops[zone_key] = VerifiedStopRecord.from_dict(record)
                race.meta.updated_at = _utc_now()
                self._refresh_dashboard_stats_cache(race, roadbook)
                self._save_race(race)

        return roadbook

    def add_companion_verifications(
        self,
        race_id: str,
        verifications: list[dict[str, Any]],
    ) -> list[str]:
        race = self.get_race(race_id)
        accepted: list[str] = []
        now = _utc_now()
        for raw in verifications:
            if not isinstance(raw, dict):
                continue
            record = CompanionVerificationRecord.from_dict(raw)
            if not record.id:
                continue
            record.review_status = "pending"
            race.preparation.companion_pending_verifications[record.id] = record
            accepted.append(record.id)
        if accepted:
            race.meta.updated_at = now
            self._save_race(race)
        return accepted

    def list_companion_verifications(
        self,
        race_id: str,
        *,
        status: str = "pending",
    ) -> list[dict[str, Any]]:
        race = self.get_race(race_id)
        if status == "history":
            records = race.preparation.companion_verification_history.values()
        elif status == "all":
            records = [
                *race.preparation.companion_pending_verifications.values(),
                *race.preparation.companion_verification_history.values(),
            ]
        else:
            records = race.preparation.companion_pending_verifications.values()
        results = [record.to_dict() for record in records]
        if status == "pending":
            results = [item for item in results if item.get("reviewStatus") == "pending"]
        elif status == "history":
            results = [item for item in results if item.get("reviewStatus") != "pending"]
        results.sort(key=lambda item: str(item.get("submittedAt") or ""), reverse=True)
        return results

    def review_companion_verification(
        self,
        race_id: str,
        verification_id: str,
        *,
        action: str,
    ) -> RaceProject | None:
        race = self.get_race(race_id)
        record = race.preparation.companion_pending_verifications.get(verification_id)
        if record is None:
            return None

        if action == "accept":
            updates = record.updates or {}
            status = str(updates.get("status") or "verified")
            reject_reason = updates.get("rejectReason") or updates.get("reject_reason")
            reject_notes = updates.get("notes")
            race.preparation.verified_stops[str(record.zone_id)] = VerifiedStopRecord(
                status=status,
                reject_reason=str(reject_reason) if reject_reason else None,
                reject_notes=str(reject_notes) if reject_notes else None,
                updated_at=record.submitted_at,
            )
            if self.has_analysis(race_id):
                self._refresh_dashboard_stats_cache(race)

        record.review_status = "accepted" if action == "accept" else "rejected"
        record.reviewed_at = _utc_now()
        record.review_action = action
        del race.preparation.companion_pending_verifications[verification_id]
        race.preparation.companion_verification_history[verification_id] = record
        race.meta.updated_at = _utc_now()
        self._save_race(race)
        return race

    def delete_race(self, race_id: str) -> None:
        race_dir = self._race_dir(race_id)
        if not race_dir.is_dir():
            raise FileNotFoundError(f"Race {race_id} not found.")
        shutil.rmtree(race_dir, ignore_errors=True)

    def duplicate_race(self, race_id: str) -> RaceProject:
        self.get_race(race_id)
        source_dir = self._race_dir(race_id)
        new_id = str(uuid.uuid4())
        dest_dir = self._race_dir(new_id)
        shutil.copytree(source_dir, dest_dir)
        race = self._load_race(new_id)
        now = _utc_now()
        race.id = new_id
        race.meta.name = f"{race.meta.name} (copy)"
        race.meta.created_at = now
        race.meta.updated_at = now
        race.meta.last_opened_at = now
        race.meta.archived_at = None
        self._save_race(race)
        return race

    def set_archived(self, race_id: str, archived: bool) -> RaceProject:
        race = self.get_race(race_id)
        race.meta.archived_at = _utc_now() if archived else None
        race.meta.updated_at = _utc_now()
        self._save_race(race)
        return race

    def replace_race_gpx(
        self,
        race_id: str,
        *,
        filename: str,
        gpx_bytes: bytes,
        name: str | None = None,
    ) -> RaceProject:
        race = self.get_race(race_id)
        self._gpx_path(race_id).write_bytes(gpx_bytes)
        race.meta.gpx_original_name = filename
        race.meta.gpx_fingerprint = gpx_fingerprint(gpx_bytes)
        race.meta.updated_at = _utc_now()
        if name and name.strip():
            race.meta.name = name.strip()
        analysis_path = self._analysis_path(race_id)
        if analysis_path.is_file():
            analysis_path.unlink()
        race.analysis = {"latest_snapshot_id": None, "pipeline_version": PIPELINE_VERSION}
        self._save_race(race)
        return race

    def get_gpx_path(self, race_id: str) -> Path:
        path = self._gpx_path(race_id)
        if not path.is_file():
            raise FileNotFoundError(f"GPX file missing for race {race_id}.")
        return path

    def has_analysis(self, race_id: str) -> bool:
        return self._analysis_path(race_id).is_file()

    def load_analysis(self, race_id: str) -> dict | None:
        path = self._analysis_path(race_id)
        if not path.is_file():
            race_open_trace("load_analysis.missing", race_id=race_id)
            return None
        race_open_trace("load_analysis.start", race_id=race_id, detail=str(path))
        import time

        started = time.perf_counter()
        raw = path.read_text(encoding="utf-8")
        read_ms = (time.perf_counter() - started) * 1000
        race_open_trace(
            "load_analysis.read_done",
            race_id=race_id,
            detail=f"bytes={len(raw)} read_ms={read_ms:.0f}",
        )
        parse_started = time.perf_counter()
        payload = json.loads(raw)
        parse_ms = (time.perf_counter() - parse_started) * 1000
        race_open_trace(
            "load_analysis.parse_done",
            race_id=race_id,
            detail=f"parse_ms={parse_ms:.0f}",
        )
        return payload

    def save_analysis(self, race_id: str, roadbook: dict) -> RaceProject:
        race = self.get_race(race_id)
        snapshot_id = str(uuid.uuid4())
        analysis_path = self._analysis_path(race_id)
        analysis_path.parent.mkdir(parents=True, exist_ok=True)

        summary = roadbook.get("summary") or {}
        race.meta.distance_km = summary.get("distance_km")
        race.meta.elevation_gain_m = summary.get("elevation_gain_m")
        race.meta.climb_count = summary.get("climb_count")
        race.meta.updated_at = _utc_now()
        roadbook["analyzed_at"] = race.meta.updated_at
        analysis_path.write_text(json.dumps(roadbook, indent=2), encoding="utf-8")
        race.analysis = {
            "latest_snapshot_id": snapshot_id,
            "pipeline_version": PIPELINE_VERSION,
            "analyzed_at": race.meta.updated_at,
        }
        self._refresh_dashboard_stats_cache(race, roadbook)
        self._save_race(race)
        return race

    def record_export(
        self,
        race_id: str,
        *,
        export_type: str,
        filename: str,
    ) -> RaceProject:
        race = self.get_race(race_id)
        record = ExportRecord(
            id=str(uuid.uuid4()),
            type=export_type,
            filename=filename,
            created_at=_utc_now(),
            analysis_snapshot_id=race.analysis.get("latest_snapshot_id"),
        )
        race.exports.append(record)
        race.preparation.progress.export_generated = True
        race.meta.updated_at = _utc_now()
        self._save_race(race)
        return race

    def export_path(self, race_id: str, filename: str) -> Path:
        return self._exports_dir(race_id) / filename

    def _load_race(self, race_id: str) -> RaceProject:
        manifest = self._manifest_path(race_id)
        if not manifest.is_file():
            raise FileNotFoundError(f"Race {race_id} not found.")
        race_open_trace("load_race_json.start", race_id=race_id, detail=str(manifest))
        import time

        started = time.perf_counter()
        payload = json.loads(manifest.read_text(encoding="utf-8"))
        race_open_trace(
            "load_race_json.done",
            race_id=race_id,
            detail=f"parse_ms={(time.perf_counter() - started) * 1000:.0f}",
        )
        return RaceProject.from_dict(payload)

    def _save_race(self, race: RaceProject) -> None:
        manifest = self._manifest_path(race.id)
        manifest.parent.mkdir(parents=True, exist_ok=True)
        manifest.write_text(json.dumps(race.to_dict(), indent=2), encoding="utf-8")

    def _to_summary(self, race: RaceProject) -> RaceSummary:
        has_analysis = self.has_analysis(race.id)
        progress = race.preparation.progress
        if race.exports and not progress.export_generated:
            progress.export_generated = True
        items = [
            PreparationProgressItem(id=key, label=label, complete=getattr(progress, key))
            for key, label in PREPARATION_LABELS.items()
        ]
        dashboard_stats: dict[str, Any] | None = None
        if has_analysis:
            cached = race.analysis.get("dashboard_stats")
            if isinstance(cached, dict) and cached.get("readiness_score") is not None:
                dashboard_stats = cached
            else:
                dashboard_stats = self._refresh_dashboard_stats_cache(race)
                if dashboard_stats is not None:
                    self._save_race(race)
        return RaceSummary(
            id=race.id,
            name=race.meta.name,
            created_at=race.meta.created_at,
            updated_at=race.meta.updated_at,
            last_opened_at=race.meta.last_opened_at,
            gpx_original_name=race.meta.gpx_original_name,
            distance_km=race.meta.distance_km,
            elevation_gain_m=race.meta.elevation_gain_m,
            climb_count=race.meta.climb_count,
            gpx_fingerprint=race.meta.gpx_fingerprint,
            has_analysis=has_analysis,
            preparation_completed=progress.completed_count(),
            preparation_total=progress.total_count,
            preparation_items=items,
            archived_at=race.meta.archived_at,
            dashboard_stats=dashboard_stats,
        )


race_store = RaceProjectStore()
