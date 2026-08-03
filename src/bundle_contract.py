"""Companion bundle version contract — keep in sync with shared/sync/bundleContract.ts."""

from __future__ import annotations

BUNDLE_SEMANTIC_VERSION = "1.0.0"
CURRENT_SCHEMA_VERSION = 5
MIN_MIGRATABLE_SCHEMA_VERSION = 1
MINIMUM_COMPANION_VERSION = "0.2.3"
MINIMUM_DESKTOP_VERSION = "0.2.0"


def current_bundle_version_info() -> dict[str, str | int]:
    return {
        "bundleVersion": BUNDLE_SEMANTIC_VERSION,
        "schemaVersion": CURRENT_SCHEMA_VERSION,
        "minimumCompanionVersion": MINIMUM_COMPANION_VERSION,
        "minimumDesktopVersion": MINIMUM_DESKTOP_VERSION,
    }


def apply_bundle_version_fields(bundle: dict) -> dict:
    info = current_bundle_version_info()
    return {**bundle, **info}
