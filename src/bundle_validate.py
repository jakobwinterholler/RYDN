"""Validate companion bundles before cloud upload (mirrors shared/sync/bundleValidation.ts)."""

from __future__ import annotations

from typing import Any

from bundle_checksum import compute_bundle_checksum
from bundle_contract import CURRENT_SCHEMA_VERSION


def diagnose_companion_bundle(bundle: Any) -> list[str]:
    errors: list[str] = []
    if not isinstance(bundle, dict):
        return ["Bundle is not an object"]

    schema = bundle.get("schemaVersion")
    if not isinstance(schema, int):
        errors.append('Missing field "schemaVersion"')
    elif schema < CURRENT_SCHEMA_VERSION:
        errors.append(f"Schema version {schema} is outdated (need {CURRENT_SCHEMA_VERSION}+)")

    if not bundle.get("generatedAt") and not bundle.get("exportedAt"):
        errors.append('Missing field "generatedAt"')
    if not bundle.get("bundleChecksum"):
        errors.append('Missing field "bundleChecksum"')
    if not bundle.get("bundleVersion"):
        errors.append('Missing field "bundleVersion"')

    race = bundle.get("race")
    if not isinstance(race, dict) or not race.get("id"):
        errors.append('Missing field "race.id"')
    if not isinstance(race, dict) or not race.get("name"):
        errors.append('Missing field "race.name"')

    stops = bundle.get("stops")
    if not isinstance(stops, list):
        errors.append('Missing field "stops" (array)')
    elif isinstance(stops, list):
        for index, stop in enumerate(stops):
            if not isinstance(stop, dict):
                errors.append(f"Stop {index + 1} is not an object")
                continue
            if stop.get("lat") is None or stop.get("lon") is None:
                errors.append(f"Stop {index + 1} missing coordinates")
            if not stop.get("name"):
                errors.append(f"Stop {index + 1} missing name")
            if stop.get("zoneId") is None:
                errors.append(f"Stop {index + 1} missing zoneId")

    route = bundle.get("route")
    if not isinstance(route, dict) or not isinstance(route.get("coordinates"), list):
        errors.append('Missing field "route.coordinates"')
    elif isinstance(route.get("coordinates"), list) and len(route["coordinates"]) == 0:
        errors.append("Route coordinates array is empty")

    if not isinstance(bundle.get("climbs"), list):
        errors.append('Missing field "climbs" (array)')
    if not isinstance(bundle.get("unsupportedSections"), list):
        errors.append('Missing field "unsupportedSections" (array)')

    revision = bundle.get("revision", bundle.get("bundle_version"))
    if revision is None or (isinstance(revision, int) and revision < 0):
        errors.append('Missing field "revision"')

    stored_checksum = bundle.get("bundleChecksum")
    if isinstance(stored_checksum, str) and stored_checksum:
        computed = compute_bundle_checksum(bundle)
        if computed != stored_checksum:
            errors.append("Bundle checksum mismatch")

    return errors


def validate_companion_bundle(bundle: Any) -> tuple[bool, list[str]]:
    errors = diagnose_companion_bundle(bundle)
    return len(errors) == 0, errors
