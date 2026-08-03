"""Push local races to Supabase and serve Companion sync data."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import httpx

from cloud.config import cloud_config
from bundle_checksum import compute_bundle_checksum
from bundle_contract import CURRENT_SCHEMA_VERSION, apply_bundle_version_fields
from bundle_validate import validate_companion_bundle
from companion_bundle import build_companion_bundle
from race_project import race_store, gpx_fingerprint
from significant_climbs import significant_climbs


class CloudSyncError(RuntimeError):
    pass


def _headers(access_token: str | None = None) -> dict[str, str]:
    service_key = cloud_config.service_role_key
    api_key = service_key or cloud_config.anon_key
    headers = {"apikey": api_key, "Content-Type": "application/json"}
    # Legacy JWT service_role keys use Bearer; new sb_secret_* keys must not.
    if service_key and not service_key.startswith("sb_secret_") and not service_key.startswith(
        "sb_publishable_"
    ):
        headers["Authorization"] = f"Bearer {service_key}"
    elif access_token:
        headers["Authorization"] = f"Bearer {access_token}"
    return headers


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _storage_path(user_id: str, race_id: str, filename: str) -> str:
    return f"{user_id}/{race_id}/{filename}"


def _upload_bytes(path: str, payload: bytes, content_type: str, access_token: str | None = None) -> None:
    url = f"{cloud_config.url}/storage/v1/object/{cloud_config.storage_bucket}/{path}"
    headers = {
        **_headers(access_token),
        "Content-Type": content_type,
        "x-upsert": "true",
    }
    response = httpx.post(
        url,
        content=payload,
        headers=headers,
        timeout=120.0,
    )
    if response.status_code >= 400:
        raise CloudSyncError(f"Storage upload failed ({path}): {response.text}")


def _get_race_row(user_id: str, race_id: str, access_token: str | None = None) -> dict[str, Any] | None:
    url = f"{cloud_config.url}/rest/v1/races"
    response = httpx.get(
        url,
        params={"id": f"eq.{race_id}", "user_id": f"eq.{user_id}", "select": "*"},
        headers=_headers(access_token),
        timeout=30.0,
    )
    if response.status_code >= 400:
        raise CloudSyncError(f"Failed to load cloud race: {response.text}")
    rows = response.json()
    return rows[0] if rows else None


def _upsert_race_row(payload: dict[str, Any], access_token: str | None = None) -> dict[str, Any]:
    url = f"{cloud_config.url}/rest/v1/races"
    response = httpx.post(
        url,
        headers={**_headers(access_token), "Prefer": "resolution=merge-duplicates,return=representation"},
        json=payload,
        timeout=30.0,
    )
    if response.status_code >= 400:
        raise CloudSyncError(f"Failed to upsert race: {response.text}")
    rows = response.json()
    return rows[0] if rows else payload


def _significant_climb_count(roadbook: dict[str, Any] | None) -> int | None:
    if not roadbook:
        return None
    climbs = significant_climbs(roadbook.get("climbs") or [])
    if climbs:
        return len(climbs)
    summary_count = (roadbook.get("summary") or {}).get("climb_count")
    if isinstance(summary_count, int):
        return summary_count
    return 0


def _download_bytes(path: str, access_token: str | None = None) -> bytes:
    url = f"{cloud_config.url}/storage/v1/object/{cloud_config.storage_bucket}/{path}"
    response = httpx.get(url, headers=_headers(access_token), timeout=120.0)
    if response.status_code >= 400:
        raise CloudSyncError(f"Failed to download {path}: {response.text}")
    return response.content


def _find_cloud_race_by_gpx_content(
    user_id: str,
    fingerprint: str,
    *,
    local_race_id: str,
    access_token: str | None = None,
) -> str | None:
    """Fallback when legacy cloud rows never stored gpx_fingerprint in preparation."""
    if not fingerprint:
        return None
    matches: list[tuple[int, str]] = []
    for race in list_sync_races(user_id, access_token):
        race_id = str(race["id"])
        if race.get("gpx_fingerprint") == fingerprint:
            matches.append((int(race.get("companion_revision") or 0), race_id))
            continue
        try:
            gpx_bytes = _download_bytes(_storage_path(user_id, race_id, "route.gpx"), access_token)
        except CloudSyncError:
            continue
        if gpx_fingerprint(gpx_bytes) == fingerprint:
            matches.append((int(race.get("companion_revision") or 0), race_id))
    if not matches:
        return None
    preferred = [entry for entry in matches if entry[1] != local_race_id]
    ranked = preferred or matches
    ranked.sort(key=lambda entry: entry[0], reverse=True)
    return ranked[0][1]


def _resolve_cloud_race_target(
    user_id: str,
    local_race_id: str,
    gpx_fingerprint_value: str,
    access_token: str | None = None,
) -> tuple[str, dict[str, Any] | None]:
    """Map a local race to the cloud row/storage id that Companion already uses."""
    matched_ids: list[str] = []
    if gpx_fingerprint_value:
        for match in find_cloud_races_by_gpx_fingerprint(user_id, gpx_fingerprint_value, access_token):
            cloud_id = str(match.get("id") or "")
            if cloud_id:
                matched_ids.append(cloud_id)
        content_match = _find_cloud_race_by_gpx_content(
            user_id,
            gpx_fingerprint_value,
            local_race_id=local_race_id,
            access_token=access_token,
        )
        if content_match and content_match not in matched_ids:
            matched_ids.append(content_match)

    if matched_ids:
        preferred = [race_id for race_id in matched_ids if race_id != local_race_id]
        candidates = preferred or matched_ids
        best_id = candidates[0]
        best_revision = -1
        for candidate_id in candidates:
            row = _get_race_row(user_id, candidate_id, access_token)
            revision = int((row or {}).get("companion_revision") or 0)
            if revision > best_revision:
                best_revision = revision
                best_id = candidate_id
        return best_id, _get_race_row(user_id, best_id, access_token)

    existing_local = _get_race_row(user_id, local_race_id, access_token)
    return local_race_id, existing_local


def _download_json(path: str, access_token: str | None = None) -> dict[str, Any]:
    url = f"{cloud_config.url}/storage/v1/object/{cloud_config.storage_bucket}/{path}"
    response = httpx.get(url, headers=_headers(access_token), timeout=120.0)
    if response.status_code >= 400:
        raise CloudSyncError(f"Failed to download {path}: {response.text}")
    return response.json()


def push_race(user_id: str, race_id: str, access_token: str | None = None) -> dict[str, Any]:
    if not cloud_config.sync_enabled and not access_token:
        raise CloudSyncError("Cloud sync is not configured.")

    race = race_store.get_race(race_id)
    summary = race_store.get_summary(race_id)
    cloud_race_id, existing = _resolve_cloud_race_target(
        user_id,
        race_id,
        race.meta.gpx_fingerprint,
        access_token,
    )
    next_revision = int((existing or {}).get("companion_revision") or 0) + 1

    gpx_path = race_store.get_gpx_path(race_id)
    if gpx_path.exists():
        _upload_bytes(
            _storage_path(user_id, cloud_race_id, "route.gpx"),
            gpx_path.read_bytes(),
            "application/gpx+xml",
            access_token,
        )

    roadbook = race_store.load_analysis(race_id)
    has_bundle = False
    bundle: dict[str, Any] | None = None
    analyzed_at = race.analysis.get("analyzed_at")
    significant_climb_count = _significant_climb_count(roadbook)
    if roadbook is not None:
        analysis_bytes = json.dumps(roadbook, separators=(",", ":")).encode("utf-8")
        _upload_bytes(
            _storage_path(user_id, cloud_race_id, "analysis.json"),
            analysis_bytes,
            "application/json",
            access_token,
        )
        bundle = build_companion_bundle(
            cloud_race_id,
            roadbook,
            race.preparation.to_dict(),
            revision=next_revision,
        )
        valid, validation_errors = validate_companion_bundle(bundle)
        if not valid:
            raise CloudSyncError(
                "Refusing to upload invalid companion bundle: " + "; ".join(validation_errors)
            )
        bundle_bytes = json.dumps(bundle, separators=(",", ":")).encode("utf-8")
        _upload_bytes(
            _storage_path(user_id, cloud_race_id, "companion-bundle.json"),
            bundle_bytes,
            "application/json",
            access_token,
        )
        has_bundle = True
        analyzed_at = analyzed_at or _utc_now()
        preparation = {
            **race.preparation.to_dict(),
            "gpx_fingerprint": race.meta.gpx_fingerprint,
            "significant_climb_count": significant_climb_count,
            "bundle_checksum": bundle.get("bundleChecksum"),
            "bundle_schema_version": bundle.get("schemaVersion"),
            "bundle_semantic_version": bundle.get("bundleVersion"),
            "bundle_generated_at": bundle.get("generatedAt"),
        }
    else:
        preparation = {
            **race.preparation.to_dict(),
            "gpx_fingerprint": race.meta.gpx_fingerprint,
            "significant_climb_count": significant_climb_count,
        }

    row = _upsert_race_row(
        {
            "id": cloud_race_id,
            "user_id": user_id,
            "name": summary.name,
            "distance_km": summary.distance_km,
            "elevation_gain_m": summary.elevation_gain_m,
            "preparation": preparation,
            "companion_revision": next_revision if has_bundle else int((existing or {}).get("companion_revision") or 0),
            "has_bundle": has_bundle,
            "analyzed_at": analyzed_at,
            "updated_at": _utc_now(),
            "deleted_at": None,
        },
        access_token,
    )
    revision = int(row.get("companion_revision", next_revision))
    return {
        "race_id": cloud_race_id,
        "local_race_id": race_id,
        "name": summary.name,
        "companion_revision": revision,
        "version": revision,
        "bundle_version": revision,
        "bundle_checksum": bundle.get("bundleChecksum") if bundle else None,
        "bundle_schema_version": bundle.get("schemaVersion") if bundle else None,
        "has_bundle": has_bundle,
        "synced_at": _utc_now(),
    }


def _cloud_bundle_is_stale(
    user_id: str,
    cloud_race_id: str,
    roadbook: dict[str, Any],
    access_token: str | None = None,
) -> bool:
    """True when stored companion-bundle.json is older than local analysis."""
    try:
        bundle = get_companion_bundle(user_id, cloud_race_id, access_token)
    except CloudSyncError:
        return True
    schema = int(bundle.get("schemaVersion") or 0)
    if schema < CURRENT_SCHEMA_VERSION:
        return True
    local_climb_count = _significant_climb_count(roadbook)
    bundle_climb_count = len(bundle.get("climbs") or [])
    if local_climb_count is not None and bundle_climb_count != int(local_climb_count):
        return True
    return False


def _race_needs_upload(
    race_id: str,
    existing: dict[str, Any] | None,
    *,
    user_id: str | None = None,
    access_token: str | None = None,
) -> bool:
    """Return True when local race should be pushed to cloud."""
    roadbook = race_store.load_analysis(race_id)
    if roadbook is None:
        return False
    race = race_store.get_race(race_id)
    cloud_race_id = race_id
    if user_id:
        cloud_race_id, existing = _resolve_cloud_race_target(
            user_id,
            race_id,
            race.meta.gpx_fingerprint,
            access_token,
        )
    if existing is None:
        return True
    if not existing.get("has_bundle"):
        return True
    preparation = existing.get("preparation") or {}
    cloud_schema = preparation.get("bundle_schema_version")
    cloud_climb_count = preparation.get("significant_climb_count")
    if cloud_schema is None or cloud_climb_count is None:
        return True
    if isinstance(cloud_schema, int) and cloud_schema < CURRENT_SCHEMA_VERSION:
        return True
    local_climb_count = _significant_climb_count(roadbook)
    if (
        local_climb_count is not None
        and cloud_climb_count is not None
        and int(local_climb_count) != int(cloud_climb_count)
    ):
        return True
    if user_id and _cloud_bundle_is_stale(user_id, cloud_race_id, roadbook, access_token):
        return True
    summary = race_store.get_summary(race_id)
    local_updated = summary.updated_at
    cloud_updated = existing.get("updated_at")
    if not cloud_updated:
        return True
    try:
        local_dt = datetime.fromisoformat(str(local_updated).replace("Z", "+00:00"))
        cloud_dt = datetime.fromisoformat(str(cloud_updated).replace("Z", "+00:00"))
        if local_dt.tzinfo is None:
            local_dt = local_dt.replace(tzinfo=timezone.utc)
        if cloud_dt.tzinfo is None:
            cloud_dt = cloud_dt.replace(tzinfo=timezone.utc)
        return local_dt > cloud_dt
    except ValueError:
        return True


def push_all_local_races(user_id: str, access_token: str | None = None) -> dict[str, Any]:
    uploaded: list[dict[str, Any]] = []
    failed: list[dict[str, str]] = []
    skipped: list[dict[str, str]] = []
    for summary in race_store.list_races():
        race = race_store.get_race(summary.id)
        _, existing = _resolve_cloud_race_target(
            user_id,
            summary.id,
            race.meta.gpx_fingerprint,
            access_token,
        )
        if existing and not _race_needs_upload(
            summary.id,
            existing,
            user_id=user_id,
            access_token=access_token,
        ):
            skipped.append({
                "race_id": summary.id,
                "name": summary.name,
                "reason": "unchanged",
            })
            continue
        try:
            result = push_race(user_id, summary.id, access_token)
            uploaded.append(result)
        except Exception as exc:  # pragma: no cover - surfaced to client
            failed.append({
                "race_id": summary.id,
                "name": summary.name,
                "error": str(exc),
            })
    return {"uploaded": uploaded, "failed": failed, "skipped": skipped}


def list_sync_races(user_id: str, access_token: str | None = None) -> list[dict[str, Any]]:
    url = f"{cloud_config.url}/rest/v1/races"
    response = httpx.get(
        url,
        params={
            "user_id": f"eq.{user_id}",
            "deleted_at": "is.null",
            "select": "id,name,distance_km,elevation_gain_m,companion_revision,updated_at,analyzed_at,has_bundle,preparation",
            "order": "updated_at.desc",
        },
        headers=_headers(access_token),
        timeout=30.0,
    )
    if response.status_code >= 400:
        raise CloudSyncError(f"Failed to list cloud races: {response.text}")
    rows = response.json()
    races: list[dict[str, Any]] = []
    for row in rows:
        preparation = row.get("preparation") or {}
        races.append({
            "id": row["id"],
            "name": row["name"],
            "distance_km": row.get("distance_km"),
            "elevation_gain_m": row.get("elevation_gain_m"),
            "companion_revision": row.get("companion_revision") or 0,
            "updated_at": row.get("updated_at"),
            "analyzed_at": row.get("analyzed_at"),
            "has_bundle": bool(row.get("has_bundle")),
            "bundle_checksum": preparation.get("bundle_checksum"),
            "bundle_schema_version": preparation.get("bundle_schema_version"),
            "gpx_fingerprint": preparation.get("gpx_fingerprint"),
            "significant_climb_count": preparation.get("significant_climb_count"),
        })
    return races


def find_cloud_races_by_gpx_fingerprint(
    user_id: str,
    fingerprint: str,
    access_token: str | None = None,
) -> list[dict[str, Any]]:
    if not fingerprint:
        return []
    matches: list[dict[str, Any]] = []
    for race in list_sync_races(user_id, access_token):
        if race.get("gpx_fingerprint") == fingerprint:
            matches.append(race)
    return matches


def get_companion_bundle(user_id: str, race_id: str, access_token: str | None = None) -> dict[str, Any]:
    row = _get_race_row(user_id, race_id, access_token)
    if row is None:
        raise CloudSyncError("Race not found.")
    if not row.get("has_bundle"):
        raise CloudSyncError("This race has not been analyzed yet.")
    path = _storage_path(user_id, race_id, "companion-bundle.json")
    return _download_json(path, access_token)


def regenerate_cloud_bundle(user_id: str, race_id: str, access_token: str | None = None) -> dict[str, Any]:
    """Rebuild companion bundle from cloud analysis.json and re-upload."""
    if not cloud_config.sync_enabled and not access_token:
        raise CloudSyncError("Cloud sync is not configured.")

    row = _get_race_row(user_id, race_id, access_token)
    if row is None:
        raise CloudSyncError("Race not found.")

    analysis_path = _storage_path(user_id, race_id, "analysis.json")
    try:
        roadbook = _download_json(analysis_path, access_token)
    except CloudSyncError as exc:
        raise CloudSyncError(
            "Cannot regenerate bundle — analysis.json missing in cloud. Re-analyze on Desktop and Sync to Phone."
        ) from exc

    preparation = dict(row.get("preparation") or {})
    next_revision = int(row.get("companion_revision") or 0) + 1
    bundle = build_companion_bundle(
        race_id,
        roadbook,
        preparation,
        revision=next_revision,
    )
    valid, validation_errors = validate_companion_bundle(bundle)
    if not valid:
        raise CloudSyncError(
            "Regenerated bundle failed validation: " + "; ".join(validation_errors)
        )
    bundle_bytes = json.dumps(bundle, separators=(",", ":")).encode("utf-8")
    _upload_bytes(
        _storage_path(user_id, race_id, "companion-bundle.json"),
        bundle_bytes,
        "application/json",
        access_token,
    )

    updated_preparation = {
        **preparation,
        "significant_climb_count": _significant_climb_count(roadbook),
        "bundle_checksum": bundle.get("bundleChecksum"),
        "bundle_schema_version": bundle.get("schemaVersion"),
        "bundle_semantic_version": bundle.get("bundleVersion"),
        "bundle_generated_at": bundle.get("generatedAt"),
    }
    updated_row = _upsert_race_row(
        {
            "id": race_id,
            "user_id": user_id,
            "name": row.get("name"),
            "distance_km": row.get("distance_km"),
            "elevation_gain_m": row.get("elevation_gain_m"),
            "preparation": updated_preparation,
            "companion_revision": next_revision,
            "has_bundle": True,
            "analyzed_at": row.get("analyzed_at") or _utc_now(),
            "updated_at": _utc_now(),
            "deleted_at": None,
        },
        access_token,
    )
    revision = int(updated_row.get("companion_revision", next_revision))
    return {
        "race_id": race_id,
        "name": row.get("name"),
        "companion_revision": revision,
        "bundle_checksum": bundle.get("bundleChecksum"),
        "bundle_schema_version": bundle.get("schemaVersion"),
        "regenerated_at": _utc_now(),
    }


def regenerate_all_cloud_bundles(user_id: str, access_token: str | None = None) -> dict[str, Any]:
    regenerated: list[dict[str, Any]] = []
    failed: list[dict[str, str]] = []
    races = list_sync_races(user_id, access_token)
    for race in races:
        if not race.get("has_bundle"):
            continue
        race_id = str(race.get("id") or "")
        if not race_id:
            continue
        try:
            regenerated.append(regenerate_cloud_bundle(user_id, race_id, access_token))
        except Exception as exc:  # pragma: no cover - surfaced to client
            failed.append({
                "race_id": race_id,
                "name": str(race.get("name") or race_id),
                "error": str(exc),
            })
    return {"regenerated": regenerated, "failed": failed}


def soft_delete_race(user_id: str, race_id: str, access_token: str | None = None) -> None:
    url = f"{cloud_config.url}/rest/v1/races"
    response = httpx.patch(
        url,
        params={"id": f"eq.{race_id}", "user_id": f"eq.{user_id}"},
        headers=_headers(access_token),
        json={"deleted_at": _utc_now()},
        timeout=30.0,
    )
    if response.status_code >= 400:
        raise CloudSyncError(f"Failed to delete cloud race: {response.text}")


def _queue_pending_verifications(
    preparation: dict[str, Any],
    verifications: list[dict[str, Any]],
) -> tuple[dict[str, Any], list[str]]:
    pending = dict(preparation.get("companion_pending_verifications") or {})
    accepted: list[str] = []
    for raw in verifications:
        if not isinstance(raw, dict):
            continue
        record_id = str(raw.get("id") or "")
        if not record_id:
            continue
        pending[record_id] = {
            **raw,
            "reviewStatus": "pending",
        }
        accepted.append(record_id)
    preparation = {
        **preparation,
        "companion_pending_verifications": pending,
    }
    return preparation, accepted


def _push_bundle_for_preparation(
    user_id: str,
    race_id: str,
    preparation: dict[str, Any],
    existing_row: dict[str, Any],
    access_token: str | None = None,
) -> int:
    next_revision = int(existing_row.get("companion_revision") or 0) + 1
    path = _storage_path(user_id, race_id, "companion-bundle.json")
    bundle = _download_json(path, access_token)
    bundle["revision"] = next_revision
    bundle["syncedAt"] = _utc_now()
    verified_stops = preparation.get("verified_stops") or {}
    verified_count = 0
    for stop in bundle.get("stops") or []:
        if not isinstance(stop, dict):
            continue
        zone_key = str(stop.get("zoneId") or "")
        poi_id = str(stop.get("poiId") or stop.get("poi_id") or "")
        record = None
        if poi_id:
            record = verified_stops.get(poi_id)
        if not isinstance(record, dict):
            record = verified_stops.get(zone_key)
        if not isinstance(record, dict):
            continue
        status = record.get("status")
        if status == "verified":
            stop["verificationStatus"] = "verified"
            stop["verificationDate"] = record.get("updated_at")
            verified_count += 1
        elif status in ("rejected", "deferred"):
            stop["verificationStatus"] = "needs_review"
            notes = str(record.get("reject_notes") or "").strip()
            if notes:
                stop["notes"] = notes
        else:
            stop["verificationStatus"] = "unverified"
    total_stops = len([item for item in bundle.get("stops") or [] if isinstance(item, dict)])
    unverified_count = max(0, total_stops - verified_count)
    dashboard = dict(bundle.get("dashboardStats") or {})
    dashboard["verifiedStops"] = verified_count
    dashboard["unverifiedStops"] = unverified_count
    dashboard["remainingStops"] = unverified_count
    bundle["dashboardStats"] = dashboard
    bundle["bundleChecksum"] = compute_bundle_checksum(bundle)
    bundle_bytes = json.dumps(bundle, separators=(",", ":")).encode("utf-8")
    _upload_bytes(path, bundle_bytes, "application/json", access_token)
    return next_revision


def add_companion_verifications(
    user_id: str,
    verifications: list[dict[str, Any]],
    access_token: str | None = None,
) -> list[str]:
    if not verifications:
        return []

    by_race: dict[str, list[dict[str, Any]]] = {}
    for item in verifications:
        race_id = str(item.get("raceId") or item.get("race_id") or "")
        if race_id:
            by_race.setdefault(race_id, []).append(item)

    accepted: list[str] = []
    for race_id, items in by_race.items():
        try:
            accepted.extend(race_store.add_companion_verifications(race_id, items))
            if cloud_config.sync_enabled or access_token:
                race = race_store.get_race(race_id)
                row = _get_race_row(user_id, race_id, access_token)
                if row is not None:
                    push_race(user_id, race_id, access_token)
            continue
        except FileNotFoundError:
            pass

        row = _get_race_row(user_id, race_id, access_token)
        if row is None:
            continue
        preparation, race_accepted = _queue_pending_verifications(
            dict(row.get("preparation") or {}),
            items,
        )
        _upsert_race_row(
            {
                **row,
                "preparation": preparation,
                "updated_at": _utc_now(),
            },
            access_token,
        )
        accepted.extend(race_accepted)

    return accepted


def list_companion_verifications(
    user_id: str,
    race_id: str,
    access_token: str | None = None,
    *,
    status: str = "pending",
) -> list[dict[str, Any]]:
    try:
        return race_store.list_companion_verifications(race_id, status=status)
    except FileNotFoundError:
        pass

    row = _get_race_row(user_id, race_id, access_token)
    if row is None:
        return []
    preparation = row.get("preparation") or {}
    pending = preparation.get("companion_pending_verifications") or {}
    history = preparation.get("companion_verification_history") or {}
    if status == "history":
        records = [value for value in history.values() if isinstance(value, dict)]
    elif status == "all":
        records = [
            value
            for value in [*pending.values(), *history.values()]
            if isinstance(value, dict)
        ]
    else:
        records = [
            value
            for value in pending.values()
            if isinstance(value, dict)
            and str(value.get("reviewStatus") or value.get("review_status")) == "pending"
        ]
    records.sort(
        key=lambda item: str(item.get("submittedAt") or item.get("submitted_at") or ""),
        reverse=True,
    )
    return records


def review_companion_verification(
    user_id: str,
    race_id: str,
    verification_id: str,
    *,
    action: str,
    access_token: str | None = None,
) -> bool:
    try:
        updated = race_store.review_companion_verification(
            race_id,
            verification_id,
            action=action,
        )
        if updated is not None and (cloud_config.sync_enabled or access_token):
            push_race(user_id, race_id, access_token)
        return updated is not None
    except FileNotFoundError:
        pass

    row = _get_race_row(user_id, race_id, access_token)
    if row is None:
        return False
    preparation = dict(row.get("preparation") or {})
    pending = dict(preparation.get("companion_pending_verifications") or {})
    record = pending.get(verification_id)
    if not isinstance(record, dict):
        return False

    if action == "accept":
        updates = record.get("updates") if isinstance(record.get("updates"), dict) else {}
        zone_id = str(record.get("zoneId") or record.get("zone_id") or "")
        poi_id = str(record.get("poiId") or record.get("poi_id") or "")
        key = poi_id or zone_id
        verified = dict(preparation.get("verified_stops") or {})
        verified[key] = {
            "status": updates.get("status") or "verified",
            "reject_reason": updates.get("rejectReason") or updates.get("reject_reason"),
            "reject_notes": updates.get("notes"),
            "updated_at": record.get("submittedAt") or record.get("submitted_at") or _utc_now(),
            "poi_id": poi_id or None,
        }
        preparation["verified_stops"] = verified

    history = dict(preparation.get("companion_verification_history") or {})
    record["reviewStatus"] = "accepted" if action == "accept" else "rejected"
    record["reviewedAt"] = _utc_now()
    record["reviewAction"] = action
    del pending[verification_id]
    history[verification_id] = record
    preparation["companion_pending_verifications"] = pending
    preparation["companion_verification_history"] = history
    _upsert_race_row(
        {
            **row,
            "preparation": preparation,
            "updated_at": _utc_now(),
        },
        access_token,
    )
    if cloud_config.sync_enabled or access_token:
        push_race(user_id, race_id, access_token)
    return True


def compare_desktop_companion(
    user_id: str,
    race_id: str,
    access_token: str | None = None,
) -> dict[str, Any]:
    """Compare locally-built bundle against cloud-stored companion bundle."""
    race = race_store.get_race(race_id)
    roadbook = race_store.load_analysis(race_id)
    if roadbook is None:
        raise CloudSyncError("Local analysis not found.")

    cloud_race_id, row = _resolve_cloud_race_target(
        user_id,
        race_id,
        race.meta.gpx_fingerprint,
        access_token,
    )
    cloud_revision = int((row or {}).get("companion_revision") or 0)
    local_bundle = build_companion_bundle(
        cloud_race_id,
        roadbook,
        race.preparation.to_dict(),
        revision=cloud_revision,
    )

    cloud_bundle: dict[str, Any] | None = None
    if row and row.get("has_bundle"):
        try:
            cloud_bundle = get_companion_bundle(user_id, cloud_race_id, access_token)
        except CloudSyncError:
            cloud_bundle = None

    def _stop_names(bundle: dict[str, Any] | None) -> list[str]:
        if not bundle:
            return []
        return [str(stop.get("name") or "") for stop in bundle.get("stops") or [] if isinstance(stop, dict)]

    def _climb_ids(bundle: dict[str, Any] | None) -> list[str]:
        if not bundle:
            return []
        return [str(climb.get("id") or "") for climb in bundle.get("climbs") or [] if isinstance(climb, dict)]

    differences: list[str] = []
    if cloud_bundle is None:
        differences.append("Cloud bundle missing")
    else:
        if len(local_bundle.get("stops") or []) != len(cloud_bundle.get("stops") or []):
            differences.append(
                f"Stop count: desktop {len(local_bundle.get('stops') or [])} vs cloud {len(cloud_bundle.get('stops') or [])}"
            )
        if len(local_bundle.get("climbs") or []) != len(cloud_bundle.get("climbs") or []):
            differences.append(
                f"Climb count: desktop {len(local_bundle.get('climbs') or [])} vs cloud {len(cloud_bundle.get('climbs') or [])}"
            )
        local_checksum = local_bundle.get("bundleChecksum")
        cloud_checksum = cloud_bundle.get("bundleChecksum")
        if local_checksum and cloud_checksum and local_checksum != cloud_checksum:
            differences.append(f"Checksum mismatch: {local_checksum[:12]}… vs {cloud_checksum[:12]}…")
        local_climbs = _climb_ids(local_bundle)
        cloud_climbs = _climb_ids(cloud_bundle)
        if local_climbs != cloud_climbs:
            differences.append(f"Climb IDs differ: {local_climbs} vs {cloud_climbs}")
        local_stops = _stop_names(local_bundle)
        cloud_stops = _stop_names(cloud_bundle)
        if local_stops != cloud_stops:
            only_local = [name for name in local_stops if name not in cloud_stops]
            only_cloud = [name for name in cloud_stops if name not in local_stops]
            if only_local:
                differences.append(f"Stops only on desktop: {', '.join(only_local[:5])}")
            if only_cloud:
                differences.append(f"Stops only on cloud: {', '.join(only_cloud[:5])}")
        local_has_oilprix = any("oilprix" in name.lower() for name in local_stops)
        cloud_has_oilprix = any("oilprix" in name.lower() for name in cloud_stops)
        if local_has_oilprix != cloud_has_oilprix:
            differences.append(
                f"Oilprix: desktop={'yes' if local_has_oilprix else 'no'} vs cloud={'yes' if cloud_has_oilprix else 'no'}"
            )

    return {
        "raceId": race_id,
        "cloudRaceId": cloud_race_id,
        "identical": len(differences) == 0 and cloud_bundle is not None,
        "differences": differences,
        "desktop": {
            "revision": cloud_revision,
            "schemaVersion": local_bundle.get("schemaVersion"),
            "bundleChecksum": local_bundle.get("bundleChecksum"),
            "generatedAt": local_bundle.get("generatedAt"),
            "stopCount": len(local_bundle.get("stops") or []),
            "climbCount": len(local_bundle.get("climbs") or []),
            "climbIds": _climb_ids(local_bundle),
            "stopNames": _stop_names(local_bundle),
        },
        "cloud": {
            "revision": cloud_bundle.get("revision") if cloud_bundle else None,
            "schemaVersion": cloud_bundle.get("schemaVersion") if cloud_bundle else None,
            "bundleChecksum": cloud_bundle.get("bundleChecksum") if cloud_bundle else None,
            "generatedAt": cloud_bundle.get("generatedAt") if cloud_bundle else None,
            "stopCount": len(cloud_bundle.get("stops") or []) if cloud_bundle else 0,
            "climbCount": len(cloud_bundle.get("climbs") or []) if cloud_bundle else 0,
            "climbIds": _climb_ids(cloud_bundle),
            "stopNames": _stop_names(cloud_bundle),
        },
    }
