"""Redeem codes — JSON store under data/. Single-use or reusable admin codes.

Dev seeds (reusable):
  ``RYDN-PRO-BETA`` → Pro
  ``RYDN-FREE-TEST`` → Free (clears local Pro flags for QA)
  ``RYDN-ONBOARD`` → show product onboarding (no tier change)
"""

from __future__ import annotations

import json
import os
import threading
import time
from typing import Any, Optional

from ..paths import data_root
from .. import users as users_mod
from .entitlement import grant_redeem_pro, revoke_to_free
from .tiers import PERSISTED_TIERS, normalize_persisted_tier

_LOCK = threading.Lock()

# Special non-tier actions (must not collide with persisted tiers).
ACTION_ONBOARDING = "onboarding"

# Documented test / beta code — reusable so every local account can unlock Pro.
SEED_CODE = "RYDN-PRO-BETA"
_SEED_RECORD: dict[str, Any] = {
    "tier": "pro",
    "reusable": True,
    "active": True,
    "note": "Development / beta Pro unlock (reusable)",
    "redemptions": [],
}

SEED_FREE_CODE = "RYDN-FREE-TEST"
_SEED_FREE_RECORD: dict[str, Any] = {
    "tier": "free",
    "reusable": True,
    "active": True,
    "note": "QA: reset account to Free (clears redeem + local Stripe status)",
    "redemptions": [],
}

SEED_ONBOARD_CODE = "RYDN-ONBOARD"
_SEED_ONBOARD_RECORD: dict[str, Any] = {
    "action": ACTION_ONBOARDING,
    "reusable": True,
    "active": True,
    "note": "QA / invite: open product onboarding (no plan change)",
    "redemptions": [],
}


def _codes_path() -> str:
    return os.path.join(data_root(), "redeem_codes.json")


def _normalize_code(raw: str) -> str:
    return " ".join(str(raw or "").strip().upper().split())


def _ensure_seed(store: dict[str, Any]) -> dict[str, Any]:
    key = _normalize_code(SEED_CODE)
    if key not in store:
        store[key] = dict(_SEED_RECORD)
    free_key = _normalize_code(SEED_FREE_CODE)
    if free_key not in store:
        store[free_key] = dict(_SEED_FREE_RECORD)
    onboard_key = _normalize_code(SEED_ONBOARD_CODE)
    if onboard_key not in store:
        store[onboard_key] = dict(_SEED_ONBOARD_RECORD)
    return store


def _load() -> dict[str, Any]:
    path = _codes_path()
    try:
        with open(path, "r", encoding="utf-8") as f:
            raw = json.load(f)
        if not isinstance(raw, dict):
            raw = {}
    except (OSError, json.JSONDecodeError):
        raw = {}
    return _ensure_seed(raw)


def _save(store: dict[str, Any]) -> None:
    path = _codes_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(store, f, indent=2, sort_keys=True)
        f.write("\n")
    os.replace(tmp, path)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def ensure_seed_codes() -> None:
    """Idempotent: write seed code file if missing. Safe to call at startup."""
    with _LOCK:
        store = _load()
        _save(store)


def get_code(code: str) -> Optional[dict[str, Any]]:
    key = _normalize_code(code)
    if not key:
        return None
    with _LOCK:
        rec = _load().get(key)
        return dict(rec) if isinstance(rec, dict) else None


def redeem_code(user_id: str, code: str) -> tuple[dict, Optional[str]]:
    """Validate and apply a redeem code.

    Returns ``(updated_user, redeem_action)`` where ``redeem_action`` is a
    client hint (e.g. ``\"onboarding\"``) or ``None`` for tier-only codes.

    Raises ValueError with a user-facing message on failure.
    """
    key = _normalize_code(code)
    if not key:
        raise ValueError("Enter a redeem code.")

    with _LOCK:
        store = _load()
        rec = store.get(key)
        if not isinstance(rec, dict) or not rec.get("active", True):
            raise ValueError("That code is not valid.")

        action = str(rec.get("action") or "").strip().lower() or None
        is_onboarding = action == ACTION_ONBOARDING

        if not is_onboarding:
            tier = normalize_persisted_tier(rec.get("tier") or "pro")
            if tier not in PERSISTED_TIERS:
                raise ValueError("That code is not valid.")
        else:
            tier = None

        reusable = bool(rec.get("reusable"))
        redemptions = list(rec.get("redemptions") or [])
        already = any(r.get("userId") == user_id for r in redemptions if isinstance(r, dict))

        if not reusable:
            used_by = rec.get("redeemedBy")
            if used_by and used_by != user_id:
                raise ValueError("That code has already been used.")
            if used_by == user_id or already:
                # Idempotent re-redeem by same user.
                pass
            else:
                rec["redeemedBy"] = user_id
                rec["redeemedAt"] = time.time()
                rec["active"] = False
        else:
            if not already:
                redemptions.append({"userId": user_id, "at": time.time()})
                rec["redemptions"] = redemptions

        store[key] = rec
        _save(store)

    if is_onboarding:
        user = users_mod.get_user(user_id)
        if user is None:
            raise KeyError(user_id)
        return user, ACTION_ONBOARDING

    assert tier is not None
    if tier == "free":
        return revoke_to_free(user_id, clear_stripe=True), None
    if tier != "pro":
        from .service import set_subscription_tier

        return set_subscription_tier(user_id, tier, source="redeem"), None
    return grant_redeem_pro(user_id), None
