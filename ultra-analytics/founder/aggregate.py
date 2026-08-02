"""Scan a local ULTRA_DATA_DIR snapshot into a safe founder projection."""

from __future__ import annotations

import json
import os
import sys
import time
from collections import Counter
from typing import Any, Optional


def _backend_on_path() -> None:
    backend = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend"))
    if backend not in sys.path:
        sys.path.insert(0, backend)


def bind_data_dir(data_dir: str) -> str:
    """Point app modules at ``data_dir`` and clear cached secret/paths."""
    root = os.path.abspath(data_dir)
    if not os.path.isdir(root):
        raise FileNotFoundError(f"Data dir not found: {root}")
    os.environ["ULTRA_DATA_DIR"] = root
    # Production encrypts with Railway ULTRA_SECRET. Prefer that env when set;
    # otherwise fall back to the snapshot's .secret file.
    if not (os.environ.get("ULTRA_SECRET") or "").strip():
        secret_file = os.path.join(root, ".secret")
        try:
            with open(secret_file, "r", encoding="utf-8") as f:
                file_secret = f.read().strip()
            if file_secret:
                os.environ["ULTRA_SECRET"] = file_secret
        except OSError:
            pass

    _backend_on_path()
    from app import config as app_config
    from app import routes_store, store, ultras, users
    from app.paths import users_dir

    app_config._secret = None  # type: ignore[attr-defined]
    users._USERS_DIR = users_dir()
    store._USERS_DIR = users_dir()
    routes_store._USERS_DIR = users_dir()
    ultras._USERS_DIR = users_dir()
    return root


def _count_json_files(directory: str, *, exclude_suffix: Optional[str] = None) -> int:
    if not os.path.isdir(directory):
        return 0
    n = 0
    try:
        names = os.listdir(directory)
    except OSError:
        return 0
    for name in names:
        if not name.endswith(".json"):
            continue
        if exclude_suffix and name.endswith(exclude_suffix):
            continue
        n += 1
    return n


def _strava_meta(user: dict) -> dict[str, Any]:
    providers = user.get("providers") or {}
    strava = providers.get("strava") if isinstance(providers, dict) else None
    if not isinstance(strava, dict):
        return {"linked": False, "lastSyncAt": None}
    has_token = bool(
        strava.get("accessToken")
        or strava.get("access_token")
        or strava.get("refreshToken")
        or strava.get("refresh_token")
        or strava.get("athleteId")
    )
    return {
        "linked": has_token,
        "lastSyncAt": strava.get("lastSyncAt"),
    }


def _safe_user_row(user: dict, data_root: str) -> dict[str, Any]:
    from app.subscription.service import get_tier

    uid = str(user["id"])
    user_dir = os.path.join(data_root, "users", uid)
    rides = _count_json_files(os.path.join(user_dir, "rides"))
    routes = _count_json_files(
        os.path.join(user_dir, "routes"), exclude_suffix=".analysis.json"
    )
    ultras_n = _count_json_files(os.path.join(user_dir, "ultras"))

    unlocked = 0
    routes_dir = os.path.join(user_dir, "routes")
    if os.path.isdir(routes_dir):
        try:
            for name in os.listdir(routes_dir):
                if not name.endswith(".json") or name.endswith(".analysis.json"):
                    continue
                try:
                    with open(os.path.join(routes_dir, name), "r", encoding="utf-8") as f:
                        route = json.load(f)
                    if isinstance(route.get("proUnlock"), dict):
                        unlocked += 1
                except (OSError, json.JSONDecodeError):
                    continue
        except OSError:
            pass

    purchases = user.get("racePassPurchases") or []
    if not isinstance(purchases, list):
        purchases = []
    strava = _strava_meta(user)
    stripe_status = user.get("stripeStatus")
    if stripe_status is None or stripe_status == "":
        stripe_status = "none"

    return {
        "id": uid,
        "email": user.get("email"),
        "name": user.get("name"),
        "provider": user.get("provider"),
        "createdAt": user.get("createdAt"),
        "onboardedAt": user.get("onboardedAt"),
        "subscriptionTier": get_tier(user),
        "subscriptionSource": user.get("subscriptionSource") or "default",
        "stripeStatus": stripe_status,
        "hasStripeCustomer": bool(
            isinstance(user.get("stripeCustomerId"), str)
            and str(user.get("stripeCustomerId")).startswith("cus_")
        ),
        "stripeCustomerId": user.get("stripeCustomerId")
        if isinstance(user.get("stripeCustomerId"), str)
        else None,
        "redeemPro": bool(user.get("redeemPro")),
        "racePassCredits": int(user.get("racePassCredits") or 0),
        "racePassPurchases": len(purchases),
        "rides": rides,
        "routes": routes,
        "ultras": ultras_n,
        "routesUnlocked": unlocked,
        "stravaLinked": strava["linked"],
        "stravaLastSyncAt": strava["lastSyncAt"],
    }


def _load_redeem_summary(data_root: str) -> list[dict[str, Any]]:
    path = os.path.join(data_root, "redeem_codes.json")
    try:
        with open(path, "r", encoding="utf-8") as f:
            store = json.load(f)
    except (OSError, json.JSONDecodeError):
        return []
    if not isinstance(store, dict):
        return []
    out: list[dict[str, Any]] = []
    for code, rec in store.items():
        if not isinstance(rec, dict):
            continue
        redemptions = rec.get("redemptions") or []
        if not isinstance(redemptions, list):
            redemptions = []
        out.append(
            {
                "code": code,
                "tier": rec.get("tier"),
                "reusable": bool(rec.get("reusable")),
                "active": bool(rec.get("active", True)),
                "note": rec.get("note"),
                "redemptionCount": len(redemptions),
                "redeemedBy": rec.get("redeemedBy"),
                "redeemedAt": rec.get("redeemedAt"),
            }
        )
    out.sort(key=lambda r: (-int(r["redemptionCount"]), str(r["code"])))
    return out


def _bump(counter: Counter, key: Any) -> None:
    counter[str(key or "unknown")] += 1


def build_app_snapshot(data_dir: str) -> dict[str, Any]:
    """Aggregate users + usage from a local data snapshot (no Stripe)."""
    root = bind_data_dir(data_dir)
    from app import users

    now = time.time()
    week = now - 7 * 86400
    month = now - 30 * 86400

    rows: list[dict[str, Any]] = []
    for user in users.list_users():
        rows.append(_safe_user_row(user, root))

    tier_mix: Counter = Counter()
    source_mix: Counter = Counter()
    status_mix: Counter = Counter()
    new_7 = new_30 = 0
    race_credits = 0
    race_purchases = 0
    strava_n = 0
    rides_t = routes_t = ultras_t = unlocked_t = 0
    past_due: list[str] = []

    for row in rows:
        _bump(tier_mix, row["subscriptionTier"])
        _bump(source_mix, row["subscriptionSource"])
        _bump(status_mix, row["stripeStatus"])
        created = row.get("createdAt")
        try:
            created_f = float(created) if created is not None else None
        except (TypeError, ValueError):
            created_f = None
        if created_f is not None:
            if created_f >= week:
                new_7 += 1
            if created_f >= month:
                new_30 += 1
        race_credits += int(row["racePassCredits"])
        race_purchases += int(row["racePassPurchases"])
        if row["stravaLinked"]:
            strava_n += 1
        rides_t += int(row["rides"])
        routes_t += int(row["routes"])
        ultras_t += int(row["ultras"])
        unlocked_t += int(row["routesUnlocked"])
        st = str(row["stripeStatus"] or "").lower()
        if st in ("past_due", "unpaid"):
            past_due.append(row.get("email") or row["id"])

    rows.sort(
        key=lambda r: float(r["createdAt"] or 0) if r.get("createdAt") is not None else 0,
        reverse=True,
    )

    n = len(rows)
    return {
        "generatedAt": now,
        "dataDir": root,
        "summary": {
            "users": n,
            "newUsers7d": new_7,
            "newUsers30d": new_30,
            "tierMix": dict(tier_mix),
            "sourceMix": dict(source_mix),
            "stripeStatusMix": dict(status_mix),
            "racePassCreditsTotal": race_credits,
            "racePassPurchasesTotal": race_purchases,
            "stravaLinked": strava_n,
            "stravaLinkedPct": round(100.0 * strava_n / n, 1) if n else 0.0,
            "rides": rides_t,
            "routes": routes_t,
            "ultras": ultras_t,
            "routesUnlocked": unlocked_t,
            "pastDueEmails": past_due,
        },
        "users": rows,
        "redeemCodes": _load_redeem_summary(root),
    }
