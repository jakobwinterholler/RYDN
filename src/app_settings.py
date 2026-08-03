"""Application-wide default settings."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from climb_config import ClimbDetectionConfig, DEFAULT_CLIMB_DETECTION_CONFIG
from poi_profile import DEFAULT_ULTRA_POI_PROFILE, PoiPlanningProfile

PROJECT_ROOT = Path(__file__).resolve().parent.parent
APP_SETTINGS_PATH = PROJECT_ROOT / "data" / "app-settings.json"

DEFAULT_STAGE_SETTINGS = {
    "preferredStageLengthKm": 75,
    "maxGapWithoutResupplyKm": 50,
}

DEFAULT_APPEARANCE = {
    "theme": "system",
    "mapStyle": "standard",
    "language": "en",
    "units": "metric",
}


@dataclass
class PlanningDefaults:
    poi_profile: PoiPlanningProfile = field(default_factory=lambda: DEFAULT_ULTRA_POI_PROFILE)
    climb_sensitivity: str = "normal"
    climb_config: ClimbDetectionConfig = field(default_factory=lambda: DEFAULT_CLIMB_DETECTION_CONFIG)
    preferred_stage_length_km: int = 75
    max_gap_without_resupply_km: int = 50
    default_arrival_time_window: str | None = None
    default_zone_density: str = "planning"
    developer_mode_enabled: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "poi_profile": self.poi_profile.to_dict(),
            "climb_sensitivity": self.climb_sensitivity,
            "climb_config": self.climb_config.to_dict(),
            "preferred_stage_length_km": self.preferred_stage_length_km,
            "max_gap_without_resupply_km": self.max_gap_without_resupply_km,
            "default_arrival_time_window": self.default_arrival_time_window,
            "default_zone_density": self.default_zone_density,
            "developer_mode_enabled": self.developer_mode_enabled,
        }

    @classmethod
    def from_dict(cls, payload: dict | None) -> PlanningDefaults:
        if not payload:
            return cls()
        climb_payload = payload.get("climb_config") or {}
        return cls(
            poi_profile=PoiPlanningProfile.from_dict(payload.get("poi_profile")),
            climb_sensitivity=str(payload.get("climb_sensitivity") or "normal"),
            climb_config=ClimbDetectionConfig.from_dict(climb_payload),
            preferred_stage_length_km=int(payload.get("preferred_stage_length_km") or 75),
            max_gap_without_resupply_km=int(payload.get("max_gap_without_resupply_km") or 50),
            default_arrival_time_window=payload.get("default_arrival_time_window"),
            default_zone_density=str(payload.get("default_zone_density") or "planning"),
            developer_mode_enabled=bool(payload.get("developer_mode_enabled")),
        )


@dataclass
class AnalysisDefaults:
    refresh_osm_on_analyse: bool = False

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, payload: dict | None) -> AnalysisDefaults:
        if not payload:
            return cls()
        return cls(refresh_osm_on_analyse=bool(payload.get("refresh_osm_on_analyse")))


@dataclass
class AppearanceDefaults:
    theme: str = "system"
    map_style: str = "standard"
    language: str = "en"
    units: str = "metric"

    def to_dict(self) -> dict[str, Any]:
        return {
            "theme": self.theme,
            "mapStyle": self.map_style,
            "language": self.language,
            "units": self.units,
        }

    @classmethod
    def from_dict(cls, payload: dict | None) -> AppearanceDefaults:
        if not payload:
            return cls()
        return cls(
            theme=str(payload.get("theme") or "system"),
            map_style=str(payload.get("mapStyle") or payload.get("map_style") or "standard"),
            language=str(payload.get("language") or "en"),
            units=str(payload.get("units") or "metric"),
        )


@dataclass
class AppSettings:
    planning: PlanningDefaults = field(default_factory=PlanningDefaults)
    analysis: AnalysisDefaults = field(default_factory=AnalysisDefaults)
    appearance: AppearanceDefaults = field(default_factory=AppearanceDefaults)

    def to_dict(self) -> dict[str, Any]:
        return {
            "planning": self.planning.to_dict(),
            "analysis": self.analysis.to_dict(),
            "appearance": self.appearance.to_dict(),
        }

    @classmethod
    def from_dict(cls, payload: dict | None) -> AppSettings:
        if not payload:
            return cls()
        return cls(
            planning=PlanningDefaults.from_dict(payload.get("planning")),
            analysis=AnalysisDefaults.from_dict(payload.get("analysis")),
            appearance=AppearanceDefaults.from_dict(payload.get("appearance")),
        )


class AppSettingsStore:
    def __init__(self, path: Path = APP_SETTINGS_PATH) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def load(self) -> AppSettings:
        if not self.path.is_file():
            return AppSettings()
        return AppSettings.from_dict(json.loads(self.path.read_text(encoding="utf-8")))

    def save(self, settings: AppSettings) -> AppSettings:
        self.path.write_text(json.dumps(settings.to_dict(), indent=2), encoding="utf-8")
        return settings

    def storage_summary(self) -> dict[str, Any]:
        from race_project import RACES_ROOT

        race_count = 0
        total_bytes = 0
        if RACES_ROOT.is_dir():
            for entry in RACES_ROOT.iterdir():
                if entry.is_dir() and (entry / "race.json").is_file():
                    race_count += 1
                    for path in entry.rglob("*"):
                        if path.is_file():
                            total_bytes += path.stat().st_size
        return {
            "races_root": str(RACES_ROOT),
            "race_count": race_count,
            "storage_bytes": total_bytes,
        }


app_settings_store = AppSettingsStore()
